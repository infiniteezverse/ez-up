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

// Fallback price cache (for resilience)
let lastZENPrice = 5.87;
let lastETHPrice = 2009.61;
let toolsCache: any = null;

interface EZPathProbeResponse {
  estimatedPrice: string;
  cacheAgeSeconds: number;
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
 * Get MCP EZ-Path tools (cached)
 */
async function getEZPathTools() {
  if (toolsCache) {
    return toolsCache;
  }

  try {
    const mcpEzpath = await import('mcp-ezpath');
    const tools = await mcpEzpath.getTools();
    toolsCache = tools;
    return tools;
  } catch (err) {
    console.warn('[price.ts] Failed to load mcp-ezpath:', err);
    return null;
  }
}

/**
 * Fetch estimated price from EZ-Path probe (FREE)
 * Returns cached estimated price from last quote + metadata
 */
async function fetchPriceViaEZPathProbe(
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  label: string
): Promise<{ price: number; cacheAge: number } | null> {
  try {
    const tools = await getEZPathTools();
    if (!tools) {
      console.warn('[price.ts] EZ-Path tools unavailable for probe');
      return null;
    }

    console.log(`[price.ts] Probing EZ-Path for ${label} (FREE)...`);

    const probeResult: EZPathProbeResponse = await tools.ezpath_probe({
      sellToken,
      buyToken,
      sellAmount,
    });

    const estimatedPrice = parseFloat(probeResult.estimatedPrice);

    if (isNaN(estimatedPrice) || estimatedPrice <= 0) {
      console.warn(`[price.ts] Invalid estimated price from EZ-Path: ${probeResult.estimatedPrice}`);
      return null;
    }

    console.log(
      `[price.ts] ✓ ${label} (EZ-Path probe): $${estimatedPrice.toFixed(4)} (cached ${probeResult.cacheAgeSeconds}s ago)`
    );
    console.log(
      `[price.ts]   Tiers: basic=$${probeResult.tiers.basic.usd}, resilient=$${probeResult.tiers.resilient.usd}, institutional=$${probeResult.tiers.institutional.usd}`
    );

    return {
      price: estimatedPrice,
      cacheAge: probeResult.cacheAgeSeconds,
    };
  } catch (err) {
    console.warn(`[price.ts] EZ-Path probe failed for ${label}:`, err);
    return null;
  }
}

/**
 * Fetch confirmed price from EZ-Path quote (PAID via x402)
 * Called only when bracket breach is detected, to confirm before execution
 */
export async function fetchConfirmedQuoteFromEZPath(
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  label: string
): Promise<EZPathQuoteResponse | null> {
  try {
    const tools = await getEZPathTools();
    if (!tools) {
      console.warn('[price.ts] EZ-Path tools unavailable for confirmed quote');
      return null;
    }

    console.log(`[price.ts] Requesting confirmed quote from EZ-Path for ${label} (PAID)...`);

    const quoteResult: EZPathQuoteResponse = await tools.ezpath_quote({
      sellToken,
      buyToken,
      sellAmount,
      tier: 'basic', // $0.03 per quote
    });

    const price = parseFloat(quoteResult.price);

    if (isNaN(price) || price <= 0) {
      console.warn(`[price.ts] Invalid price from EZ-Path: ${quoteResult.price}`);
      return null;
    }

    const worstCase = parseFloat(quoteResult.slippageGuarantee.worstCase);
    console.log(`[price.ts] ✓ Confirmed ${label}: $${price.toFixed(4)}`);
    console.log(
      `[price.ts]   Slippage guarantee: worst-case=$${worstCase.toFixed(4)} (${(quoteResult.slippageGuarantee.confidence * 100).toFixed(0)}% confidence)`
    );
    console.log(`[price.ts]   Expires in ${quoteResult.slippageGuarantee.secondsValid}s`);
    if (quoteResult.sources) {
      const venues = quoteResult.sources.map((s) => `${s.name} (${s.proportion})`).join(', ');
      console.log(`[price.ts]   Venues: ${venues}`);
    }

    return quoteResult;
  } catch (err) {
    console.warn(`[price.ts] EZ-Path confirmed quote failed for ${label}:`, err);
    return null;
  }
}

/**
 * Fetch ZEN price for bracket detection (FREE via EZ-Path probe)
 */
async function fetchZENPrice(): Promise<number> {
  const probeResult = await fetchPriceViaEZPathProbe(
    TOKEN_ADDRESSES.USDC,
    TOKEN_ADDRESSES.ZEN,
    '1000000', // 1 USDC (6 decimals)
    'ZEN/USDC'
  );

  if (probeResult) {
    lastZENPrice = probeResult.price;
    return probeResult.price;
  }

  // Fall back to last known price
  console.warn(`[price.ts] EZ-Path unavailable for ZEN, using cached price: $${lastZENPrice.toFixed(2)}`);
  return lastZENPrice;
}

/**
 * Fetch ETH price for bracket detection (FREE via EZ-Path probe)
 */
async function fetchETHPrice(): Promise<number> {
  const probeResult = await fetchPriceViaEZPathProbe(
    TOKEN_ADDRESSES.USDC,
    TOKEN_ADDRESSES.ETH,
    '1000000', // 1 USDC (6 decimals)
    'ETH/USDC'
  );

  if (probeResult) {
    lastETHPrice = probeResult.price;
    return probeResult.price;
  }

  // Fall back to last known price
  console.warn(`[price.ts] EZ-Path unavailable for ETH, using cached price: $${lastETHPrice.toFixed(2)}`);
  return lastETHPrice;
}

/**
 * Fetch complete market data for ZEN/USDC pair
 * Uses FREE EZ-Path probe for bracket detection (single source of truth)
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
 * Uses FREE EZ-Path probe for bracket detection (single source of truth)
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
