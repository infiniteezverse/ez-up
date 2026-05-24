import { createPublicClient, http, erc20Abi } from "viem";
import { base } from "viem/chains";
import { BASE_RPC, USDC_ADDRESS, ZEN_ADDRESS } from "./config.js";

const client = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

export interface Balances {
  zen: bigint;
  usdc: bigint;
  zenValueUsd: number;
  usdcValueUsd: number;
  totalUsd: number;
  zenValuePct: number;
  usdcValuePct: number;
}

export async function fetchBalances(
  walletAddress: `0x${string}`,
  zenPriceUsd: number
): Promise<Balances> {
  const [zen, usdc] = await Promise.all([
    client.readContract({
      address: ZEN_ADDRESS as `0x${string}`,
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

  const zenAmount = Number(zen) / 1e18;
  const usdcAmount = Number(usdc) / 1e6;
  const zenValueUsd = zenAmount * zenPriceUsd;
  const usdcValueUsd = usdcAmount;
  const totalUsd = zenValueUsd + usdcValueUsd;
  const zenValuePct = totalUsd > 0 ? zenValueUsd / totalUsd : 0;
  const usdcValuePct = totalUsd > 0 ? usdcValueUsd / totalUsd : 0;

  return {
    zen,
    usdc,
    zenValueUsd,
    usdcValueUsd,
    totalUsd,
    zenValuePct,
    usdcValuePct,
  };
}
