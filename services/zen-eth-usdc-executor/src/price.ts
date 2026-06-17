import { MarketData, AssetPair } from './types';
import { EZPathClient } from 'plugin-ezpath';

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

// EZ-Path client for best DEX quotes (races 10 venues on Base)
const TRADER_PRIVATE_KEY = process.env.TRADER_PRIVATE_KEY;
if (!TRADER_PRIVATE_KEY) {
  console.error('TRADER_PRIVATE_KEY not set in .env');
  process.exit(1);
}

const ezpathClient = new EZPathClient(TRADER_PRIVATE_KEY);

// Fallback price cache (for resilience)
let lastZENPrice = 5.87;
let lastETHPrice = 2009.61;

/**
 * Fetch ZEN price using EZ-Path (races 10 DEX venues on Base)
 * Query: 1 USDC → ZEN, derive price from buyAmount
 */
async function fetchZENPriceFromEZPath(): Promise<number | null> {
  try {
    console.log('[price.ts] Querying EZ-Path for ZEN/USDC quote...');

    // Get quote: 1 USDC → ZEN (via basic tier, $0.03)
    const quote = await ezpathClient.getQuote({
      sellToken: TOKEN_ADDRESSES.USDC,
      buyToken: TOKEN_ADDRESSES.ZEN,
      sellAmount: '1000000', // 1 USDC (6 decimals)
      tier: 'basic', // $0.03 per quote
    });

    const zenPerUsdc = Number(quote.buyAmount) / Math.pow(10, TOKEN_DECIMALS.ZEN);

    console.log(`[price.ts] ✓ ZEN price from EZ-Path: $${zenPerUsdc.toFixed(4)}`);
    console.log(`[price.ts] Best venues: ${quote.sources?.map((s: any) => `${s.name} (${s.proportion})`).join(', ') || 'N/A'}`);

    lastZENPrice = zenPerUsdc;
    return zenPerUsdc;
  } catch (err) {
    console.warn(`[price.ts] EZ-Path ZEN quote failed:`, err);
    return null;
  }
}

/**
 * Fetch ETH price using EZ-Path (races 10 DEX venues on Base)
 * Query: 1 USDC → ETH, derive price from buyAmount
 */
async function fetchETHPriceFromEZPath(): Promise<number | null> {
  try {
    console.log('[price.ts] Querying EZ-Path for ETH/USDC quote...');

    // Get quote: 1 USDC → ETH (via basic tier, $0.03)
    const quote = await ezpathClient.getQuote({
      sellToken: TOKEN_ADDRESSES.USDC,
      buyToken: TOKEN_ADDRESSES.ETH,
      sellAmount: '1000000', // 1 USDC (6 decimals)
      tier: 'basic', // $0.03 per quote
    });

    const ethPerUsdc = Number(quote.buyAmount) / Math.pow(10, TOKEN_DECIMALS.ETH);

    console.log(`[price.ts] ✓ ETH price from EZ-Path: $${ethPerUsdc.toFixed(4)}`);
    console.log(`[price.ts] Best venues: ${quote.sources?.map((s: any) => `${s.name} (${s.proportion})`).join(', ') || 'N/A'}`);

    lastETHPrice = ethPerUsdc;
    return ethPerUsdc;
  } catch (err) {
    console.warn(`[price.ts] EZ-Path ETH quote failed:`, err);
    return null;
  }
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

  // Try EZ-Path for primary source
  console.log('[price.ts] Fetching ZEN price: trying EZ-Path...');
  currentPrice = await fetchZENPriceFromEZPath();

  // Use cached price if EZ-Path fails
  if (!currentPrice) {
    console.warn(`[price.ts] EZ-Path failed, using cached price: $${lastZENPrice.toFixed(2)}`);
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

  // Try EZ-Path for primary source
  console.log('[price.ts] Fetching ETH price: trying EZ-Path...');
  currentPrice = await fetchETHPriceFromEZPath();

  // Use cached price if EZ-Path fails
  if (!currentPrice) {
    console.warn(`[price.ts] EZ-Path failed, using cached price: $${lastETHPrice.toFixed(2)}`);
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
 * Batch fetch market data for both ZEN and ETH (parallel via EZ-Path)
 * Uses EZ-Path basic tier ($0.03 per quote) for best-execution pricing
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
 * Fetch fallback prices (cached from last successful EZ-Path query)
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
