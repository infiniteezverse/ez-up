import { ZEN_ADDRESS } from "./config.js";

interface DexScreenerPair {
  priceUsd: string;
  volume?: { h24?: number; h1?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  pairAddress?: string;
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

export async function fetchZenPrice(): Promise<PriceFeed> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${ZEN_ADDRESS}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DexScreener fetch failed: ${response.status}`);
  }
  const data = (await response.json()) as DexScreenerResponse;
  if (!data.pairs || data.pairs.length === 0) {
    throw new Error("No ZEN pairs found on DexScreener");
  }

  const basePairs = data.pairs.filter(
    (p) => p.priceUsd && parseFloat(p.priceUsd) > 0
  );
  if (basePairs.length === 0) {
    throw new Error("No valid ZEN price pairs");
  }

  const topPair = basePairs.sort(
    (a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0)
  )[0];

  const priceChange24h = (topPair.priceChange?.h24 ?? 0) / 100;
  return {
    priceUsd: parseFloat(topPair.priceUsd),
    volume24hUsd: topPair.volume?.h24 ?? 0,
    volume1hUsd: topPair.volume?.h1 ?? 0,
    dailyVol: Math.abs(priceChange24h),
    priceChange24h,
    liquidityUsd: topPair.liquidity?.usd,
    poolAddress: topPair.pairAddress,
  };
}
