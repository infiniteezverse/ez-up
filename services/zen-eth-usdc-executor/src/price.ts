import { MarketData, AssetPair } from './types';

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

// EZ-Path endpoint (free probe, no payment required)
const EZPATH_ENDPOINT = 'https://ezpath.myezverse.xyz/api/v1/quote';

// Fallback price cache (for resilience)
let lastZENPrice = 5.87;
let lastETHPrice = 2009.61;

interface EZPathProbeResponse {
  buyAmount: string;
  price: string;
  sources?: Array<{
    name: string;
    proportion: string;
  }>;
}

/**
 * Fetch price using EZ-Path free probe (no payment required)
 * Races 10 DEX venues and returns best execution
 */
async function fetchPriceFromEZPath(
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  label: string
): Promise<number | null> {
  try {
    const url = new URL(EZPATH_ENDPOINT);
    url.searchParams.set('sellToken', sellToken);
    url.searchParams.set('buyToken', buyToken);
    url.searchParams.set('sellAmount', sellAmount);

    console.log(`[price.ts] Probing EZ-Path for ${label}...`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url.toString(), { signal: controller.signal }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      console.warn(`[price.ts] EZ-Path probe returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as EZPathProbeResponse;
    const price = parseFloat(data.price);

    if (isNaN(price) || price <= 0) {
      console.warn(`[price.ts] Invalid price from EZ-Path: ${data.price}`);
      return null;
    }

    console.log(`[price.ts] ✓ ${label}: $${price.toFixed(4)}`);
    if (data.sources) {
      const venues = data.sources.map((s) => `${s.name} (${s.proportion})`).join(', ');
      console.log(`[price.ts]   Best venues: ${venues}`);
    }

    return price;
  } catch (err) {
    console.warn(`[price.ts] EZ-Path probe failed for ${label}:`, err);
    return null;
  }
}

/**
 * Fetch ZEN price using EZ-Path free probe
 * Query: 1 USDC → ZEN
 */
async function fetchZENPriceFromEZPath(): Promise<number | null> {
  const price = await fetchPriceFromEZPath(
    TOKEN_ADDRESSES.USDC,
    TOKEN_ADDRESSES.ZEN,
    '1000000', // 1 USDC (6 decimals)
    'ZEN/USDC'
  );

  if (price) {
    lastZENPrice = price;
  }

  return price;
}

/**
 * Fetch ETH price using EZ-Path free probe
 * Query: 1 USDC → ETH
 */
async function fetchETHPriceFromEZPath(): Promise<number | null> {
  const price = await fetchPriceFromEZPath(
    TOKEN_ADDRESSES.USDC,
    TOKEN_ADDRESSES.ETH,
    '1000000', // 1 USDC (6 decimals)
    'ETH/USDC'
  );

  if (price) {
    lastETHPrice = price;
  }

  return price;
}

/**
 * Fetch complete market data for ZEN/USDC pair using EZ-Path
 * @param zenBalance Raw ZEN balance (wei/atomic units)
 * @param usdcBalance Raw USDC balance (wei/atomic units)
 */
export async function fetchMarketDataZEN(
  zenBalance: bigint,
  usdcBalance: bigint
): Promise<MarketData | null> {
  let currentPrice: number | null = null;

  // Try EZ-Path free probe for primary source
  console.log('[price.ts] Fetching ZEN price: trying EZ-Path (free probe)...');
  currentPrice = await fetchZENPriceFromEZPath();

  // Use cached price if EZ-Path fails
  if (!currentPrice) {
    console.warn(`[price.ts] EZ-Path unavailable, using cached price: $${lastZENPrice.toFixed(2)}`);
    currentPrice = lastZENPrice;
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
    dailyVolatility: 0.12, // Conservative estimate (12%)
    priceChange24h: 0,
    timestamp: Date.now(),
  };
}

/**
 * Fetch complete market data for ETH/USDC pair using EZ-Path
 * @param ethBalance Raw ETH (WETH) balance (wei)
 * @param usdcBalance Raw USDC balance (wei)
 */
export async function fetchMarketDataETH(
  ethBalance: bigint,
  usdcBalance: bigint
): Promise<MarketData | null> {
  let currentPrice: number | null = null;

  // Try EZ-Path free probe for primary source
  console.log('[price.ts] Fetching ETH price: trying EZ-Path (free probe)...');
  currentPrice = await fetchETHPriceFromEZPath();

  // Use cached price if EZ-Path fails
  if (!currentPrice) {
    console.warn(`[price.ts] EZ-Path unavailable, using cached price: $${lastETHPrice.toFixed(2)}`);
    currentPrice = lastETHPrice;
  }

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
    dailyVolatility: 0.05, // Conservative estimate (5%)
    priceChange24h: 0,
    timestamp: Date.now(),
  };
}

/**
 * Batch fetch market data for both ZEN and ETH (parallel via EZ-Path free probe)
 * No cost: uses free EZ-Path probe endpoint
 */
export async function fetchMarketDataBatch(
  zenBalance: bigint,
  ethBalance: bigint,
  usdcBalance: bigint
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
 * Fetch fallback prices (cached from last successful EZ-Path probe)
 */
export function getFallbackPrices(): {
  zenPrice: number;
  ethPrice: number;
} {
  return {
    zenPrice: lastZENPrice,
    ethPrice: lastETHPrice,
  };
}
