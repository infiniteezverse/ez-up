import { createPublicClient, http, erc20Abi } from "viem";
import { base } from "viem/chains";
import { BASE_RPC, USDC_ADDRESS, USDC_DECIMALS, ZEN_USDC_PAIR } from "./config.js";
import type { PairConfig } from "./types.js";

const client = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

export interface PairBalances {
  /** Volatile token raw balance (atomic, BigInt) */
  zen: bigint;
  /** USDC raw balance (atomic, BigInt) */
  usdc: bigint;
  /** Human-readable volatile token amount */
  zenAmount: number;
  /** Human-readable USDC amount */
  usdcAmount: number;
  /** Volatile token value in USD */
  zenValueUsd: number;
  /** USDC value in USD (== usdcAmount) */
  usdcValueUsd: number;
  /** Total value of this pair's slice in USD */
  totalUsd: number;
  /** Volatile token % of this pair's slice */
  zenValuePct: number;
  /** USDC % of this pair's slice */
  usdcValuePct: number;
}

// Backward-compat alias for legacy callers
export type Balances = PairBalances;

/**
 * Read on-chain balances of (volatile token + USDC) for a single pair from
 * a given wallet. Returns both raw BigInt balances and computed USD values.
 *
 * For multi-pair operation, the same wallet holds positions for all pairs;
 * each pair calls this with its own PairConfig. USDC balance is the FULL
 * wallet's USDC — the bot's allocation logic decides how much each pair
 * "owns" based on PairConfig.weightOfTreasury.
 */
export async function fetchPairBalances(
  pair: PairConfig,
  walletAddress: `0x${string}`,
  tokenPriceUsd: number
): Promise<PairBalances> {
  const [tokenRaw, usdcRaw] = await Promise.all([
    client.readContract({
      address: pair.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    }),
    client.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    }),
  ]);

  const zenAmount = Number(tokenRaw) / 10 ** pair.tokenDecimals;
  const usdcAmount = Number(usdcRaw) / 10 ** USDC_DECIMALS;
  const zenValueUsd = zenAmount * tokenPriceUsd;
  const usdcValueUsd = usdcAmount;
  const totalUsd = zenValueUsd + usdcValueUsd;
  const zenValuePct = totalUsd > 0 ? zenValueUsd / totalUsd : 0;
  const usdcValuePct = totalUsd > 0 ? usdcValueUsd / totalUsd : 0;

  return {
    zen: tokenRaw,
    usdc: usdcRaw,
    zenAmount,
    usdcAmount,
    zenValueUsd,
    usdcValueUsd,
    totalUsd,
    zenValuePct,
    usdcValuePct,
  };
}

// Legacy ZEN-specific wrapper (kept so older callers don't break)
export async function fetchBalances(
  walletAddress: `0x${string}`,
  zenPriceUsd: number
): Promise<Balances> {
  return fetchPairBalances(ZEN_USDC_PAIR, walletAddress, zenPriceUsd);
}
