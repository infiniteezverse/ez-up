import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const HISTORY_PATH = process.env.HISTORY_PATH ?? "./state/history.json";
const MAX_ENTRIES = 90; // keep ~3 months rolling window

export interface HistoryEntry {
  date: string;          // YYYY-MM-DD (UTC)
  tvlUsd: number;        // total portfolio value at snapshot
  zenAmount: number;     // human-readable ZEN balance
  usdcAmount: number;    // human-readable USDC balance
  zenPriceUsd: number;   // ZEN price at snapshot
  zenPct: number;        // 0..1
  usdcPct: number;       // 0..1
  totalTrades: number;   // lifetime trades at snapshot time
}

export interface History {
  entries: HistoryEntry[];
}

function toDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function loadHistory(): Promise<History> {
  try {
    const raw = await readFile(HISTORY_PATH, "utf-8");
    return JSON.parse(raw) as History;
  } catch {
    return { entries: [] };
  }
}

async function saveHistory(history: History): Promise<void> {
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
}

/**
 * Append (or replace today's) snapshot to history.json.
 * Idempotent for a given UTC date — re-running on the same day overwrites.
 */
export async function recordSnapshot(params: {
  now: number;
  zenAmount: number;
  usdcAmount: number;
  zenPriceUsd: number;
  totalTrades: number;
}): Promise<void> {
  const { now, zenAmount, usdcAmount, zenPriceUsd, totalTrades } = params;
  const dateKey = toDateKey(now);
  const zenValueUsd = zenAmount * zenPriceUsd;
  const tvlUsd = zenValueUsd + usdcAmount;

  const entry: HistoryEntry = {
    date: dateKey,
    tvlUsd,
    zenAmount,
    usdcAmount,
    zenPriceUsd,
    zenPct: tvlUsd > 0 ? zenValueUsd / tvlUsd : 0,
    usdcPct: tvlUsd > 0 ? usdcAmount / tvlUsd : 0,
    totalTrades,
  };

  const history = await loadHistory();
  const existingIdx = history.entries.findIndex((e) => e.date === dateKey);
  if (existingIdx >= 0) {
    history.entries[existingIdx] = entry;
  } else {
    history.entries.push(entry);
  }

  // Trim rolling window
  if (history.entries.length > MAX_ENTRIES) {
    history.entries = history.entries.slice(-MAX_ENTRIES);
  }

  await saveHistory(history);
}
