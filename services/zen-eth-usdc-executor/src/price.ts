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

// EZ-Path API
const EZPATH_API = 'https://api.myezverse.xyz/api/v1/quote';

// Fallback price cache (for resilience)
let lastZENPrice = 5.87;
let lastETHPrice = 2009.61;

interface EZPathProbeResponse {
  estimatedPrice: string | null;
  cacheAgeSeconds: number | null;
  tiers: {
    basic: { min_atomic: string; usd: string };
    resilient: { min_atomic: string; usd: string };
    institutional: { min_atomic: string; usd: string };
  };
}

interface EZPathQuoteResponse {
  buyAmount: string;
  price: string;
  expiresAt: number;
  slippageGuarantee: {
    worstCase: string;
    confidence: number;
    secondsValid: number;
  };
  sources?: Array<{
    name: string;
    proportion: string;
  }>;
}

/**
 * Fetch estimated price from EZ-Path probe (FREE via HTTP 402)
 * Single source of truth using estimatedPrice from last quote
 */
async function fetchPriceViaEZPathProbe(
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  label: string
): Promise<number | null> {
  try {
    const url = new URL(EZPATH_API);
    url.searchParams.set('sellToken', sellToken);
    url.searchParams.set('buyToken', buyToken);
    url.searchParams.set('sellAmount', sellAmount);

    console.log(`[price.ts] Probing EZ-Path for ${label} (FREE)...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url.toString(), {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    // HTTP 402 is expected (payment required) - contains estimatedPrice from cache
    if (res.status !== 402) {
      console.warn(`[price.ts] EZ-Path probe returned ${res.status}, expected 402`);
      return null;
    }

    const probeData = (await res.json()) as EZPathProbeResponse;

    // estimatedPrice might be null if no quote has been cached yet
    if (!probeData.estimatedPrice) {
      console.warn(`[price.ts] No estimatedPrice in EZ-Path probe (first query or cache expired)`);
      return null;
    }

    const estimatedPrice = parseFloat(probeData.estimatedPrice);

    if (isNaN(estimatedPrice) || estimatedPrice <= 0) {
      console.warn(`[price.ts] Invalid estimatedPrice from EZ-Path: ${probeData.estimatedPrice}`);
      return null;
    }

    const cacheAge = probeData.cacheAgeSeconds ?? 0;
    console.log(`[price.ts] ✓ ${label} (EZ-Path probe): $${estimatedPrice.toFixed(4)} (cached ${cacheAge}s ago)`);
    console.log(
      `[price.ts]   Pricing: basic=$${probeData.tiers.basic.usd}, resilient=$${probeData.tiers.resilient.usd}, institutional=$${probeData.tiers.institutional.usd}`
    );

    return estimatedPrice;
  } catch (err) {
    console.warn(`[price.ts] EZ-Path probe failed for ${label}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fetch confirmed quote from EZ-Path (PAID via HTTP 200 + x402)
 * Called only when bracket breach is detected
 */
export async function fetchConfirmedQuoteFromEZPath(
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  label: string
): Promise<EZPathQuoteResponse | null> {
  try {
    const url = new URL(EZPATH_API);
    url.searchParams.set('sellToken', sellToken);
    url.searchParams.set('buyToken', buyToken);
    url.searchParams.set('sellAmount', sellAmount);

    console.log(`[price.ts] Requesting confirmed quote from EZ-Path for ${label} (PAID)...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        // X-Payment header would go here if signing x402 locally
        // For now, we'll rely on fallback to cached prices if payment fails
      },
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      console.warn(`[price.ts] EZ-Path quote returned status ${res.status}`);
      return null;
    }

    const quoteData = (await res.json()) as EZPathQuoteResponse;
    const price = parseFloat(quoteData.price);

    if (isNaN(price) || price <= 0) {
      console.warn(`[price.ts] Invalid price from EZ-Path quote: ${quoteData.price}`);
      return null;
    }

    const worstCase = parseFloat(quoteData.slippageGuarantee.worstCase);
    console.log(`[price.ts] ✓ Confirmed ${label}: $${price.toFixed(4)}`);
    console.log(
      `[price.ts]   Slippage guarantee: worst-case=$${worstCase.toFixed(4)} (${(quoteData.slippageGuarantee.confidence * 100).toFixed(0)}% confidence)`
    );
    console.log(`[price.ts]   Expires in ${quoteData.slippageGuarantee.secondsValid}s`);
    if (quoteData.sources) {
      const venues = quoteData.sources.map((s) => `${s.name} (${s.proportion})`).join(', ');
      console.log(`[price.ts]   Venues: ${venues}`);
    }

    return quoteData;
  } catch (err) {
    console.warn(
      `[price.ts] EZ-Path quote failed for ${label}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Fetch ZEN price for bracket detection (FREE via EZ-Path probe)
 */
async function fetchZENPrice(): Promise<number> {
  const price = await fetchPriceViaEZPathProbe(
    TOKEN_ADDRESSES.USDC,
    TOKEN_ADDRESSES.ZEN,
    '1000000',
    'ZEN/USDC'
  );

  if (price) {
    lastZENPrice = price;
    return price;
  }

  // Fall back to cached price
  console.warn(`[price.ts] EZ-Path unavailable for ZEN, using cached price: $${lastZENPrice.toFixed(2)}`);
  return lastZENPrice;
}

/**
 * Fetch ETH price for bracket detection (FREE via EZ-Path probe)
 */
async function fetchETHPrice(): Promise<number> {
  const price = await fetchPriceViaEZPathProbe(
    TOKEN_ADDRESSES.USDC,
    TOKEN_ADDRESSES.ETH,
    '1000000',
    'ETH/USDC'
  );

  if (price) {
    lastETHPrice = price;
    return price;
  }

  // Fall back to cached price
  console.warn(`[price.ts] EZ-Path unavailable for ETH, using cached price: $${lastETHPrice.toFixed(2)}`);
  return lastETHPrice;
}

/**
 * Fetch complete market data for ZEN/USDC pair
 * Uses pure EZ-Path: FREE probe for detection, PAID quote only on breach
 * @param zenBalance Raw ZEN balance (wei/atomic units)
 * @param usdcBalance Raw USDC balance (wei/atomic units)
 */
export async function fetchMarketDataZEN(
  zenBalance: bigint,
  usdcBalance: bigint
): Promise<MarketData | null> {
  console.log('[price.ts] Fetching ZEN/USDC market data via EZ-Path probe (FREE)...');
  const currentPrice = await fetchZENPrice();

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
    dailyVolatility: 0.12,
    priceChange24h: 0,
    timestamp: Date.now(),
  };
}

/**
 * Fetch complete market data for ETH/USDC pair
 * Uses pure EZ-Path: FREE probe for detection, PAID quote only on breach
 * @param ethBalance Raw ETH (WETH) balance (wei)
 * @param usdcBalance Raw USDC balance (wei)
 */
export async function fetchMarketDataETH(
  ethBalance: bigint,
  usdcBalance: bigint
): Promise<MarketData | null> {
  console.log('[price.ts] Fetching ETH/USDC market data via EZ-Path probe (FREE)...');
  const currentPrice = await fetchETHPrice();

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
    dailyVolatility: 0.05,
    priceChange24h: 0,
    timestamp: Date.now(),
  };
}

/**
 * Batch fetch market data for both ZEN and ETH (parallel via EZ-Path x402)
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
 * Get confirmed ZEN price from EZ-Path for execution (called only when breach detected)
 */
export async function getConfirmedZENPrice(): Promise<EZPathQuoteResponse | null> {
  return await fetchConfirmedQuoteFromEZPath(
    TOKEN_ADDRESSES.USDC,
    TOKEN_ADDRESSES.ZEN,
    '1000000', // 1 USDC (6 decimals)
    'ZEN/USDC (execution)'
  );
}

/**
 * Get confirmed ETH price from EZ-Path for execution (called only when breach detected)
 */
export async function getConfirmedETHPrice(): Promise<EZPathQuoteResponse | null> {
  return await fetchConfirmedQuoteFromEZPath(
    TOKEN_ADDRESSES.USDC,
    TOKEN_ADDRESSES.ETH,
    '1000000', // 1 USDC (6 decimals)
    'ETH/USDC (execution)'
  );
}

/**
 * Fetch fallback prices (cached from last successful EZ-Path probe query)
 * Used when EZ-Path is unavailable to ensure trading continues
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
