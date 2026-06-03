import { MarketData, AssetPair } from './types';
import { ethers } from 'ethers';

// DexScreener API for Base mainnet price feeds
// Base chain ID for API filtering
const BASE_CHAIN_ID = 'base';

// RPC provider for on-chain price fetching
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const rpcProvider = new ethers.JsonRpcProvider(BASE_RPC);

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

// Uniswap V2 on Base
const UNISWAP_V2 = {
  FACTORY: '0x8909Dc15e40EB4B8e6f7726AE55D432e5f81F138',
  PAIR_ABI: ['function getReserves() public view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'],
};

// Fallback price cache (for resilience)
let lastZENPrice = 5.87;
let lastETHPrice = 2009.61;

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
 * Fetch ZEN price directly from Uniswap V2 pool (deterministic, on-chain)
 * This is the primary source for ZEN pricing to avoid API dependency
 */
async function fetchZENPriceFromUniswap(): Promise<number | null> {
  try {
    // Try ZEN/USDC pool first (most direct pricing)
    const poolAddress = await getUniswapPoolAddress(TOKEN_ADDRESSES.ZEN, TOKEN_ADDRESSES.USDC);

    if (!poolAddress || poolAddress === ethers.ZeroAddress) {
      console.warn('[price.ts] ZEN/USDC pool not found on Uniswap V2');
      // Try ZEN/ETH as fallback
      return await fetchZENPriceViaETH();
    }

    // Get reserves from pool
    const pool = new ethers.Contract(
      poolAddress,
      UNISWAP_V2.PAIR_ABI,
      rpcProvider
    );

    const [reserve0, reserve1] = await pool.getReserves();

    // Determine token order - need to check which is ZEN
    // For now assume ZEN is token0, USDC is token1
    const zenReserve = ethers.formatUnits(reserve0, TOKEN_DECIMALS.ZEN);
    const usdcReserve = ethers.formatUnits(reserve1, TOKEN_DECIMALS.USDC);

    const priceInUSDC = parseFloat(usdcReserve) / parseFloat(zenReserve);

    console.log(`[price.ts] ✓ ZEN price from Uniswap V2: $${priceInUSDC.toFixed(2)}`);
    lastZENPrice = priceInUSDC;
    return priceInUSDC;
  } catch (err) {
    console.warn(`[price.ts] Uniswap pool fetch failed for ZEN:`, err);
    return null;
  }
}

/**
 * Fallback: Fetch ZEN price via ETH (if ZEN/USDC pool doesn't exist)
 * Uses ZEN/ETH pool then multiplies by ETH/USD price
 */
async function fetchZENPriceViaETH(): Promise<number | null> {
  try {
    const poolAddress = await getUniswapPoolAddress(TOKEN_ADDRESSES.ZEN, TOKEN_ADDRESSES.ETH);

    if (!poolAddress || poolAddress === ethers.ZeroAddress) {
      console.warn('[price.ts] ZEN/ETH pool also not found');
      return null;
    }

    const pool = new ethers.Contract(
      poolAddress,
      UNISWAP_V2.PAIR_ABI,
      rpcProvider
    );

    const [reserve0, reserve1] = await pool.getReserves();
    const zenReserve = ethers.formatUnits(reserve0, TOKEN_DECIMALS.ZEN);
    const ethReserve = ethers.formatUnits(reserve1, TOKEN_DECIMALS.ETH);

    const ethPerZen = parseFloat(ethReserve) / parseFloat(zenReserve);
    const ethPriceUSD = lastETHPrice; // Use last known ETH price

    const priceInUSDC = ethPerZen * ethPriceUSD;

    console.log(`[price.ts] ✓ ZEN price via ETH: $${priceInUSDC.toFixed(2)}`);
    lastZENPrice = priceInUSDC;
    return priceInUSDC;
  } catch (err) {
    console.warn(`[price.ts] ETH fallback fetch failed:`, err);
    return null;
  }
}

/**
 * Query Uniswap V2 factory to find pool address for token pair
 */
async function getUniswapPoolAddress(token0: string, token1: string): Promise<string | null> {
  try {
    // getPair(address,address) selector
    const SELECTOR = '0xe34f7eb3';
    const token0Padded = token0.slice(2).padStart(64, '0');
    const token1Padded = token1.slice(2).padStart(64, '0');
    const calldata = SELECTOR + token0Padded + token1Padded;

    const result = await rpcProvider.call({
      to: UNISWAP_V2.FACTORY,
      data: calldata,
    });

    // Parse address from result (last 20 bytes = 40 hex chars)
    const poolAddress = '0x' + result.slice(-40);

    if (poolAddress === ethers.ZeroAddress) {
      return null;
    }

    return poolAddress;
  } catch (err) {
    console.warn(`[price.ts] Pool lookup failed:`, err);
    return null;
  }
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
 * HYBRID APPROACH:
 * 1. Primary: On-chain Uniswap V2 (deterministic, no API dependency)
 * 2. Fallback: DexScreener API (if pool not found)
 * 3. Cache: Use last-known price if both fail
 *
 * @param zenBalance Raw ZEN balance (wei/atomic units)
 * @param usdcBalance Raw USDC balance (wei/atomic units)
 */
export async function fetchMarketDataZEN(
  zenBalance: bigint,
  usdcBalance: bigint
): Promise<MarketData | null> {
  let currentPrice: number | null = null;
  let priceData: {
    priceUsd: number;
    volume24h: number;
    volume1h: number;
    dailyVol: number;
    priceChange24h: number;
  } | null = null;

  // Try 1: On-chain Uniswap V2 (primary, deterministic)
  console.log('[price.ts] Fetching ZEN price: trying Uniswap V2 on-chain...');
  currentPrice = await fetchZENPriceFromUniswap();

  if (currentPrice) {
    // On-chain succeeded, use fallback data for volatility
    priceData = await fetchDexScreenerPrice(
      TOKEN_ADDRESSES.ZEN,
      TOKEN_ADDRESSES.USDC,
      'ZEN'
    );
  } else {
    // Try 2: Fallback to DexScreener API
    console.log('[price.ts] Uniswap V2 failed, trying DexScreener API...');
    priceData = await fetchDexScreenerPrice(
      TOKEN_ADDRESSES.ZEN,
      TOKEN_ADDRESSES.USDC,
      'ZEN'
    );

    if (priceData) {
      currentPrice = priceData.priceUsd;
      console.log(`[price.ts] ✓ ZEN price from DexScreener: $${currentPrice.toFixed(2)}`);
      lastZENPrice = currentPrice;
    }
  }

  // Try 3: Use cached price if everything failed
  if (!currentPrice) {
    console.warn(`[price.ts] All price fetches failed, using cached price: $${lastZENPrice.toFixed(2)}`);
    currentPrice = lastZENPrice;
  }

  // If we got on-chain price but no volatility data, use defaults
  if (!priceData) {
    priceData = {
      priceUsd: currentPrice,
      volume24h: 0,
      volume1h: 0,
      dailyVol: 0.10, // Default 10% volatility estimate
      priceChange24h: 0,
    };
  }

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
 * Uses DexScreener API (reliable source for ETH pricing).
 * Caches price for ZEN/ETH fallback calculations.
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
    console.warn('[price.ts] Could not fetch ETH price, using cached price');
    const cachedPrice = lastETHPrice;

    const ethValueUsd = (Number(ethBalance) / 10 ** TOKEN_DECIMALS.ETH) * cachedPrice;
    const usdcValueUsd = Number(usdcBalance) / 10 ** TOKEN_DECIMALS.USDC;
    const totalValueUsd = ethValueUsd + usdcValueUsd;

    const assetValuePct = totalValueUsd > 0 ? ethValueUsd / totalValueUsd : 0;
    const usdcValuePct = totalValueUsd > 0 ? usdcValueUsd / totalValueUsd : 0;

    return {
      pair: 'ETH_USDC',
      currentPrice: cachedPrice,
      assetBalance: ethBalance,
      usdcBalance,
      assetValuePct,
      usdcValuePct,
      dailyVolatility: 0.05,
      priceChange24h: 0,
      timestamp: Date.now(),
    };
  }

  const currentPrice = priceData.priceUsd;
  lastETHPrice = currentPrice; // Cache for ZEN/ETH fallback

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
