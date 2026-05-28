import { MarketData, AssetPair } from './types';

// DexScreener API for Base mainnet price feeds
// Base chain ID for API filtering
const BASE_CHAIN_ID = 'base';

// Token addresses on Base
const TOKEN_ADDRESSES = {
  ZEN: '0xf43eb8de897fbc7f2502483b2bef7bb9ea179229',
  ETH: '0x4200000000000000000000000000000000000006', // WETH on Base
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};

// Decimals for each token
const TOKEN_DECIMALS = {
  ZEN: 18,
  ETH: 18,
  USDC: 6,
};

interface DexScreenerPair {
  pair: string;
  baseToken: {
    address: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    symbol: string;
  };
  priceUsd: string;
  volume?: {
    h24: number;
    h1: number;
  };
  priceChange?: {
    h24: number;
    h1: number;
  };
  liquidity?: {
    usd: number;
  };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

/**
 * Fetch price feed from DexScreener for a specific token pair.
 * Queries Base network, filters by highest liquidity or volume.
 * Returns object with: priceUsd, volume24h, volume1h, dailyVol, priceChange24h
 */
async function fetchDexScreenerPrice(
  baseTokenAddr: string,
  quoteTokenAddr: string,
  assetName: string
): Promise<{
  priceUsd: number;
  volume24h: number;
  volume1h: number;
  dailyVol: number;
  priceChange24h: number;
} | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${baseTokenAddr}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      console.warn(`[price.ts] DexScreener returned ${res.status} for ${assetName}`);
      return null;
    }

    const data = (await res.json()) as DexScreenerResponse;

    if (!data.pairs || data.pairs.length === 0) {
      console.warn(`[price.ts] No pairs found for ${assetName}`);
      return null;
    }

    // Find the pair with highest liquidity (usually the most reliable)
    const pair = data.pairs.reduce((best, current) => {
      const bestLiq = best.liquidity?.usd || 0;
      const currLiq = current.liquidity?.usd || 0;
      return currLiq > bestLiq ? current : best;
    });

    const priceUsd = parseFloat(pair.priceUsd || '0');
    const volume24h = pair.volume?.h24 || 0;
    const volume1h = pair.volume?.h1 || 0;

    // Estimate daily volatility from price change (rough approximation)
    // More precise: std dev of 24h price movements (not available from DexScreener)
    // Use price change % as proxy
    const priceChange24h = pair.priceChange?.h24 ?? 0; // e.g., -0.15 for -15%
    const dailyVol = Math.abs(priceChange24h);

    return {
      priceUsd,
      volume24h,
      volume1h,
      dailyVol,
      priceChange24h,
    };
  } catch (err) {
    console.error(`[price.ts] Error fetching ${assetName} price:`, err);
    return null;
  }
}

/**
 * Fetch complete market data for ZEN/USDC pair.
 * Requires balance info (asset and USDC amounts already fetched).
 *
 * @param zenBalance Raw ZEN balance (wei/atomic units)
 * @param usdcBalance Raw USDC balance (wei/atomic units)
 */
export async function fetchMarketDataZEN(
  zenBalance: bigint,
  usdcBalance: bigint
): Promise<MarketData | null> {
  const priceData = await fetchDexScreenerPrice(
    TOKEN_ADDRESSES.ZEN,
    TOKEN_ADDRESSES.USDC,
    'ZEN'
  );

  if (!priceData) {
    console.warn('[price.ts] Could not fetch ZEN price');
    return null;
  }

  const currentPrice = priceData.priceUsd;
  const zenValueUsd = (Number(zenBalance) / 10 ** TOKEN_DECIMALS.ZEN) * currentPrice;
  const usdcValueUsd = Number(usdcBalance) / 10 ** TOKEN_DECIMALS.USDC;
  const totalValueUsd = zenValueUsd + usdcValueUsd;

  const assetValuePct = totalValueUsd > 0 ? zenValueUsd / totalValueUsd : 0;
  const usdcValuePct = totalValueUsd > 0 ? usdcValueUsd / totalValueUsd : 0;

  return {
    pair: 'ZEN_USDC',
    currentPrice,
    assetBalance: zenBalance,
    usdcBalance,
    assetValuePct,
    usdcValuePct,
    dailyVolatility: priceData.dailyVol,
    priceChange24h: priceData.priceChange24h,
    timestamp: Date.now(),
  };
}

/**
 * Fetch complete market data for ETH/USDC pair.
 * Requires balance info (asset and USDC amounts already fetched).
 *
 * @param ethBalance Raw ETH (WETH) balance (wei)
 * @param usdcBalance Raw USDC balance (wei)
 */
export async function fetchMarketDataETH(
  ethBalance: bigint,
  usdcBalance: bigint
): Promise<MarketData | null> {
  const priceData = await fetchDexScreenerPrice(
    TOKEN_ADDRESSES.ETH,
    TOKEN_ADDRESSES.USDC,
    'ETH'
  );

  if (!priceData) {
    console.warn('[price.ts] Could not fetch ETH price');
    return null;
  }

  const currentPrice = priceData.priceUsd;
  const ethValueUsd = (Number(ethBalance) / 10 ** TOKEN_DECIMALS.ETH) * currentPrice;
  const usdcValueUsd = Number(usdcBalance) / 10 ** TOKEN_DECIMALS.USDC;
  const totalValueUsd = ethValueUsd + usdcValueUsd;

  const assetValuePct = totalValueUsd > 0 ? ethValueUsd / totalValueUsd : 0;
  const usdcValuePct = totalValueUsd > 0 ? usdcValueUsd / totalValueUsd : 0;

  return {
    pair: 'ETH_USDC',
    currentPrice,
    assetBalance: ethBalance,
    usdcBalance,
    assetValuePct,
    usdcValuePct,
    dailyVolatility: priceData.dailyVol,
    priceChange24h: priceData.priceChange24h,
    timestamp: Date.now(),
  };
}

/**
 * Batch fetch market data for both ZEN and ETH (parallel).
 * Used in main loop to get snapshot of both pairs at same timestamp.
 */
export async function fetchMarketDataBatch(
  zenBalance: bigint,
  ethBalance: bigint,
  usdcBalance: bigint // Shared across both pairs
): Promise<{
  zen: MarketData | null;
  eth: MarketData | null;
}> {
  const [zenData, ethData] = await Promise.all([
    fetchMarketDataZEN(zenBalance, usdcBalance),
    fetchMarketDataETH(ethBalance, usdcBalance),
  ]);

  return { zen: zenData, eth: ethData };
}

/**
 * Fetch fallback prices (used if DexScreener fails).
 * Returns hardcoded defaults; ensures bot doesn't crash mid-tick.
 */
export function getFallbackPrices(): {
  zenPrice: number;
  ethPrice: number;
} {
  return {
    zenPrice: 6.02,
    ethPrice: 3500,
  };
}
