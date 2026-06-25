import { PairConfig, AssetPair } from './types';

/**
 * V2 Executor Configuration for ZEN/USDC pair
 * Bracket tiers (base, adjusted by 90-day volatility)
 * Slicing strategy: convex allocation (smaller at extremes, larger at moderate tiers)
 * Safety thresholds: allocation bands, trend filter, daily P&L stop, amnesia gate
 */
export const ZEN_USDC_CONFIG: PairConfig = {
  pair: 'ZEN_USDC',
  assetDecimals: 18,
  minNotionalUsd: 3, // Minimum trade size

  // Allocation bands (30-70% per asset)
  minAssetPct: 0.30,
  maxAssetPct: 0.70,

  // Bracket tiers: 2%, 4%, 6%, 8% (adjusted by volatility multiplier)
  upsideBrackets: [0.02, 0.04, 0.06, 0.08],
  downsideBrackets: [-0.02, -0.04, -0.06, -0.08],

  // Slice allocation: 5%, 5%, 10%, 15% (convex—smaller at extremes)
  upsideSlices: [0.05, 0.05, 0.10, 0.15],
  downsideSlices: [0.05, 0.05, 0.10, 0.15],

  // Safety thresholds
  maxTradesPerDay: 8,
  minTradeIntervalMs: 60_000, // 60s between trades (prevents spam)
  trendFilterThreshold: 0.15, // Disable tier 1 buys if 24h vol > 15%
  dailyPnlStopPercent: -0.10, // Stop buys if down > 10% today

  // 72h amnesia gate: reset brackets after 3 days of no trades
  amnesiaDurationMs: 72 * 60 * 60 * 1000,
};

/**
 * V2 Executor Configuration for ETH/USDC pair
 * Identical brackets and slicing as ZEN for consistency
 * Adjusted thresholds: same safety gates apply per-pair independently
 */
export const ETH_USDC_CONFIG: PairConfig = {
  pair: 'ETH_USDC',
  assetDecimals: 18,
  minNotionalUsd: 3,

  // Allocation bands (30-70% per asset)
  minAssetPct: 0.30,
  maxAssetPct: 0.70,

  // Bracket tiers: 2%, 4%, 6%, 8% (same as ZEN)
  upsideBrackets: [0.02, 0.04, 0.06, 0.08],
  downsideBrackets: [-0.02, -0.04, -0.06, -0.08],

  // Slice allocation: 5%, 5%, 10%, 15% (convex)
  upsideSlices: [0.05, 0.05, 0.10, 0.15],
  downsideSlices: [0.05, 0.05, 0.10, 0.15],

  // Safety thresholds (same as ZEN)
  maxTradesPerDay: 8,
  minTradeIntervalMs: 60_000,
  trendFilterThreshold: 0.15,
  dailyPnlStopPercent: -0.10,

  // 72h amnesia gate (independent per pair)
  amnesiaDurationMs: 72 * 60 * 60 * 1000,
};

/**
 * Get pair config by asset pair name.
 * Used throughout engine/executor to access bracket tiers and safety thresholds.
 */
export function getConfigForPair(pair: AssetPair): PairConfig {
  switch (pair) {
    case 'ZEN_USDC':
      return ZEN_USDC_CONFIG;
    case 'ETH_USDC':
      return ETH_USDC_CONFIG;
    default:
      throw new Error(`Unknown pair: ${pair}`);
  }
}

/**
 * Get both configs for batch initialization.
 */
export function getAllConfigs(): PairConfig[] {
  return [ZEN_USDC_CONFIG, ETH_USDC_CONFIG];
}
