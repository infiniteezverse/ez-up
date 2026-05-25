import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BotState, MultiPairBotState } from "./types.js";

const STATE_PATH = process.env.STATE_PATH ?? "./state/bot-state.json";
const SCHEMA_VERSION = 2;

/** Per-pair state operations. The state file is a JSON object keyed by pair name. */

export async function loadAllState(): Promise<MultiPairBotState | null> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    // v2 (multi-pair) shape: { version: 2, pairs: { 'ZEN/USDC': {...} } }
    if (parsed && parsed.version === SCHEMA_VERSION && parsed.pairs) {
      return parsed as MultiPairBotState;
    }

    // v1 (legacy single-pair) shape: just the BotState fields at top level.
    // Migrate by wrapping under ZEN/USDC.
    if (parsed && typeof parsed.entryPrice === "number") {
      const migrated: MultiPairBotState = {
        version: SCHEMA_VERSION,
        pairs: { "ZEN/USDC": parsed as BotState },
      };
      return migrated;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveAllState(state: MultiPairBotState): Promise<void> {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function initialPairState(
  currentPrice: number,
  now: number,
  openingZenValueUsd: number = 0,
  openingUsdcValueUsd: number = 0
): BotState {
  const today = new Date(now);
  const dayKey =
    today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
  return {
    entryPrice: currentPrice,
    lastCycleHigh: currentPrice,
    entryPriceSetAt: now,
    lastTradeAt: 0,
    tradesToday: 0,
    lastTradeDay: dayKey,
    totalTrades: 0,
    totalVolumeUsd: 0,
    lastDecisionAction: "HOLD",
    lastDecisionTier: undefined,
    openingDayZenValueUsd: openingZenValueUsd,
    openingDayUsdcValueUsd: openingUsdcValueUsd,
    dayOpenedKey: dayKey,
  };
}

export function initialAllState(): MultiPairBotState {
  return { version: SCHEMA_VERSION, pairs: {} };
}

// === Legacy compatibility wrappers (used by older callers; will retire) ===
export async function loadState(): Promise<BotState | null> {
  const all = await loadAllState();
  if (!all) return null;
  return all.pairs["ZEN/USDC"] ?? null;
}

export async function saveState(state: BotState): Promise<void> {
  const all = (await loadAllState()) ?? initialAllState();
  all.pairs["ZEN/USDC"] = state;
  await saveAllState(all);
}

export function initialState(
  currentPrice: number,
  now: number,
  openingZenValueUsd: number = 0,
  openingUsdcValueUsd: number = 0
): BotState {
  return initialPairState(currentPrice, now, openingZenValueUsd, openingUsdcValueUsd);
}
