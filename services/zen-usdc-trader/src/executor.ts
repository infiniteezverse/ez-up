import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  BASE_RPC,
  CHAIN_ID,
  EZPATH_ENDPOINT,
  TIER,
  TOLL_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  ZEN_USDC_PAIR,
} from "./config.js";
import type { ExecutionResult, PairConfig } from "./types.js";

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const TIER_PRICES = {
  basic: "30000",
  resilient: "100000",
  institutional: "500000",
} as const;

function randomNonce(): `0x${string}` {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

export interface SwapParams {
  privateKey: string;
  /** "VOL" = sell the volatile token of `pair`. "USDC" = sell stable side. */
  sellToken: "VOL" | "USDC";
  /** "VOL" = buy the volatile token of `pair`. "USDC" = buy stable side. */
  buyToken: "VOL" | "USDC";
  sellAmount: bigint;
  /** Which pair to trade (default ZEN/USDC for backward compat) */
  pair?: PairConfig;
  dryRun?: boolean;
}

export async function executeSwap(params: SwapParams): Promise<ExecutionResult> {
  const { privateKey, sellToken, buyToken, sellAmount, dryRun } = params;
  const pair = params.pair ?? ZEN_USDC_PAIR;

  if (sellToken === buyToken) {
    return { status: "failed", error: "sellToken === buyToken" };
  }

  const sellTokenAddress = sellToken === "VOL" ? pair.tokenAddress : USDC_ADDRESS;
  const buyTokenAddress = buyToken === "VOL" ? pair.tokenAddress : USDC_ADDRESS;
  const sellDecimals = sellToken === "VOL" ? pair.tokenDecimals : USDC_DECIMALS;

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  if (dryRun) {
    return {
      status: "skipped",
      buyAmount: "DRY_RUN",
      routingEngine: "DRY_RUN",
    };
  }

  const probeUrl = new URL(EZPATH_ENDPOINT);
  probeUrl.searchParams.set("sellToken", sellTokenAddress);
  probeUrl.searchParams.set("buyToken", buyTokenAddress);
  probeUrl.searchParams.set("sellAmount", sellAmount.toString());

  const probe = await fetch(probeUrl.toString());
  if (probe.status !== 402) {
    return { status: "failed", error: `Expected 402, got ${probe.status}` };
  }

  const now = Math.floor(Date.now() / 1000);
  const message = {
    from: account.address,
    to: TOLL_ADDRESS as `0x${string}`,
    value: BigInt(TIER_PRICES[TIER]),
    validAfter: BigInt(now),
    validBefore: BigInt(now + 15),
    nonce: randomNonce(),
  };

  const client = createWalletClient({
    account,
    chain: base,
    transport: http(BASE_RPC),
  }).extend(publicActions);

  const signature = await client.signTypedData({
    account,
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: CHAIN_ID,
      verifyingContract: USDC_ADDRESS as `0x${string}`,
    },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });

  const paymentPayload = {
    payload: {
      signature,
      authorization: {
        from: message.from,
        to: message.to,
        value: message.value.toString(),
        validAfter: message.validAfter.toString(),
        validBefore: message.validBefore.toString(),
        nonce: message.nonce,
      },
      quote_issued_at: Date.now(),
    },
  };

  const paymentHeader = btoa(JSON.stringify(paymentPayload));

  const response = await fetch(probeUrl.toString(), {
    method: "GET",
    headers: { "X-Payment": paymentHeader },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return { status: "failed", error: `Quote ${response.status}: ${errText.slice(0, 200)}` };
  }

  const data = (await response.json()) as Record<string, unknown>;
  const txHash =
    (data["X-Settlement-Tx"] as string | undefined) ??
    (data.settlement_tx as string | undefined) ??
    "pending";

  void sellDecimals;

  return {
    status: "success",
    txHash,
    buyAmount: data.buyAmount as string,
    routingEngine: data.routingEngine as string,
  };
}
