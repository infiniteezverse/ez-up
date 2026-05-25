import type { PairConfig } from "./types.js";

interface DexScreenerPair {
  priceUsd: string;
  pairAddress?: string;
  volume?: { h24?: number; h1?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

export interface PriceFeed {
  priceUsd: number;
  volume24hUsd: number;
  volume1hUsd: number;
  dailyVol: number;
  priceChange24h?: number;
  /** Total pool liquidity in USD (both sides combined) — used for slippage estimation */
  liquidityUsd?: number;
  /** Address of the pool we sourced the price from */
  poolAddress?: string;
}

/**
 * Fetch live price + pool liquidity for a given pair. Prefers the pool address
 * configured on the PairConfig (so price and slippage estimate use the same pool);
 * falls back to highest-volume pair on the token if the configured pool isn't returned.
 */
export async function fetchPairPrice(pair: PairConfig): Promise<PriceFeed> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${pair.tokenAddress}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DexScreener fetch failed for ${pair.symbol}: ${response.status}`);
  }
  const data = (await response.json()) as DexScreenerResponse;
  if (!data.pairs || data.pairs.length === 0) {
    throw new Error(`No ${pair.symbol} pairs found on DexScreener`);
  }

  const basePairs = data.pairs.filter((p) => p.priceUsd && parseFloat(p.priceUsd) > 0);
  if (basePairs.length === 0) {
    throw new Error(`No valid ${pair.symbol} price pairs`);
  }

  // Prefer the configured pool; fall back to highest volume
  let chosen =
    basePairs.find(
      (p) => p.pairAddress?.toLowerCase() === pair.poolAddress.toLowerCase()
    ) ?? basePairs.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))[0];

  const priceChange24h = (chosen.priceChange?.h24 ?? 0) / 100;
  return {
    priceUsd: parseFloat(chosen.priceUsd),
    volume24hUsd: chosen.volume?.h24 ?? 0,
    volume1hUsd: chosen.volume?.h1 ?? 0,
    dailyVol: Math.abs(priceChange24h),
    priceChange24h,
    liquidityUsd: chosen.liquidity?.usd,
    poolAddress: chosen.pairAddress,
  };
}

// Backward-compatible alias for legacy callers (ZEN-only)
import { ZEN_USDC_PAIR } from "./config.js";
export async function fetchZenPrice(): Promise<PriceFeed> {
  return fetchPairPrice(ZEN_USDC_PAIR);
}
