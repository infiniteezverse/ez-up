import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TradeRecord } from "./types.js";

const LEDGER_PATH = process.env.TRADES_PATH ?? "./state/trades.json";
const MAX_TRADES = 1000;

export interface TradeLedger {
  /** Initial portfolio TVL the first time the ledger was created (USD) */
  initialTvlUsd: number;
  /** Trade records, oldest first */
  trades: TradeRecord[];
}

async function load(path: string = LEDGER_PATH): Promise<TradeLedger | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as TradeLedger;
  } catch {
    return null;
  }
}

async function save(ledger: TradeLedger, path: string = LEDGER_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(ledger, null, 2), "utf-8");
}

/**
 * Append a new trade to the ledger. Computes runningPnlUsd
 * automatically as (tvlAfterUsd - initialTvlUsd). Creates the ledger
 * file on first call, seeding initialTvlUsd from the supplied
 * `currentInitialTvlUsd` parameter.
 *
 * Trims to the last MAX_TRADES entries to keep the file bounded.
 */
export async function appendTrade(params: {
  trade: Omit<TradeRecord, "runningPnlUsd">;
  /** TVL the ledger should treat as its starting point. Only used if the
   *  ledger file doesn't yet exist. Ignored on subsequent calls. */
  currentInitialTvlUsd: number;
  path?: string;
}): Promise<TradeRecord> {
  const path = params.path ?? LEDGER_PATH;
  let ledger = await load(path);
  if (!ledger) {
    ledger = { initialTvlUsd: params.currentInitialTvlUsd, trades: [] };
  }

  const runningPnlUsd = params.trade.tvlAfterUsd - ledger.initialTvlUsd;
  const fullTrade: TradeRecord = { ...params.trade, runningPnlUsd };

  ledger.trades.push(fullTrade);
  if (ledger.trades.length > MAX_TRADES) {
    ledger.trades = ledger.trades.slice(-MAX_TRADES);
  }
  await save(ledger, path);
  return fullTrade;
}

export async function readLedger(path: string = LEDGER_PATH): Promise<TradeLedger | null> {
  return load(path);
}

/** Summary stats for quick display */
export interface LedgerSummary {
  totalTrades: number;
  buyCount: number;
  sellCount: number;
  totalFeesUsd: number;
  totalVolumeUsd: number;
  realizedPnlUsd: number;
  initialTvlUsd: number;
  lastTvlUsd: number | null;
}

export function summarize(ledger: TradeLedger): LedgerSummary {
  const buyCount = ledger.trades.filter((t) => t.side === "BUY_ZEN").length;
  const sellCount = ledger.trades.filter((t) => t.side === "SELL_ZEN").length;
  const totalFeesUsd = ledger.trades.reduce((s, t) => s + t.feeUsd, 0);
  const totalVolumeUsd = ledger.trades.reduce((s, t) => s + t.notionalUsd, 0);
  const last = ledger.trades[ledger.trades.length - 1];
  return {
    totalTrades: ledger.trades.length,
    buyCount,
    sellCount,
    totalFeesUsd,
    totalVolumeUsd,
    realizedPnlUsd: last ? last.runningPnlUsd : 0,
    initialTvlUsd: ledger.initialTvlUsd,
    lastTvlUsd: last ? last.tvlAfterUsd : null,
  };
}
