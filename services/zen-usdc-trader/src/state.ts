import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BotState } from "./types.js";

const STATE_PATH = process.env.STATE_PATH ?? "./state/bot-state.json";

export async function loadState(): Promise<BotState | null> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw) as BotState;
  } catch {
    return null;
  }
}

export async function saveState(state: BotState): Promise<void> {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function initialState(currentPrice: number, now: number, openingZenValueUsd: number = 0, openingUsdcValueUsd: number = 0): BotState {
  const today = new Date(now);
  const dayKey = today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
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
