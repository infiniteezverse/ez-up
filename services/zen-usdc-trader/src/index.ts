import { privateKeyToAccount } from "viem/accounts";
import { fetchBalances } from "./balance.js";
import { configV3, USDC_DECIMALS, ZEN_DECIMALS, SAFEGUARDS } from "./config.js";
import { decideActionV3, getDayKey } from "./engine.js";
import { executeSwap } from "./executor.js";
import { fetchZenPrice } from "./price.js";
import { initialState, loadState, saveState } from "./state.js";
import { recordSnapshot } from "./snapshot.js";
import { appendTrade } from "./ledger.js";
import type { BotState, MarketData, TradeRecord } from "./types.js";
import type { SafeguardContext } from "./engine.js";

const DRY_RUN = process.env.DRY_RUN === "true";
const ONCE = process.argv.includes("--once");
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 5 * 60 * 1000);

async function tick(privateKey: string): Promise<void> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const now = Date.now();
  const todayKey = getDayKey(now);

  console.log(`\n🔄 Tick @ ${new Date(now).toISOString()}${DRY_RUN ? " [DRY-RUN]" : ""}`);
  console.log(`📍 Wallet: ${account.address}`);

  const price = await fetchZenPrice();
  console.log(
    `💱 ZEN: $${price.priceUsd.toFixed(4)} | 24h vol: $${(price.volume24hUsd / 1e6).toFixed(2)}M | dailyVol: ${(price.dailyVol * 100).toFixed(2)}%`
  );

  const balances = await fetchBalances(account.address, price.priceUsd);
  console.log(
    `💼 ZEN: ${(Number(balances.zen) / 1e18).toFixed(4)} ($${balances.zenValueUsd.toFixed(2)}) | USDC: ${(Number(balances.usdc) / 1e6).toFixed(2)} | Split: ${(balances.zenValuePct * 100).toFixed(1)}%/${(balances.usdcValuePct * 100).toFixed(1)}%`
  );

  let state = await loadState();
  if (!state) {
    state = initialState(price.priceUsd, now, balances.zenValueUsd, balances.usdcValueUsd);
    await saveState(state);
    console.log(`📁 Initialized state at entry price $${price.priceUsd.toFixed(4)}`);
  }

  if (todayKey !== state.dayOpenedKey) {
    state.openingDayZenValueUsd = balances.zenValueUsd;
    state.openingDayUsdcValueUsd = balances.usdcValueUsd;
    state.dayOpenedKey = todayKey;
    state.tradesToday = 0;
    console.log(`📅 New day; reset opening values and trade counter`);
  }

  // Daily public snapshot (idempotent per UTC day; powers landing-page tracker)
  try {
    await recordSnapshot({
      now,
      zenAmount: Number(balances.zen) / 1e18,
      usdcAmount: Number(balances.usdc) / 1e6,
      zenPriceUsd: price.priceUsd,
      totalTrades: state.totalTrades,
    });
  } catch (err) {
    console.error(`⚠️  Snapshot write failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const market: MarketData = {
    currentPrice: price.priceUsd,
    zenBalance: balances.zen,
    usdcBalance: balances.usdc,
    zenValuePct: balances.zenValuePct,
    usdcValuePct: balances.usdcValuePct,
    dailyVol: price.dailyVol,
    hourlyVolumeUsd: price.volume1hUsd,
    dailyVolumeUsd: price.volume24hUsd,
  };

  const safeguards: SafeguardContext = {
    priceChange24h: price.priceChange24h ?? 0,
    openingZenValueUsd: state.openingDayZenValueUsd,
    openingUsdcValueUsd: state.openingDayUsdcValueUsd,
  };

  const decision = decideActionV3(state, market, configV3, safeguards, now);
  console.log(`🧠 Decision: ${decision.action} — ${decision.reason}`);

  state.lastDecisionAction = decision.action;
  state.lastDecisionTier = decision.tier;
  state.lastCycleHigh = Math.max(state.lastCycleHigh, price.priceUsd);

  if (decision.action === "HOLD" || decision.percentOfAsset === 0) {
    await saveState(state);
    return;
  }

  let sellAmount: bigint;
  let sellToken: "ZEN" | "USDC";
  let buyToken: "ZEN" | "USDC";

  if (decision.action === "SELL_ZEN") {
    sellToken = "ZEN";
    buyToken = "USDC";
    sellAmount = (balances.zen * BigInt(Math.floor(decision.percentOfAsset * 10000))) / 10000n;
  } else {
    sellToken = "USDC";
    buyToken = "ZEN";
    sellAmount = (balances.usdc * BigInt(Math.floor(decision.percentOfAsset * 10000))) / 10000n;
  }

  const sellDecimals = sellToken === "ZEN" ? ZEN_DECIMALS : USDC_DECIMALS;
  const sellAmountHuman = Number(sellAmount) / Math.pow(10, sellDecimals);

  console.log(
    `⚡ Executing: ${sellToken} → ${buyToken} | sellAmount: ${sellAmountHuman.toFixed(sellDecimals === 18 ? 4 : 2)}`
  );

  const result = await executeSwap({
    privateKey,
    sellToken,
    buyToken,
    sellAmount,
    dryRun: DRY_RUN,
  });

  if (result.status === "success") {
    console.log(`  ✅ ${result.routingEngine} | buyAmount: ${result.buyAmount} | tx: ${result.txHash}`);

    // Capture pre-update baseline so the ledger reflects the trigger price
    const baselinePrice = decision.action === "SELL_ZEN" ? state.entryPrice : state.lastCycleHigh;

    // Compute the trade's ZEN and USDC amounts in human units
    const buyAmountHuman = result.buyAmount ? Number(result.buyAmount) : 0;
    const zenAmount = decision.action === "SELL_ZEN" ? sellAmountHuman : buyAmountHuman;
    const usdcAmount = decision.action === "SELL_ZEN" ? buyAmountHuman : sellAmountHuman;

    // Compute new portfolio TVL right after the trade (estimate at decision price)
    let zenAfter: number;
    let usdcAfter: number;
    if (decision.action === "SELL_ZEN") {
      zenAfter = Number(balances.zen) / Math.pow(10, ZEN_DECIMALS) - zenAmount;
      usdcAfter = Number(balances.usdc) / Math.pow(10, USDC_DECIMALS) + usdcAmount;
    } else {
      zenAfter = Number(balances.zen) / Math.pow(10, ZEN_DECIMALS) + zenAmount;
      usdcAfter = Number(balances.usdc) / Math.pow(10, USDC_DECIMALS) - sellAmountHuman;
    }
    const tvlAfterUsd = zenAfter * price.priceUsd + usdcAfter;
    const zenPctAfter = tvlAfterUsd > 0 ? (zenAfter * price.priceUsd) / tvlAfterUsd : 0;

    // Append to public trade ledger (state/trades.json)
    try {
      const tradePartial: Omit<TradeRecord, "runningPnlUsd"> = {
        id: state.totalTrades + 1,
        timestamp: now,
        side: decision.action as "SELL_ZEN" | "BUY_ZEN",
        tier: decision.tier ?? 0,
        baselinePrice,
        decisionPrice: price.priceUsd,
        zenAmount,
        usdcAmount,
        feeUsd: 0.03, // EZ-Path basic tier
        notionalUsd: decision.notionalUsd ?? 0,
        txHash: result.txHash,
        routingEngine: result.routingEngine,
        tvlAfterUsd,
        zenPctAfter,
      };
      // Seed ledger with current pre-trade TVL the first time it's written
      const preTvl = balances.zenValueUsd + balances.usdcValueUsd;
      const recorded = await appendTrade({
        trade: tradePartial,
        currentInitialTvlUsd: preTvl,
      });
      console.log(
        `📒 Trade #${recorded.id} logged → trades.json (running P&L: $${recorded.runningPnlUsd.toFixed(2)})`
      );
    } catch (err) {
      console.error(`⚠️  Ledger write failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    state.entryPrice = price.priceUsd;
    state.lastCycleHigh = price.priceUsd;
    state.lastTradeAt = now;
    state.tradesToday = todayKey === state.lastTradeDay ? state.tradesToday + 1 : 1;
    state.lastTradeDay = todayKey;
    state.totalTrades = state.totalTrades + 1;
    state.totalVolumeUsd = state.totalVolumeUsd + (decision.notionalUsd ?? 0);
    await saveState(state);
    console.log(`📊 Total trades: ${state.totalTrades} | Volume: $${state.totalVolumeUsd.toFixed(2)}`);
  } else if (result.status === "skipped") {
    console.log(`  ⏭️  Dry-run skipped execution`);
    await saveState(state);
  } else {
    console.log(`  ❌ Failed: ${result.error}`);
    await saveState(state);
  }
}

async function main(): Promise<void> {
  const privateKey = process.env.TRADER_PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ TRADER_PRIVATE_KEY not set");
    process.exit(1);
  }

  console.log(`\n🤖 EZ-Path ZEN/USDC Swing Trader v0.1.0`);
  console.log(`⚙️  Config: 30-70% bands, brackets ${configV3.upsideBrackets.map((b) => (b * 100).toFixed(0) + "%").join("/")}, cooldown ${configV3.minTradeIntervalMs / 60000}min`);

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
