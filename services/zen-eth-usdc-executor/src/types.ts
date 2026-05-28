// V2 State Schema & Type Definitions for 3-Asset Phase Executor

export type AssetPair = "ZEN_USDC" | "ETH_USDC";
export type TradeAction = "HOLD" | "BUY" | "SELL";

// Per-pair state snapshot
export interface PairState {
  entryPrice: number;                    // Baseline for bracket calculations
  lastCycleHigh: number;                 // High water mark for downside brackets
  lastTradeTimestamp: number;            // Unix ms; used for 72h amnesia check
  tradesToday: number;                   // Count within current UTC day
  lastTradeDay: number;                  // YYYYMMDD key
  totalTrades: number;                   // Lifetime
  totalVolumeUsd: number;                // Lifetime notional

  // Tier state for two-tick confirmation
  lastDecisionAction?: TradeAction;
  lastDecisionTier?: number;

  // Opening day P&L tracking
  openingDayAssetValue: number;          // Asset value at day start
  openingDayUsdcValue: number;           // USDC value at day start
  dayOpenedKey: number;
}

// Global state (shared across pairs)
export interface GlobalState {
  lastPnlCheckTimestamp: number;
  dailyDrawdownPercent: number;          // Current day's peak-to-trough
  peakDailyValue: number;                // Highest portfolio value seen today
}

// V2 State file structure
export interface BotStateV2 {
  version: "2.0";
  global: GlobalState;
  pairs: {
    ZEN_USDC: PairState;
    ETH_USDC: PairState;
  };
}

// Market data for a pair
export interface MarketData {
  pair: AssetPair;
  currentPrice: number;                  // Asset price in USDC
  assetBalance: bigint;                  // Raw wei/units
  usdcBalance: bigint;                   // Raw wei/units
  assetValuePct: number;                 // 0..1
  usdcValuePct: number;                  // 0..1
  dailyVolatility: number;               // Realized 24h volatility %
  priceChange24h: number;                // -1..1 (e.g., -0.15 = -15%)
  timestamp: number;                     // Unix ms
}

// Trade decision
export interface TradeDecision {
  action: TradeAction;
  pair: AssetPair;
  percentOfAsset: number;                // Fraction to trade (0..1)
  tier?: number;                         // Bracket tier if applicable
  notionalUsd?: number;                  // Estimated USD value
  reason: string;
  alphaDepth?: number;                   // For priority ranking
}

// Execution result
export interface ExecutionResult {
  status: "success" | "failed" | "skipped" | "aborted";
  pair: AssetPair;
  txHash?: string;
  buyAmount?: string;
  routingEngine?: string;
  slippageBps?: number;
  error?: string;
  timestamp: number;
}

// Volatility metrics (from 90-day lookback)
export interface VolatilityMetrics {
  pair: AssetPair;
  realized90dVol: number;                // Annualized volatility 0..1
  tierMultiplier: number;                // Adjustment factor (e.g., 1.2 = widen tiers by 20%)
  lastUpdated: number;                   // Unix ms
}

// Config for a pair's execution parameters
export interface PairConfig {
  pair: AssetPair;
  assetDecimals: number;
  minNotionalUsd: number;
  minAssetPct: number;                   // e.g., 0.30 = 30% floor
  maxAssetPct: number;                   // e.g., 0.70 = 70% ceiling

  // Bracket tiers (base; adjusted by 90-day volatility)
  upsideBrackets: number[];              // e.g., [0.02, 0.04, 0.06, 0.08]
  downsideBrackets: number[];            // e.g., [-0.02, -0.04, -0.06, -0.08]
  upsideSlices: number[];                // e.g., [0.05, 0.05, 0.10, 0.15]
  downsideSlices: number[];              // e.g., [0.05, 0.05, 0.10, 0.15]

  // Safety thresholds
  maxTradesPerDay: number;
  minTradeIntervalMs: number;
  trendFilterThreshold: number;          // e.g., 0.15 = 15%
  dailyPnlStopPercent: number;           // e.g., -0.10 = stop buys if down 10%

  // 72h amnesia gate
  amnesiaDurationMs: number;             // e.g., 72 * 60 * 60 * 1000
}

// Historic trade record (for 90-day lookback)
export interface TradeRecord {
  timestamp: number;
  pair: AssetPair;
  action: "BUY" | "SELL";
  priceUsd: number;
  amountAsset: number;
  slippageBps: number;
}

// ============ MARKET REGIME & PROFIT-TAKING TYPES ============

// Market regime detection result
export type MarketRegime = 'CALM' | 'NORMAL' | 'CHOPPY' | 'TRENDING';

// Position tranche for layered profit-taking
export interface PositionTranche {
  trancheId: string;
  quantity: bigint;                        // Amount of asset
  entryPrice: number;                      // Purchase price
  entryTimestamp: number;
  profitTarget: number;                    // Profit % to exit (0.02 = 2%)
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  exitTimestamp?: number;
  realizedPnL?: number;                    // In USD
}

// Enhanced pair state with tranche tracking
export interface EnhancedPairState extends PairState {
  marketRegime?: MarketRegime;              // Current market regime
  regimeConfidence?: number;                // Confidence in regime detection (0-1)
  activeTransches?: PositionTranche[];      // Layered positions
  realizedDayPnL?: number;                  // Daily P&L from closed tranches
}

// Enhanced trade decision with tranche info
export interface EnhancedTradeDecision extends TradeDecision {
  tranches?: PositionTranche[];             // Profit-taking layers
  dynamicBrackets?: number[];               // Regime-adjusted brackets
  regimeAdjustment?: {
    regime: MarketRegime;
    confidence: number;
    rationale: string;
  };
}
