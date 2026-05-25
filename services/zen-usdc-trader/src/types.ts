export interface BotState {
  entryPrice: number;
  lastCycleHigh: number;
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
  /** Which direction */
  side: "SELL_ZEN" | "BUY_ZEN";
  /** Bracket tier that triggered (1-4) */
  tier: number;
  /** Reference price at decision time (entry for upside, cycle high for downside) */
  baselinePrice: number;
  /** Price seen on this tick (decision price) */
  decisionPrice: number;
  /** Amount of ZEN moved in this trade (human units, positive) */
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
  /** Portfolio TVL immediately after the trade */
  tvlAfterUsd: number;
  /** Cumulative realized P&L since bot start (TVL_after - initialTvl, accumulated) */
  runningPnlUsd: number;
  /** ZEN % of portfolio after the trade */
  zenPctAfter: number;
}
