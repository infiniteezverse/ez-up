import type { ReplayOutput } from "./replay.js";

export interface BacktestMetrics {
  // Headline
  netReturnPct: number;          // (end - start) / start
  annualizedReturnPct: number;   // CAGR
  buyAndHoldReturnPct: number;   // strategy benchmark
  alphaPct: number;              // net - buyAndHold

  // Risk
  maxDrawdownPct: number;        // worst peak-to-trough on TVL
  sharpeRatio: number;           // mean / stddev of hourly returns (annualized)

  // Trade quality
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  winRate: number;               // fraction of trades that improved TVL on the NEXT bar (rough proxy)
  avgTradeNotionalUsd: number;
  totalFeesUsd: number;
  totalSlippageUsd: number;
  feeDragPct: number;            // fees + slippage as % of starting TVL

  // Context
  startTvl: number;
  endTvl: number;
  days: number;
  barsCount: number;
}

export function computeMetrics(result: ReplayOutput): BacktestMetrics {
  const { trades, tvlSeries, priceSeries, startTs, endTs, totalFeesUsd, totalSlippageUsd } = result;
  const startTvl = tvlSeries[0];
  const endTvl = tvlSeries[tvlSeries.length - 1];

  const netReturnPct = startTvl > 0 ? (endTvl - startTvl) / startTvl : 0;

  const days = (endTs - startTs) / 86400;
  const years = days / 365;
  const annualizedReturnPct =
    years > 0 && 1 + netReturnPct > 0 ? Math.pow(1 + netReturnPct, 1 / years) - 1 : 0;

  // Buy-and-hold benchmark: start with the same 50/50 split, just hold (no rebalancing)
  // For a 50/50 split, B&H final value = startTvl/2 + (startTvl/2) * (endPrice/startPrice)
  const priceReturn = priceSeries[0] > 0 ? priceSeries[priceSeries.length - 1] / priceSeries[0] : 1;
  const bnhFinalTvl = startTvl * 0.5 + startTvl * 0.5 * priceReturn;
  const buyAndHoldReturnPct = startTvl > 0 ? (bnhFinalTvl - startTvl) / startTvl : 0;
  const alphaPct = netReturnPct - buyAndHoldReturnPct;

  // Max drawdown on TVL
  let peak = tvlSeries[0];
  let maxDrawdownPct = 0;
  for (const v of tvlSeries) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (v - peak) / peak : 0;
    if (dd < maxDrawdownPct) maxDrawdownPct = dd;
  }

  // Sharpe ratio (annualized, risk-free rate assumed 0)
  // Hourly returns -> annualize by sqrt(24*365)
  const returns: number[] = [];
  for (let i = 1; i < tvlSeries.length; i++) {
    const prev = tvlSeries[i - 1];
    if (prev > 0) returns.push((tvlSeries[i] - prev) / prev);
  }
  const sharpeRatio = annualizedSharpe(returns);

  // Trade quality
  const buyCount = trades.filter((t) => t.side === "BUY_ZEN").length;
  const sellCount = trades.filter((t) => t.side === "SELL_ZEN").length;
  const avgTradeNotionalUsd =
    trades.length > 0 ? trades.reduce((s, t) => s + t.zenAmount * t.price, 0) / trades.length : 0;

  // Win rate proxy: a trade "wins" if TVL is higher 1 bar later (very rough)
  let wins = 0;
  for (const t of trades) {
    const idx = result.tvlSeries.findIndex((_, i) => result.priceSeries[i] === t.price);
    if (idx >= 0 && idx + 1 < tvlSeries.length && tvlSeries[idx + 1] > t.tvlAfter) wins += 1;
  }
  const winRate = trades.length > 0 ? wins / trades.length : 0;

  const feeDragPct = startTvl > 0 ? (totalFeesUsd + totalSlippageUsd) / startTvl : 0;

  return {
    netReturnPct,
    annualizedReturnPct,
    buyAndHoldReturnPct,
    alphaPct,
    maxDrawdownPct,
    sharpeRatio,
    tradeCount: trades.length,
    buyCount,
    sellCount,
    winRate,
    avgTradeNotionalUsd,
    totalFeesUsd,
    totalSlippageUsd,
    feeDragPct,
    startTvl,
    endTvl,
    days,
    barsCount: tvlSeries.length,
  };
}

function annualizedSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return 0;
  // Annualization assumes hourly bars (24*365 periods/year)
  return (mean / stddev) * Math.sqrt(24 * 365);
}

export function fmtPct(n: number, digits = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

export function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
