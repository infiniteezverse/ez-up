import { TradeRecord, VolatilityMetrics, AssetPair } from './types';

// 90-day rolling lookback for realized spot volatility
// Adjusts bracket tiers dynamically based on market conditions
// Runs daily (independent per pair)

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Reference volatility baseline (used for normalized tier adjustment)
const BASELINE_VOLATILITY = 0.25; // 25% annualized (moderate baseline)

// Tier adjustment bounds (prevent extreme multiplication)
const MIN_TIER_MULTIPLIER = 0.8; // Tighten to 80% of base brackets
const MAX_TIER_MULTIPLIER = 1.5; // Widen to 150% of base brackets

/**
 * Calculate log returns from consecutive prices.
 * Returns array of daily returns (e.g., [0.05, -0.02, 0.03] for +5%, -2%, +3%).
 */
function calculateLogReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    // Avoid division by zero or negative prices
    if (prices[i - 1] <= 0 || prices[i] <= 0) continue;
    const logReturn = Math.log(prices[i] / prices[i - 1]);
    returns.push(logReturn);
  }
  return returns;
}

/**
 * Calculate standard deviation of returns.
 * Used to estimate daily volatility, annualized to ~252 trading days.
 */
function calculateStdDeviation(returns: number[]): number {
  if (returns.length < 2) return BASELINE_VOLATILITY;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  const dailyStdDev = Math.sqrt(variance);

  // Annualize: daily vol * sqrt(252 trading days)
  return dailyStdDev * Math.sqrt(252);
}

/**
 * Extract trade prices for a given pair from 90-day trade history.
 * Filters trades by pair and timestamp; returns in chronological order.
 */
function extractPriceHistory(trades: TradeRecord[], pair: AssetPair, nowMs: number): number[] {
  const cutoffMs = nowMs - NINETY_DAYS_MS;
  const relevantTrades = trades
    .filter(t => t.pair === pair && t.timestamp >= cutoffMs)
    .sort((a, b) => a.timestamp - b.timestamp);

  return relevantTrades.map(t => t.priceUsd);
}

/**
 * Calculate tier multiplier based on realized volatility.
 * Higher vol → wider brackets (sell more on upside, buy more on downside)
 * Lower vol → tighter brackets (more conservative trading)
 *
 * Formula: multiplier = (realized90dVol / BASELINE_VOLATILITY) ^ 0.5
 * This dampens extreme moves (vol 60% doesn't double brackets).
 */
function calculateTierMultiplier(realized90dVol: number): number {
  // Clamp realized vol to sensible range to prevent extreme multipliers
  const clampedVol = Math.max(0.05, Math.min(2.0, realized90dVol));

  // Power of 0.5 creates moderate scaling (e.g., 2x vol → 1.41x brackets)
  let multiplier = Math.pow(clampedVol / BASELINE_VOLATILITY, 0.5);

  // Clamp final multiplier to bounds
  multiplier = Math.max(MIN_TIER_MULTIPLIER, Math.min(MAX_TIER_MULTIPLIER, multiplier));

  return multiplier;
}

/**
 * Main entry point: compute volatility metrics for a pair.
 * Called once daily per pair (or on-demand during decideActionV3).
 *
 * @param pair - Asset pair (ZEN_USDC | ETH_USDC)
 * @param trades - All trade records (typically loaded from state)
 * @param nowMs - Current Unix timestamp (ms); default to Date.now()
 * @returns VolatilityMetrics with realized90dVol, tierMultiplier, lastUpdated
 */
export function calculateVolatilityMetrics(
  pair: AssetPair,
  trades: TradeRecord[],
  nowMs: number = Date.now()
): VolatilityMetrics {
  // Extract prices in chronological order for the past 90 days
  const prices = extractPriceHistory(trades, pair, nowMs);

  // If fewer than 2 price points, use baseline
  if (prices.length < 2) {
    return {
      pair,
      realized90dVol: BASELINE_VOLATILITY,
      tierMultiplier: 1.0,
      lastUpdated: nowMs,
    };
  }

  // Calculate log returns
  const returns = calculateLogReturns(prices);

  // Calculate annualized volatility
  const realized90dVol = calculateStdDeviation(returns);

  // Derive tier multiplier from vol ratio
  const tierMultiplier = calculateTierMultiplier(realized90dVol);

  return {
    pair,
    realized90dVol,
    tierMultiplier,
    lastUpdated: nowMs,
  };
}

/**
 * Utility: check if volatility metrics need daily recalculation.
 * Returns true if last update was > 24 hours ago (indicating new UTC day).
 */
export function needsDailyRecalc(metrics: VolatilityMetrics, nowMs: number = Date.now()): boolean {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return nowMs - metrics.lastUpdated > ONE_DAY_MS;
}

/**
 * Utility: apply tier multiplier to a base bracket threshold.
 * Example: base bracket 4% with multiplier 1.2 → effective bracket 4.8%
 */
export function adjustBracketByMultiplier(
  baseBracketPct: number,
  tierMultiplier: number
): number {
  return baseBracketPct * tierMultiplier;
}
