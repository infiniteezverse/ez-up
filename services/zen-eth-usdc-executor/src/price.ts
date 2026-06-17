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

// CoinGecko API IDs
const COINGECKO_IDS = {
  ZEN: 'zenith',
  ETH: 'ethereum',
};

// Fallback price cache (for resilience)
let lastZENPrice = 5.87;
let lastETHPrice = 2009.61;
let toolsCache: any = null;

interface EZPathQuoteResponse {
  buyAmount: string;
  price: string;
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
 * Fetch price from CoinGecko (free, for bracket detection)
 */
async function fetchPriceFromCoinGecko(
  tokenId: string,
  label: string
): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal }).finally(() =>
      clearTimeout(timeoutId)
    );

    if (!res.ok) {
      console.warn(`[price.ts] CoinGecko returned ${res.status} for ${label}`);
      return null;
    }

    const data = (await res.json()) as any;
    const price = data[tokenId]?.usd;

    if (!price || price <= 0) {
      console.warn(`[price.ts] Invalid price from CoinGecko for ${label}`);
      return null;
    }

    console.log(`[price.ts] ✓ ${label} (CoinGecko): $${price.toFixed(4)}`);
    return price;
  } catch (err) {
    console.warn(`[price.ts] CoinGecko query failed for ${label}:`, err);
    return null;
  }
}

/**
 * Fetch confirmed price from EZ-Path via x402 quote (paid, for execution only)
 * Called when bracket breach is detected, to confirm price before trading
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

    console.log(`[price.ts] Requesting confirmed quote from EZ-Path for ${label}...`);

    const quoteResult: EZPathQuoteResponse = await tools.ezpath_quote({
      sellToken,
      buyToken,
      sellAmount,
      tier: 'basic',
    });

    const price = parseFloat(quoteResult.price);

    if (isNaN(price) || price <= 0) {
      console.warn(`[price.ts] Invalid price from EZ-Path: ${quoteResult.price}`);
      return null;
    }

    console.log(`[price.ts] ✓ Confirmed ${label}: $${price.toFixed(4)}`);
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
 * Fetch price for bracket detection (free CoinGecko, falls back to cached)
 */
async function fetchPriceForBracketDetection(
  tokenId: string,
  label: string,
  fallbackPrice: number
): Promise<number> {
  // Try CoinGecko first (free)
  const coingeckoPrice = await fetchPriceFromCoinGecko(tokenId, label);
  if (coingeckoPrice) {
    return coingeckoPrice;
  }

  // Fall back to last known price
  console.warn(
    `[price.ts] CoinGecko unavailable for ${label}, using cached price: $${fallbackPrice.toFixed(2)}`
  );
  return fallbackPrice;
}

/**
 * Fetch ZEN price for bracket detection (free via CoinGecko)
 */
async function fetchZENPrice(): Promise<number> {
  const price = await fetchPriceForBracketDetection(
    COINGECKO_IDS.ZEN,
    'ZEN/USDC',
    lastZENPrice
  );

  if (price > 0) {
    lastZENPrice = price;
  }

  return price;
}

/**
 * Fetch ETH price for bracket detection (free via CoinGecko)
 */
async function fetchETHPrice(): Promise<number> {
  const price = await fetchPriceForBracketDetection(
    COINGECKO_IDS.ETH,
    'ETH/USDC',
    lastETHPrice
  );

  if (price > 0) {
    lastETHPrice = price;
  }

  return price;
}

/**
 * Fetch complete market data for ZEN/USDC pair
 * Uses free CoinGecko for bracket detection
 * @param zenBalance Raw ZEN balance (wei/atomic units)
 * @param usdcBalance Raw USDC balance (wei/atomic units)
 */
export async function fetchMarketDataZEN(
  zenBalance: bigint,
  usdcBalance: bigint
): Promise<MarketData | null> {
  console.log('[price.ts] Fetching ZEN price via CoinGecko (free)...');
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
 * Uses free CoinGecko for bracket detection
 * @param ethBalance Raw ETH (WETH) balance (wei)
 * @param usdcBalance Raw USDC balance (wei)
 */
export async function fetchMarketDataETH(
  ethBalance: bigint,
  usdcBalance: bigint
): Promise<MarketData | null> {
  console.log('[price.ts] Fetching ETH price via CoinGecko (free)...');
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
 * Fetch fallback prices (cached from last successful CoinGecko query)
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
