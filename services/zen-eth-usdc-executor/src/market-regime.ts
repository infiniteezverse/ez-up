/**
 * Market Regime Detection
 * Automatically identifies market conditions and returns appropriate parameters
 * Used to dynamically adjust bracket thresholds, trade limits, and allocation bands
 */

import { VolatilityMetrics } from './types';

export type MarketRegime = 'CALM' | 'NORMAL' | 'CHOPPY' | 'TRENDING';

export interface RegimeParameters {
  regime: MarketRegime;
  confidence: number; // 0-1, how confident we are in this regime
  brackets: {
    upside: number[];
    downside: number[];
  };
  slices: {
    upside: number[];
    downside: number[];
  };
  maxTradesPerDay: number;
  minAssetPct: number;
  maxAssetPct: number;
  trendFilterThreshold: number;
  dailyPnlStopPercent: number;
  profitTakingLayers: ProfitLayer[];
}

export interface ProfitLayer {
  percentOfPosition: number; // What % of position to sell at this layer
  profitTarget: number; // At what profit % to sell (0.02 = 2%)
  description: string; // e.g., "Quick win"
}

/**
 * Detect current market regime based on volatility and price action
 */
export function detectMarketRegime(
  volatilityMetrics: VolatilityMetrics,
  priceChange24h: number, // -1 to 1 range
  volume24h: number,
  historicalPrice: number[]
): { regime: MarketRegime; confidence: number } {
  const vol24h = Math.abs(priceChange24h);
  const vol90d = volatilityMetrics.realized90dVol;

  // Calculate momentum from recent prices
  const momentum = calculateMomentum(historicalPrice);

  // Volatility ratios
  const volRatio = vol24h > 0 ? vol90d / vol24h : 1;
  const currentVsBaseline = vol90d / 0.14; // 14% is our baseline

  // ============ TRENDING DETECTION ============
  // High volatility AND strong momentum (bull or bear with conviction)
  if (currentVsBaseline > 1.3 && Math.abs(momentum) > 0.03) {
    return {
      regime: 'TRENDING',
      confidence: Math.min(0.95, 0.5 + Math.abs(momentum) * 10),
    };
  }

  // ============ CHOPPY DETECTION ============
  // Very high volatility BUT low momentum (whipsaw, no direction)
  if (currentVsBaseline > 1.4 && Math.abs(momentum) < 0.02) {
    return {
      regime: 'CHOPPY',
      confidence: Math.min(0.9, 0.6 + (currentVsBaseline - 1.4) * 2),
    };
  }

  // ============ CALM DETECTION ============
  // Low volatility relative to baseline
  if (currentVsBaseline < 0.8) {
    return {
      regime: 'CALM',
      confidence: Math.min(0.9, 0.5 + (0.8 - currentVsBaseline) * 5),
    };
  }

  // ============ DEFAULT: NORMAL ============
  return {
    regime: 'NORMAL',
    confidence: 0.7,
  };
}

/**
 * Calculate momentum from recent price history (0-1 scale)
 * Positive = uptrend, Negative = downtrend
 */
function calculateMomentum(prices: number[]): number {
  if (prices.length < 3) return 0;

  const recentPrices = prices.slice(-20); // Last 20 data points
  if (recentPrices.length < 2) return 0;

  const returns = [];
  for (let i = 1; i < recentPrices.length; i++) {
    const ret = (recentPrices[i] - recentPrices[i - 1]) / recentPrices[i - 1];
    returns.push(ret);
  }

  // Calculate average return (momentum)
  const avgReturn =
    returns.reduce((a, b) => a + b, 0) / returns.length;

  // Clamp to -0.1 to 0.1 range
  return Math.max(-0.1, Math.min(0.1, avgReturn));
}

/**
 * Get regime-specific parameters
 * All parameters tuned for each market condition
 */
export function getRegimeParameters(
  regime: MarketRegime,
  confidence: number
): RegimeParameters {
  switch (regime) {
    case 'CALM':
      return {
        regime: 'CALM',
        confidence,
        brackets: {
          // Tighten brackets for more frequent signals
          upside: [0.015, 0.03, 0.045, 0.06],
          downside: [-0.015, -0.03, -0.045, -0.06],
        },
        slices: {
          // Standard slices but more frequent trades
          upside: [0.05, 0.05, 0.1, 0.15],
          downside: [0.05, 0.05, 0.1, 0.15],
        },
        maxTradesPerDay: 12, // More trades when opportunities abundant
        minAssetPct: 0.25, // More aggressive (75% in assets)
        maxAssetPct: 0.75,
        trendFilterThreshold: 0.12, // More selective (skip vol > 12%)
        dailyPnlStopPercent: -0.1,
        profitTakingLayers: [
          { percentOfPosition: 0.4, profitTarget: 0.02, description: 'Quick Win' },
          { percentOfPosition: 0.3, profitTarget: 0.04, description: 'Momentum' },
          { percentOfPosition: 0.2, profitTarget: 0.06, description: 'Trend Ride' },
          { percentOfPosition: 0.1, profitTarget: 0.1, description: 'Max Run' },
        ],
      };

    case 'NORMAL':
      return {
        regime: 'NORMAL',
        confidence,
        brackets: {
          // Standard brackets
          upside: [0.02, 0.04, 0.06, 0.08],
          downside: [-0.02, -0.04, -0.06, -0.08],
        },
        slices: {
          // Standard slices
          upside: [0.05, 0.05, 0.1, 0.15],
          downside: [0.05, 0.05, 0.1, 0.15],
        },
        maxTradesPerDay: 8, // Baseline
        minAssetPct: 0.3,
        maxAssetPct: 0.7,
        trendFilterThreshold: 0.15,
        dailyPnlStopPercent: -0.1,
        profitTakingLayers: [
          { percentOfPosition: 0.4, profitTarget: 0.02, description: 'Quick Win' },
          { percentOfPosition: 0.3, profitTarget: 0.04, description: 'Momentum' },
          { percentOfPosition: 0.2, profitTarget: 0.06, description: 'Trend Ride' },
          { percentOfPosition: 0.1, profitTarget: 0.08, description: 'Max Run' },
        ],
      };

    case 'CHOPPY':
      return {
        regime: 'CHOPPY',
        confidence,
        brackets: {
          // Tighter brackets to catch oscillations
          upside: [0.015, 0.03, 0.045, 0.06],
          downside: [-0.015, -0.03, -0.045, -0.06],
        },
        slices: {
          // Smaller slices per trade (more positions)
          upside: [0.04, 0.04, 0.08, 0.12],
          downside: [0.04, 0.04, 0.08, 0.12],
        },
        maxTradesPerDay: 12, // Many small trades in chop
        minAssetPct: 0.4, // More USDC reserved (60% dry powder)
        maxAssetPct: 0.6, // Less exposure
        trendFilterThreshold: 0.2, // Relaxed (allow more tier 1 buys)
        dailyPnlStopPercent: -0.08, // Tighter stop (risk control)
        profitTakingLayers: [
          { percentOfPosition: 0.5, profitTarget: 0.015, description: 'Scalp' },
          { percentOfPosition: 0.3, profitTarget: 0.03, description: 'Quick Win' },
          { percentOfPosition: 0.15, profitTarget: 0.045, description: 'Ride' },
          { percentOfPosition: 0.05, profitTarget: 0.06, description: 'Max' },
        ],
      };

    case 'TRENDING':
      return {
        regime: 'TRENDING',
        confidence,
        brackets: {
          // Wider brackets to avoid whipsaw on trend
          upside: [0.02, 0.04, 0.06, 0.08],
          downside: [-0.025, -0.05, -0.075, -0.1],
        },
        slices: {
          // Larger slices to capture trend momentum
          upside: [0.06, 0.07, 0.12, 0.2],
          downside: [0.03, 0.03, 0.06, 0.1], // Buy less on downside in trending market
        },
        maxTradesPerDay: 10, // Controlled frequency (avoid chasing)
        minAssetPct: 0.3,
        maxAssetPct: 0.75, // More aggressive in trends
        trendFilterThreshold: 0.25, // Relaxed (allow all tier 1 buys in trend)
        dailyPnlStopPercent: -0.12, // Wider stop (let trends run)
        profitTakingLayers: [
          { percentOfPosition: 0.2, profitTarget: 0.03, description: 'Partial' },
          { percentOfPosition: 0.3, profitTarget: 0.06, description: 'Momentum' },
          { percentOfPosition: 0.3, profitTarget: 0.1, description: 'Trend Ride' },
          { percentOfPosition: 0.2, profitTarget: 0.15, description: 'Let Run' },
        ],
      };

    default:
      throw new Error(`Unknown regime: ${regime}`);
  }
}

/**
 * Blend parameters based on confidence
 * If confidence is low, blend toward NORMAL (baseline)
 */
export function blendParameters(
  regimeParams: RegimeParameters,
  normalParams: RegimeParameters
): RegimeParameters {
  const confidence = regimeParams.confidence;
  const blend = (regime: number, normal: number) =>
    regime * confidence + normal * (1 - confidence);

  return {
    ...regimeParams,
    brackets: {
      upside: regimeParams.brackets.upside.map(
        (val, i) => blend(val, normalParams.brackets.upside[i])
      ),
      downside: regimeParams.brackets.downside.map(
        (val, i) => blend(val, normalParams.brackets.downside[i])
      ),
    },
    maxTradesPerDay: Math.round(
      blend(regimeParams.maxTradesPerDay, normalParams.maxTradesPerDay)
    ),
    minAssetPct: blend(regimeParams.minAssetPct, normalParams.minAssetPct),
    maxAssetPct: blend(regimeParams.maxAssetPct, normalParams.maxAssetPct),
  };
}
