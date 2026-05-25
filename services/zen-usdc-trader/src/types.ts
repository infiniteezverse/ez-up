/**
 * Each PairConfig describes a single volatile/stable trading pair the bot
 * operates on. All strategy parameters (brackets, slices) are per-pair so
 * we can tune each pair to its own volatility profile.
 *
 * Naming note: the action enum SELL_ZEN/BUY_ZEN is legacy — it now means
 * "sell volatile token / buy volatile token" generically across pairs.
 * Each pair's actual volatile symbol comes from PairConfig.symbol.
 */
export interface PairConfig {
  /** Stable identifier used as the state-map key (e.g., "ZEN/USDC") */
  name: string;
  /** Display symbol of the volatile token (e.g., "ZEN", "ETH") */
  symbol: string;
  /** Volatile token contract address on Base */
  tokenAddress: `0x${string}`;
  /** Volatile token decimals */
  tokenDecimals: number;
  /** DexScreener / EZ Path pool address used for price + liquidity */
  poolAddress: `0x${string}`;
  /** Fraction of total treasury allocated to this pair (e.g., 0.5 = 50%) */
  weightOfTreasury: number;
  /** Per-pair strategy config */
  strategy: Config;
}

export interface BotState {
  entryPrice: number;
  lastCycleHigh: number;
  /** Unix ms when entryPrice/lastCycleHigh were last set (init, trade, or 72h decay) */
  entryPriceSetAt: number;
  lastTradeAt: number;
  tradesToday: number;
  lastTradeDay: number;
  totalTrades: number;
  totalVolumeUsd: number;
  // Safeguards
  lastDecisionAction: "HOLD" | "SELL_ZEN" | "BUY_ZEN";
  lastDecisionTier?: number;
  openingDayZenValueUsd: number;
  openingDayUsdcValueUsd: number;
  dayOpenedKey: number;
}

/** Top-level state file shape: keyed by PairConfig.name */
export interface MultiPairBotState {
  /** Schema version for forward compat */
  version: number;
  pairs: Record<string, BotState>;
}

export interface MarketData {
  currentPrice: number;
  zenBalance: bigint;
  usdcBalance: bigint;
  zenValuePct: number;
  usdcValuePct: number;
  dailyVol?: number;
  hourlyVolumeUsd?: number;
  dailyVolumeUsd?: number;
}

export interface TradeAction {
  action: "HOLD" | "SELL_ZEN" | "BUY_ZEN";
  percentOfAsset: number;
  reason: string;
  tier?: number;
  notionalUsd?: number;
}

export interface Config {
  minZenPct: number;
  maxZenPct: number;
  minTradeNotional: number;
  minTradeIntervalMs: number;
  maxTradesPerDay: number;
  upsideBrackets: number[];
  downsideBrackets: number[];
  upsideSlices: number[];
  downsideSlices: number[];
  enableVolFilter?: boolean;
  minDailyVol?: number;
  enableVolumeFilter?: boolean;
  minVolumeRatio?: number;
  /** If false, trades fire immediately on first bracket hit (no 2-tick wait).
   *  Default: true (safer; filters wicks). EZ Path multi-venue routing already
   *  protects against front-running/MEV, so wicks are the only remaining risk. */
  twoTickConfirmation?: boolean;
  /** Reset entryPrice/lastCycleHigh to spot if more than this many ms elapsed
   *  since last set (no recent trade). Prevents zombie baselines during quiet
   *  periods. Default: 72h = 259200000 ms. Set to 0 to disable. */
  referenceResetWindowMs?: number;
  /** Max acceptable estimated slippage as a FRACTION of the target bracket
   *  size (e.g., 0.25 = abort if slippage > 25% of bracket). Default 0.25.
   *  Set to 0 to disable. */
  maxSlippageFractionOfBracket?: number;
}

export interface ExecutionResult {
  status: "success" | "failed" | "skipped";
  txHash?: string;
  buyAmount?: string;
  routingEngine?: string;
  error?: string;
}

/** A single executed trade — the unit of record in trades.json */
export interface TradeRecord {
  /** Monotonic ID (totalTrades counter at time of execution) */
  id: number;
  /** Unix ms when the trade executed */
  timestamp: number;
  /** Which trading pair (matches PairConfig.name) */
  pair: string;
  /** Which direction. SELL_ZEN/BUY_ZEN are legacy names meaning sell/buy volatile token */
  side: "SELL_ZEN" | "BUY_ZEN";
  /** Bracket tier that triggered (1-N) */
  tier: number;
  /** Reference price at decision time (entry for upside, cycle high for downside) */
  baselinePrice: number;
  /** Price seen on this tick (decision price) */
  decisionPrice: number;
  /** Amount of volatile token moved in this trade (human units, positive) */
  zenAmount: number;
  /** Amount of USDC moved in this trade (human units, positive) */
  usdcAmount: number;
  /** EZ-Path fee paid in USD (basic tier = 0.03) */
  feeUsd: number;
  /** Notional value in USD at decision price */
  notionalUsd: number;
  /** Settlement tx hash on Base */
  txHash?: string;
  /** Which EZ-Path routing engine won (0x, paraswap, aerodrome, uniswapv3) */
  routingEngine?: string;
  /** Portfolio TVL immediately after the trade (this pair's slice only) */
  tvlAfterUsd: number;
  /** Cumulative realized P&L since bot start (TVL_after - initialTvl, accumulated) */
  runningPnlUsd: number;
  /** Volatile-token % of this pair's slice after the trade */
  zenPctAfter: number;
}
