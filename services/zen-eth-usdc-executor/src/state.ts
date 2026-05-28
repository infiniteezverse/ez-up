import fs from 'fs';
import path from 'path';
import { BotStateV2, PairState, GlobalState, AssetPair } from './types';

// V2 state file path (relative to project root)
const STATE_FILE = path.join(process.cwd(), 'state', 'v2-state.json');

/**
 * Initialize default empty pair state.
 * Called on first bot run or after 72h amnesia reset.
 */
function defaultPairState(): PairState {
  const now = Date.now();
  const todayKey = Math.floor(now / (24 * 60 * 60 * 1000));

  return {
    entryPrice: 0,
    lastCycleHigh: 0,
    lastTradeTimestamp: 0,
    tradesToday: 0,
    lastTradeDay: todayKey,
    totalTrades: 0,
    totalVolumeUsd: 0,
    openingDayAssetValue: 0,
    openingDayUsdcValue: 0,
    dayOpenedKey: todayKey,
  };
}

/**
 * Initialize default global state.
 */
function defaultGlobalState(): GlobalState {
  return {
    lastPnlCheckTimestamp: Date.now(),
    dailyDrawdownPercent: 0,
    peakDailyValue: 0,
  };
}

/**
 * Initialize complete V2 bot state (fresh or on first run).
 */
function defaultBotStateV2(): BotStateV2 {
  return {
    version: '2.0',
    global: defaultGlobalState(),
    pairs: {
      ZEN_USDC: defaultPairState(),
      ETH_USDC: defaultPairState(),
    },
  };
}

/**
 * Load V2 bot state from disk.
 * Returns existing state or fresh defaults if file doesn't exist.
 * Validates schema version to prevent legacy V1 state issues.
 */
export function loadStateV2(): BotStateV2 {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      console.log('[state.ts] No existing state file — initializing fresh');
      return defaultBotStateV2();
    }

    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw) as BotStateV2;

    // Validate version
    if (!state.version || state.version !== '2.0') {
      console.warn('[state.ts] Unexpected version:', state.version, '— reinitializing');
      return defaultBotStateV2();
    }

    // Ensure both pairs exist (migrate if needed)
    if (!state.pairs.ZEN_USDC) state.pairs.ZEN_USDC = defaultPairState();
    if (!state.pairs.ETH_USDC) state.pairs.ETH_USDC = defaultPairState();

    return state;
  } catch (err) {
    console.error('[state.ts] Error loading state:', err);
    return defaultBotStateV2();
  }
}

/**
 * Save V2 bot state to disk.
 * Creates state/ directory if it doesn't exist.
 */
export function saveStateV2(state: BotStateV2): void {
  try {
    const stateDir = path.dirname(STATE_FILE);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log('[state.ts] State saved');
  } catch (err) {
    console.error('[state.ts] Error saving state:', err);
  }
}

/**
 * Check if a pair's 72h amnesia gate has expired.
 * Returns true if lastTradeTimestamp is older than amnesiaDurationMs.
 * Used to reset bracket state for a pair (allows re-entry after big moves).
 */
export function hasAmnesia(
  pairState: PairState,
  amnesiaDurationMs: number,
  nowMs: number = Date.now()
): boolean {
  if (pairState.lastTradeTimestamp === 0) return false; // No trades yet
  return nowMs - pairState.lastTradeTimestamp > amnesiaDurationMs;
}

/**
 * Reset a pair's bracket state after amnesia gate expires.
 * Clears entryPrice, lastCycleHigh, lastDecisionAction/Tier, tradesToday.
 * Preserves lifetime stats (totalTrades, totalVolumeUsd).
 */
export function resetPairAmnesia(pairState: PairState, nowMs: number = Date.now()): PairState {
  const todayKey = Math.floor(nowMs / (24 * 60 * 60 * 1000));

  return {
    ...pairState,
    entryPrice: 0,
    lastCycleHigh: 0,
    lastDecisionAction: undefined,
    lastDecisionTier: undefined,
    tradesToday: 0,
    lastTradeDay: todayKey,
    lastTradeTimestamp: 0, // Reset timer
    openingDayAssetValue: 0,
    openingDayUsdcValue: 0,
    dayOpenedKey: todayKey,
  };
}

/**
 * Check if a new UTC day has started (for daily trade count reset).
 * Returns true if lastTradeDay differs from current day key.
 */
export function isNewDay(pairState: PairState, nowMs: number = Date.now()): boolean {
  const todayKey = Math.floor(nowMs / (24 * 60 * 60 * 1000));
  return pairState.lastTradeDay !== todayKey;
}

/**
 * Reset daily trade count and opening balances at start of new day.
 * Called once per pair at UTC midnight (or on first tick of new day).
 */
export function resetDailyMetrics(
  pairState: PairState,
  assetValue: number,
  usdcValue: number,
  nowMs: number = Date.now()
): PairState {
  const todayKey = Math.floor(nowMs / (24 * 60 * 60 * 1000));

  return {
    ...pairState,
    tradesToday: 0,
    lastTradeDay: todayKey,
    openingDayAssetValue: assetValue,
    openingDayUsdcValue: usdcValue,
    dayOpenedKey: todayKey,
  };
}

/**
 * Record a trade in pair state.
 * Updates: lastTradeTimestamp, tradesToday, totalTrades, totalVolumeUsd, lastDecisionAction/Tier.
 */
export function recordTrade(
  pairState: PairState,
  action: 'BUY' | 'SELL',
  notionalUsd: number,
  tier: number | undefined,
  nowMs: number = Date.now()
): PairState {
  return {
    ...pairState,
    lastTradeTimestamp: nowMs,
    tradesToday: pairState.tradesToday + 1,
    totalTrades: pairState.totalTrades + 1,
    totalVolumeUsd: pairState.totalVolumeUsd + notionalUsd,
    lastDecisionAction: action,
    lastDecisionTier: tier,
  };
}

/**
 * Update entry price and cycle high at trade execution.
 * Entry price is set once per bracket cycle; high water mark updated on each trade.
 */
export function updateEntryAndHigh(
  pairState: PairState,
  currentPrice: number
): PairState {
  let newEntryPrice = pairState.entryPrice || currentPrice;
  let newCycleHigh = pairState.lastCycleHigh || currentPrice;

  // Update high water mark
  if (currentPrice > newCycleHigh) {
    newCycleHigh = currentPrice;
  }

  return {
    ...pairState,
    entryPrice: newEntryPrice,
    lastCycleHigh: newCycleHigh,
  };
}

/**
 * Update global state metrics (shared across pairs).
 * Used to track portfolio-level P&L and drawdown.
 */
export function updateGlobalState(
  globalState: GlobalState,
  currentPortfolioValue: number,
  nowMs: number = Date.now()
): GlobalState {
  // Track peak portfolio value seen today
  const peakDailyValue = Math.max(globalState.peakDailyValue || currentPortfolioValue, currentPortfolioValue);

  // Calculate daily drawdown: (peak - current) / peak
  let dailyDrawdownPercent = 0;
  if (peakDailyValue > 0) {
    dailyDrawdownPercent = Math.max(0, (peakDailyValue - currentPortfolioValue) / peakDailyValue);
  }

  return {
    lastPnlCheckTimestamp: nowMs,
    dailyDrawdownPercent,
    peakDailyValue,
  };
}

/**
 * Reset daily portfolio metrics at start of new day.
 * Clears peak value and drawdown; used for daily P&L stop tracking.
 */
export function resetDailyPnLMetrics(
  globalState: GlobalState,
  currentPortfolioValue: number,
  nowMs: number = Date.now()
): GlobalState {
  return {
    lastPnlCheckTimestamp: nowMs,
    dailyDrawdownPercent: 0,
    peakDailyValue: currentPortfolioValue,
  };
}
