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
