import { MarketData, AssetPair } from './types';
import { ethers } from 'ethers';

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

// EZ-Path endpoint and config
const EZPATH_ENDPOINT = 'https://ezpath.myezverse.xyz/api/v1/quote';
const EZPATH_TOLL_ADDRESS = '0x13dde704389b1118b20d2bcc6d3ace749600e2ad';
const QUOTE_COST_USDC = '30000'; // $0.03 in atomic units (6 decimals)
const BASE_CHAIN_ID = 8453; // Base mainnet chain ID

// Trader wallet for signing x402 payments
const TRADER_PRIVATE_KEY = process.env.TRADER_PRIVATE_KEY;
const wallet = TRADER_PRIVATE_KEY ? new ethers.Wallet(TRADER_PRIVATE_KEY) : null;

// Fallback price cache (for resilience)
let lastZENPrice = 5.87;
let lastETHPrice = 2009.61;
let nonceCounter = 0; // Simple nonce to prevent replay attacks

interface EZPathProbeResponse {
  buyAmount: string;
  price: string;
  sources?: Array<{
    name: string;
    proportion: string;
  }>;
}

/**
 * Create x402 signed payment authorization using EIP-712
 * Signs a payment message with the trader's private key
 */
async function createX402PaymentHeader(): Promise<string | null> {
  if (!wallet) {
    console.warn('[price.ts] No TRADER_PRIVATE_KEY, cannot sign x402 payment');
    return null;
  }

  try {
    // Simple nonce to prevent replay (in production, should query on-chain)
    nonceCounter++;
    const nonce = nonceCounter.toString();

    // EIP-712 Domain
    const domain = {
      name: 'EZ-Path',
      version: '1',
      chainId: BASE_CHAIN_ID,
      verifyingContract: EZPATH_TOLL_ADDRESS,
    };

    // EIP-712 Types
    const types = {
      X402Payment: [
        { name: 'recipient', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'nonce', type: 'string' },
      ],
    };

    // EIP-712 Message
    const message = {
      recipient: EZPATH_TOLL_ADDRESS,
      amount: QUOTE_COST_USDC,
      token: TOKEN_ADDRESSES.USDC,
      nonce,
    };

    // Sign the payment message
    const signature = await wallet.signTypedData(domain, types, message);

    // Return as base64 encoded header
    const paymentProof = JSON.stringify({
      signature,
      message,
      domain,
    });

    return Buffer.from(paymentProof).toString('base64');
  } catch (err) {
    console.warn('[price.ts] Failed to create x402 payment header:', err);
    return null;
  }
}

/**
 * Fetch price using EZ-Path with x402 payment authorization
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

    console.log(`[price.ts] Querying EZ-Path for ${label}...`);

    // Create x402 payment authorization
    const xPaymentHeader = await createX402PaymentHeader();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const headers: Record<string, string> = {};
    if (xPaymentHeader) {
      headers['X-Payment'] = xPaymentHeader;
    }

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers,
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      console.warn(`[price.ts] EZ-Path returned ${res.status}`);
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
      console.log(`[price.ts]   Venues: ${venues}`);
    }

    return price;
  } catch (err) {
    console.warn(`[price.ts] EZ-Path query failed for ${label}:`, err);
    return null;
  }
}

/**
 * Fetch ZEN price using EZ-Path
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
 * Fetch ETH price using EZ-Path
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

  // Try EZ-Path with x402 payment for primary source
  console.log('[price.ts] Fetching ZEN price: trying EZ-Path (x402 signed)...');
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
    dailyVolatility: 0.12,
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

  // Try EZ-Path with x402 payment for primary source
  console.log('[price.ts] Fetching ETH price: trying EZ-Path (x402 signed)...');
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
