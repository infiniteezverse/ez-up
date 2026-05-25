import { decideActionV3, type SafeguardContext } from "../engine.js";
import { ZEN_DECIMALS, USDC_DECIMALS } from "../config.js";
import type { BotState, Config, MarketData } from "../types.js";
import type { OhlcvBar } from "./priceHistory.js";

export interface SimulatedTrade {
  ts: number;
  side: "SELL_ZEN" | "BUY_ZEN";
  tier: number;
  price: number;
  /** ZEN amount transacted (positive number, human units) */
  zenAmount: number;
  /** USDC amount transacted (positive number, human units) */
  usdcAmount: number;
  /** Fee charged in USD (EZ-Path basic = $0.03) */
  feeUsd: number;
  /** Slippage estimate in USD (configurable bps) */
  slippageUsd: number;
  /** Portfolio TVL immediately after the trade */
  tvlAfter: number;
  /** ZEN % of portfolio immediately after */
  zenPctAfter: number;
}

export interface ReplayInput {
  bars: OhlcvBar[];
  config: Config;
  /** Initial portfolio split (default 50/50 in USD value) */
  initialUsd?: number;
  /** Per-trade fee in USD (EZ-Path basic = 0.03) */
  feePerTradeUsd?: number;
  /** Estimated slippage in basis points applied per trade (default 10 bps = 0.10%) */
  slippageBps?: number;
  /** Optional: override the safeguards toggles */
  twoTickConfirmation?: boolean;
}

export interface ReplayOutput {
  trades: SimulatedTrade[];
  /** TVL at each bar's close, length === bars.length */
  tvlSeries: number[];
  /** ZEN % at each bar's close */
  zenPctSeries: number[];
  /** Closing price series for reference */
  priceSeries: number[];
  /** Final portfolio state */
  final: { zen: number; usdc: number; tvl: number };
  /** First bar timestamp + last bar timestamp */
  startTs: number;
  endTs: number;
  /** Total fees paid in USD */
  totalFeesUsd: number;
  /** Total slippage paid in USD */
  totalSlippageUsd: number;
}

/**
 * Tick-by-tick replay of the bot strategy against historical OHLCV bars.
 * Each bar's CLOSE price is treated as the "current price" for that tick —
 * mirrors the live bot, which samples price every TICK_INTERVAL_MS.
 *
 * Reuses decideActionV3 directly (no logic duplication).
 */
export function replay(input: ReplayInput): ReplayOutput {
  const {
    bars,
    config,
    initialUsd = 150,
    feePerTradeUsd = 0.03,
    slippageBps = 10,
    twoTickConfirmation = true,
  } = input;

  if (bars.length === 0) {
    throw new Error("replay: no bars provided");
  }

  const startPrice = bars[0].close;
  // 50/50 split in USD value at start
  let zen = initialUsd / 2 / startPrice;
  let usdc = initialUsd / 2;

  // Seed state to mirror live bot's initialState()
  let state: BotState = {
    entryPrice: startPrice,
    lastCycleHigh: startPrice,
    lastTradeAt: 0,
    tradesToday: 0,
    lastTradeDay: dayKey(bars[0].ts * 1000),
    totalTrades: 0,
    totalVolumeUsd: 0,
    lastDecisionAction: "HOLD",
    lastDecisionTier: undefined,
    openingDayZenValueUsd: zen * startPrice,
    openingDayUsdcValueUsd: usdc,
    dayOpenedKey: dayKey(bars[0].ts * 1000),
  };

  const trades: SimulatedTrade[] = [];
  const tvlSeries: number[] = [];
  const zenPctSeries: number[] = [];
  const priceSeries: number[] = [];
  let totalFeesUsd = 0;
  let totalSlippageUsd = 0;

  for (const bar of bars) {
    const price = bar.close;
    const nowMs = bar.ts * 1000;
    const todayKey = dayKey(nowMs);

    // Daily reset (mirrors index.ts)
    if (todayKey !== state.dayOpenedKey) {
      state.openingDayZenValueUsd = zen * price;
      state.openingDayUsdcValueUsd = usdc;
      state.dayOpenedKey = todayKey;
      state.tradesToday = 0;
    }

    const zenValueUsd = zen * price;
    const tvl = zenValueUsd + usdc;
    const zenPct = tvl > 0 ? zenValueUsd / tvl : 0;
    const usdcPct = 1 - zenPct;

    // Build MarketData (skip volume filter inputs — we disable that filter in backtest)
    const market: MarketData = {
      currentPrice: price,
      zenBalance: BigInt(Math.floor(zen * 10 ** ZEN_DECIMALS)),
      usdcBalance: BigInt(Math.floor(usdc * 10 ** USDC_DECIMALS)),
      zenValuePct: zenPct,
      usdcValuePct: usdcPct,
      dailyVol: undefined,
      hourlyVolumeUsd: undefined,
      dailyVolumeUsd: undefined,
    };

    // 24h price change for safeguards.priceChange24h
    const priceChange24h = compute24hChange(bars, bar.ts, price);
    const safeguards: SafeguardContext = {
      priceChange24h,
      openingZenValueUsd: state.openingDayZenValueUsd,
      openingUsdcValueUsd: state.openingDayUsdcValueUsd,
    };

    let decision = decideActionV3(state, market, config, safeguards, nowMs);

    // Always update lastCycleHigh AFTER the decision (mirrors live bot)
    state.lastCycleHigh = Math.max(state.lastCycleHigh, price);

    // If two-tick confirmation is OFF, force-execute on first signal by
    // pretending the previous tick saw the same decision.
    if (
      !twoTickConfirmation &&
      decision.action !== "HOLD" &&
      decision.percentOfAsset === 0
    ) {
      const fakedPrev: BotState = {
        ...state,
        lastDecisionAction: decision.action,
        lastDecisionTier: decision.tier,
      };
      decision = decideActionV3(fakedPrev, market, config, safeguards, nowMs);
    }

    // Record the decision action/tier (powers the 2-tick gate)
    state.lastDecisionAction = decision.action;
    state.lastDecisionTier = decision.tier;

    // Execute trade if decision says so
    if (decision.action !== "HOLD" && decision.percentOfAsset > 0) {
      const slippageUsd = (decision.notionalUsd ?? 0) * (slippageBps / 10_000);
      let executedZen: number;
      let executedUsdc: number;

      if (decision.action === "SELL_ZEN") {
        executedZen = zen * decision.percentOfAsset;
        // Effective price worse by slippage
        const effectivePrice = price * (1 - slippageBps / 10_000);
        executedUsdc = executedZen * effectivePrice;
        zen -= executedZen;
        usdc += executedUsdc - feePerTradeUsd; // fee deducted from USDC received
      } else {
        executedUsdc = usdc * decision.percentOfAsset;
        const effectivePrice = price * (1 + slippageBps / 10_000);
        executedZen = (executedUsdc - feePerTradeUsd) / effectivePrice; // fee from USDC spent
        usdc -= executedUsdc;
        zen += Math.max(0, executedZen);
      }

      totalFeesUsd += feePerTradeUsd;
      totalSlippageUsd += slippageUsd;

      const newZenValueUsd = zen * price;
      const newTvl = newZenValueUsd + usdc;

      trades.push({
        ts: bar.ts,
        side: decision.action,
        tier: decision.tier ?? 0,
        price,
        zenAmount: executedZen,
        usdcAmount: executedUsdc,
        feeUsd: feePerTradeUsd,
        slippageUsd,
        tvlAfter: newTvl,
        zenPctAfter: newTvl > 0 ? newZenValueUsd / newTvl : 0,
      });

      // Mirror live bot: reset baselines after a successful trade
      state.entryPrice = price;
      state.lastCycleHigh = price;
      state.lastTradeAt = nowMs;
      state.tradesToday = todayKey === state.lastTradeDay ? state.tradesToday + 1 : 1;
      state.lastTradeDay = todayKey;
      state.totalTrades += 1;
      state.totalVolumeUsd += decision.notionalUsd ?? 0;
    }

    const closingZenValueUsd = zen * price;
    const closingTvl = closingZenValueUsd + usdc;
    tvlSeries.push(closingTvl);
    zenPctSeries.push(closingTvl > 0 ? closingZenValueUsd / closingTvl : 0);
    priceSeries.push(price);
  }

  return {
    trades,
    tvlSeries,
    zenPctSeries,
    priceSeries,
    final: { zen, usdc, tvl: zen * bars[bars.length - 1].close + usdc },
    startTs: bars[0].ts,
    endTs: bars[bars.length - 1].ts,
    totalFeesUsd,
    totalSlippageUsd,
  };
}

function dayKey(ts: number): number {
  const d = new Date(ts);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/**
 * Compute the 24h % price change for the safeguards trend filter.
 * Looks backward through bars to find the price ~24h before `currentTs`.
 */
function compute24hChange(bars: OhlcvBar[], currentTs: number, currentPrice: number): number {
  const target = currentTs - 24 * 3600;
  // Binary search for the bar with ts closest to but not exceeding target
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].ts < target) lo = mid + 1;
    else hi = mid;
  }
  const refBar = bars[Math.max(0, lo - 1)];
  if (!refBar || refBar.close === 0) return 0;
  return (currentPrice - refBar.close) / refBar.close;
}
