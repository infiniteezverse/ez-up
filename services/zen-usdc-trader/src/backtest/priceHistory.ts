import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// Aerodrome ZEN/USDC pool on Base (top by 24h volume per DexScreener)
export const DEFAULT_POOL = "0x0392B12a1cEb0cd13af5Ea448CF5586EA609852D";
export const NETWORK = "base";

const CACHE_PATH = "./state/price-history.json";

// Geckoterminal returns up to 1000 bars per request, newest-first.
// Hourly bars => 1000 hours ≈ 41 days per request.
// For 90 days we need ~2 requests stitched together.
const GT_BASE = "https://api.geckoterminal.com/api/v2";
const MAX_LIMIT_PER_REQUEST = 1000;

export interface OhlcvBar {
  /** Unix timestamp in seconds (bar START time, UTC) */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume in pair's quote token units (USD for USDC-quoted pools) */
  volume: number;
}

export interface PriceHistory {
  pool: string;
  network: string;
  timeframe: "minute" | "hour" | "day";
  bars: OhlcvBar[];
  fetchedAt: number;
}

interface GtResponse {
  data?: {
    attributes?: {
      ohlcv_list?: number[][];
    };
  };
}

/**
 * Fetch a single page of OHLCV from Geckoterminal.
 * `beforeTimestamp` (seconds) - returns bars with ts < beforeTimestamp.
 */
async function fetchPage(
  pool: string,
  timeframe: "minute" | "hour" | "day",
  limit: number,
  beforeTimestamp?: number
): Promise<OhlcvBar[]> {
  const params = new URLSearchParams({ limit: String(limit), aggregate: "1" });
  if (beforeTimestamp) params.set("before_timestamp", String(beforeTimestamp));

  const url = `${GT_BASE}/networks/${NETWORK}/pools/${pool}/ohlcv/${timeframe}?${params.toString()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Geckoterminal ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as GtResponse;
  const list = json.data?.attributes?.ohlcv_list ?? [];

  // GT returns newest-first; each row is [ts, o, h, l, c, v]
  return list.map((r) => ({
    ts: r[0],
    open: r[1],
    high: r[2],
    low: r[3],
    close: r[4],
    volume: r[5],
  }));
}

/**
 * Fetch up to `days` worth of OHLCV bars from Geckoterminal, stitching
 * multiple pages if needed. Returns bars sorted oldest -> newest.
 */
export async function fetchPriceHistory(opts: {
  pool?: string;
  timeframe?: "minute" | "hour" | "day";
  days: number;
}): Promise<PriceHistory> {
  const pool = opts.pool ?? DEFAULT_POOL;
  const timeframe = opts.timeframe ?? "hour";
  const barsPerDay = timeframe === "minute" ? 1440 : timeframe === "hour" ? 24 : 1;
  const wantedBars = Math.ceil(opts.days * barsPerDay);

  const collected = new Map<number, OhlcvBar>();
  let cursor: number | undefined = undefined;
  let attempts = 0;
  const maxAttempts = Math.ceil(wantedBars / MAX_LIMIT_PER_REQUEST) + 2;

  while (collected.size < wantedBars && attempts < maxAttempts) {
    const limit = Math.min(MAX_LIMIT_PER_REQUEST, wantedBars - collected.size + 50);
    const page = await fetchPage(pool, timeframe, limit, cursor);
    if (page.length === 0) break;

    for (const bar of page) {
      collected.set(bar.ts, bar);
    }

    // Next page: go further back in time from the oldest bar in this page
    const oldest = page.reduce((a, b) => (a.ts < b.ts ? a : b));
    if (cursor !== undefined && oldest.ts >= cursor) break; // no progress
    cursor = oldest.ts;
    attempts += 1;

    // Be polite to the free API
    await new Promise((r) => setTimeout(r, 350));
  }

  const bars = [...collected.values()]
    .sort((a, b) => a.ts - b.ts)
    .slice(-wantedBars); // trim to requested window

  return {
    pool,
    network: NETWORK,
    timeframe,
    bars,
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

export async function saveCache(history: PriceHistory, path: string = CACHE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(history, null, 2), "utf-8");
}

export async function loadCache(path: string = CACHE_PATH): Promise<PriceHistory | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as PriceHistory;
  } catch {
    return null;
  }
}

/**
 * Load from cache if fresh enough (default: 6 hours), otherwise fetch and cache.
 */
export async function loadOrFetch(opts: {
  pool?: string;
  timeframe?: "minute" | "hour" | "day";
  days: number;
  maxCacheAgeSec?: number;
  cachePath?: string;
}): Promise<PriceHistory> {
  const maxAge = opts.maxCacheAgeSec ?? 6 * 3600;
  const path = opts.cachePath ?? CACHE_PATH;
  const cached = await loadCache(path);
  if (cached) {
    const age = Math.floor(Date.now() / 1000) - cached.fetchedAt;
    const matchesShape =
      cached.pool === (opts.pool ?? DEFAULT_POOL) &&
      cached.timeframe === (opts.timeframe ?? "hour");
    if (matchesShape && age < maxAge && cached.bars.length > 0) {
      const days = (cached.bars[cached.bars.length - 1].ts - cached.bars[0].ts) / 86400;
      if (days >= opts.days * 0.9) return cached;
    }
  }
  const fresh = await fetchPriceHistory(opts);
  await saveCache(fresh, path);
  return fresh;
}
