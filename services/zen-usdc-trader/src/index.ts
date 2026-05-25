import { privateKeyToAccount } from "viem/accounts";
import { fetchPairBalances } from "./balance.js";
import { PAIRS, USDC_DECIMALS } from "./config.js";
import { decideActionV3, getDayKey } from "./engine.js";
import { executeSwap } from "./executor.js";
import { fetchPairPrice } from "./price.js";
import {
  initialAllState,
  initialPairState,
  loadAllState,
  saveAllState,
} from "./state.js";
import { recordSnapshot } from "./snapshot.js";
import { appendTrade } from "./ledger.js";
import { estimateSlippageBps, maxAcceptableSlippageBps } from "./slippage.js";
import type { BotState, MarketData, MultiPairBotState, PairConfig, TradeRecord } from "./types.js";
import type { SafeguardContext } from "./engine.js";
import type { PriceFeed } from "./price.js";
import type { PairBalances } from "./balance.js";

const DRY_RUN = process.env.DRY_RUN === "true";
const ONCE = process.argv.includes("--once");
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 5 * 60 * 1000);

/**
 * Process a single pair within a tick. The pair operates on its slice of
 * total treasury: it owns ALL of the volatile token balance, plus a
 * `weightOfTreasury` fraction of the shared USDC reserve.
 *
 * On-chain USDC is shared across pairs; this function reads it fresh each
 * call so trades by an earlier pair in the same tick are reflected.
 */
async function processPair(
  pair: PairConfig,
  walletAddress: `0x${string}`,
  allState: MultiPairBotState,
  privateKey: string,
  now: number,
  todayKey: number
): Promise<void> {
  const cfg = pair.strategy;

  // --- Price + pool depth for this pair ---
  let price: PriceFeed;
  try {
    price = await fetchPairPrice(pair);
  } catch (err) {
    console.log(`  ⚠️  ${pair.name}: price fetch failed (${err instanceof Error ? err.message : String(err)})`);
    return;
  }
  console.log(
    `  💱 ${pair.name}: $${price.priceUsd.toFixed(4)} | 24h vol $${(price.volume24hUsd / 1e6).toFixed(2)}M | pool $${((price.liquidityUsd ?? 0) / 1000).toFixed(0)}K`
  );

  // --- Live on-chain balances ---
  const balances = await fetchPairBalances(pair, walletAddress, price.priceUsd);

  // --- Per-pair USDC allocation (this pair owns weightOfTreasury fraction) ---
  const allocatedUsdc = balances.usdcAmount * pair.weightOfTreasury;
  const allocatedUsdcAtomic = (balances.usdc * BigInt(Math.floor(pair.weightOfTreasury * 10_000))) / 10_000n;
  const pairTvl = balances.zenValueUsd + allocatedUsdc;
  const pairVolPct = pairTvl > 0 ? balances.zenValueUsd / pairTvl : 0;
  const pairUsdcPct = 1 - pairVolPct;

  console.log(
    `  💼 ${pair.name}: ${balances.zenAmount.toFixed(4)} ${pair.symbol} ($${balances.zenValueUsd.toFixed(2)}) | allocated USDC $${allocatedUsdc.toFixed(2)} | split ${(pairVolPct * 100).toFixed(1)}/${(pairUsdcPct * 100).toFixed(1)}`
  );

  // --- Load/init this pair's state ---
  let state: BotState | undefined = allState.pairs[pair.name];
  if (!state) {
    state = initialPairState(price.priceUsd, now, balances.zenValueUsd, allocatedUsdc);
    allState.pairs[pair.name] = state;
    console.log(`  📁 ${pair.name}: initialized state at entry $${price.priceUsd.toFixed(4)}`);
  }

  // --- Daily reset ---
  if (todayKey !== state.dayOpenedKey) {
    state.openingDayZenValueUsd = balances.zenValueUsd;
    state.openingDayUsdcValueUsd = allocatedUsdc;
    state.dayOpenedKey = todayKey;
    state.tradesToday = 0;
  }

  // --- 72h reference reset ---
  const resetWindowMs = cfg.referenceResetWindowMs ?? 72 * 3600 * 1000;
  if (resetWindowMs > 0) {
    if (!state.entryPriceSetAt) state.entryPriceSetAt = now;
    if (now - state.entryPriceSetAt > resetWindowMs) {
      const oldEntry = state.entryPrice;
      state.entryPrice = price.priceUsd;
      state.lastCycleHigh = price.priceUsd;
      state.entryPriceSetAt = now;
      console.log(
        `  ⏰ ${pair.name}: ref reset — entry $${oldEntry.toFixed(4)} → $${price.priceUsd.toFixed(4)}`
      );
    }
  }

  // --- Decision ---
  const market: MarketData = {
    currentPrice: price.priceUsd,
    zenBalance: balances.zen,
    usdcBalance: allocatedUsdcAtomic,
    zenValuePct: pairVolPct,
    usdcValuePct: pairUsdcPct,
    dailyVol: price.dailyVol,
    hourlyVolumeUsd: price.volume1hUsd,
    dailyVolumeUsd: price.volume24hUsd,
  };

  const safeguards: SafeguardContext = {
    priceChange24h: price.priceChange24h ?? 0,
    openingZenValueUsd: state.openingDayZenValueUsd,
    openingUsdcValueUsd: state.openingDayUsdcValueUsd,
  };

  const decision = decideActionV3(state, market, cfg, safeguards, now);
  console.log(`  🧠 ${pair.name}: ${decision.action} — ${decision.reason}`);

  state.lastDecisionAction = decision.action;
  state.lastDecisionTier = decision.tier;
  state.lastCycleHigh = Math.max(state.lastCycleHigh, price.priceUsd);

  if (decision.action === "HOLD" || decision.percentOfAsset === 0) {
    return;
  }

  // --- Compute trade size ---
  let sellAmount: bigint;
  let sellToken: "VOL" | "USDC";
  let buyToken: "VOL" | "USDC";

  if (decision.action === "SELL_ZEN") {
    sellToken = "VOL";
    buyToken = "USDC";
    sellAmount = (balances.zen * BigInt(Math.floor(decision.percentOfAsset * 10_000))) / 10_000n;
  } else {
    sellToken = "USDC";
    buyToken = "VOL";
    // Buy uses the allocated USDC, not the full wallet USDC
    sellAmount = (allocatedUsdcAtomic * BigInt(Math.floor(decision.percentOfAsset * 10_000))) / 10_000n;
  }

  const sellDecimals = sellToken === "VOL" ? pair.tokenDecimals : USDC_DECIMALS;
  const sellAmountHuman = Number(sellAmount) / Math.pow(10, sellDecimals);

  // --- Slippage gate ---
  const slipFrac = cfg.maxSlippageFractionOfBracket ?? 0.25;
  if (slipFrac > 0 && price.liquidityUsd && decision.tier && decision.notionalUsd) {
    const bracketPct =
      decision.action === "SELL_ZEN"
        ? cfg.upsideBrackets[decision.tier - 1]
        : cfg.downsideBrackets[decision.tier - 1];
    const projectedBps = estimateSlippageBps({
      tradeNotionalUsd: decision.notionalUsd,
      poolLiquidityUsd: price.liquidityUsd,
    });
    const maxBps = maxAcceptableSlippageBps(bracketPct, slipFrac);
    if (projectedBps > maxBps) {
      console.log(
        `  🛑 ${pair.name}: slippage gate — projected ${projectedBps} bps > max ${maxBps} bps. Aborting.`
      );
      state.lastDecisionAction = "HOLD";
      state.lastDecisionTier = undefined;
      return;
    }
    console.log(`  🛡️  ${pair.name}: slippage OK (${projectedBps} bps, max ${maxBps})`);
  }

  console.log(
    `  ⚡ ${pair.name}: executing ${sellToken} → ${buyToken} sellAmount=${sellAmountHuman.toFixed(sellDecimals === 18 ? 4 : 2)}`
  );

  const result = await executeSwap({
    privateKey,
    sellToken,
    buyToken,
    sellAmount,
    pair,
    dryRun: DRY_RUN,
  });

  if (result.status === "success") {
    console.log(`  ✅ ${pair.name}: ${result.routingEngine} buyAmount=${result.buyAmount} tx=${result.txHash}`);
    await recordTrade({
      pair,
      decision,
      result,
      state,
      now,
      balances,
      price,
      sellAmountHuman,
    });

    state.entryPrice = price.priceUsd;
    state.lastCycleHigh = price.priceUsd;
    state.entryPriceSetAt = now;
    state.lastTradeAt = now;
    state.tradesToday = todayKey === state.lastTradeDay ? state.tradesToday + 1 : 1;
    state.lastTradeDay = todayKey;
    state.totalTrades += 1;
    state.totalVolumeUsd += decision.notionalUsd ?? 0;
    console.log(`  📊 ${pair.name}: total trades ${state.totalTrades} | vol $${state.totalVolumeUsd.toFixed(2)}`);
  } else if (result.status === "skipped") {
    console.log(`  ⏭️  ${pair.name}: dry-run skipped execution`);
  } else {
    console.log(`  ❌ ${pair.name}: ${result.error}`);
  }
}

async function recordTrade(p: {
  pair: PairConfig;
  decision: ReturnType<typeof decideActionV3>;
  result: Awaited<ReturnType<typeof executeSwap>>;
  state: BotState;
  now: number;
  balances: PairBalances;
  price: PriceFeed;
  sellAmountHuman: number;
}): Promise<void> {
  const { pair, decision, result, state, now, balances, price, sellAmountHuman } = p;
  const baselinePrice = decision.action === "SELL_ZEN" ? state.entryPrice : state.lastCycleHigh;
  const buyAmountHuman = result.buyAmount ? Number(result.buyAmount) : 0;
  const zenAmount = decision.action === "SELL_ZEN" ? sellAmountHuman : buyAmountHuman;
  const usdcAmount = decision.action === "SELL_ZEN" ? buyAmountHuman : sellAmountHuman;

  let zenAfter: number;
  let usdcAfter: number;
  if (decision.action === "SELL_ZEN") {
    zenAfter = balances.zenAmount - zenAmount;
    usdcAfter = balances.usdcAmount + usdcAmount;
  } else {
    zenAfter = balances.zenAmount + zenAmount;
    usdcAfter = balances.usdcAmount - sellAmountHuman;
  }
  const tvlAfterUsd = zenAfter * price.priceUsd + usdcAfter;
  const zenPctAfter = tvlAfterUsd > 0 ? (zenAfter * price.priceUsd) / tvlAfterUsd : 0;

  try {
    const tradePartial: Omit<TradeRecord, "runningPnlUsd"> = {
      id: state.totalTrades + 1,
      timestamp: now,
      pair: pair.name,
      side: decision.action as "SELL_ZEN" | "BUY_ZEN",
      tier: decision.tier ?? 0,
      baselinePrice,
      decisionPrice: price.priceUsd,
      zenAmount,
      usdcAmount,
      feeUsd: 0.03,
      notionalUsd: decision.notionalUsd ?? 0,
      txHash: result.txHash,
      routingEngine: result.routingEngine,
      tvlAfterUsd,
      zenPctAfter,
    };
    const preTvl = balances.totalUsd;
    const recorded = await appendTrade({
      trade: tradePartial,
      currentInitialTvlUsd: preTvl,
    });
    console.log(
      `  📒 trade #${recorded.id} ${pair.name} logged (running P&L $${recorded.runningPnlUsd.toFixed(2)})`
    );
  } catch (err) {
    console.error(`  ⚠️  ledger write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function tick(privateKey: string): Promise<void> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const now = Date.now();
  const todayKey = getDayKey(now);

  console.log(`\n🔄 Tick @ ${new Date(now).toISOString()}${DRY_RUN ? " [DRY-RUN]" : ""}`);
  console.log(`📍 Wallet: ${account.address}`);
  console.log(`📦 Pairs: ${PAIRS.map((p) => p.name).join(", ")}`);

  const allState = (await loadAllState()) ?? initialAllState();

  // Snapshot total wallet TVL and write per-pair daily snapshots
  // We do this BEFORE per-pair processing so the snapshot reflects start-of-tick state
  try {
    // Use the first pair's price fetch for the snapshot price baseline (good enough; each pair has its own price too)
    const firstPair = PAIRS[0];
    const firstPrice = await fetchPairPrice(firstPair);
    const firstBalances = await fetchPairBalances(firstPair, account.address, firstPrice.priceUsd);
    await recordSnapshot({
      now,
      zenAmount: firstBalances.zenAmount,
      usdcAmount: firstBalances.usdcAmount,
      zenPriceUsd: firstPrice.priceUsd,
      totalTrades: Object.values(allState.pairs).reduce((s, st) => s + st.totalTrades, 0),
    });
  } catch (err) {
    console.error(`⚠️  Snapshot write failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Process each pair (sequential; first-mover sees full USDC, later pairs see post-trade balance)
  for (const pair of PAIRS) {
    try {
      await processPair(pair, account.address, allState, privateKey, now, todayKey);
    } catch (err) {
      console.error(`❌ ${pair.name} error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await saveAllState(allState);
}

async function main(): Promise<void> {
  const privateKey = process.env.TRADER_PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ TRADER_PRIVATE_KEY not set");
    process.exit(1);
  }

  console.log(`\n🤖 EZ-Path Multi-Pair Swing Trader v0.2.0`);
  console.log(`⚙️  Pairs: ${PAIRS.map((p) => `${p.name}(weight ${p.weightOfTreasury})`).join(", ")}`);

  if (ONCE) {
    await tick(privateKey);
    return;
  }

  while (true) {
    try {
      await tick(privateKey);
    } catch (err) {
      console.error(`❌ Tick error: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
