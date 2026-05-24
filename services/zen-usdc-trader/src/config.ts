import type { Config } from "./types.js";

export const ZEN_ADDRESS = "0xf43eb8de897fbc7f2502483b2bef7bb9ea179229" as const;
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const EZPATH_ENDPOINT = "https://ezpath.myezverse.xyz/api/v1/quote";
export const TOLL_ADDRESS = "0x13dDE704389b1118B20d2BCc6D3Ace749600e2ad";
export const BASE_RPC = "https://mainnet.base.org";
export const CHAIN_ID = 8453;

export const ZEN_DECIMALS = 18;
export const USDC_DECIMALS = 6;

export const configV3: Config = {
  minZenPct: 0.30,
  maxZenPct: 0.70,
  minTradeNotional: 10,
  minTradeIntervalMs: 0,
  maxTradesPerDay: 8,
  upsideBrackets: [0.04, 0.06, 0.08, 0.12],
  downsideBrackets: [-0.04, -0.06, -0.08, -0.12],
  upsideSlices: [0.05, 0.05, 0.10, 0.15],
  downsideSlices: [0.05, 0.05, 0.10, 0.15],
  enableVolFilter: false,
  minDailyVol: 0.05,
  enableVolumeFilter: false,
  minVolumeRatio: 0.5,
};

// Safeguard configurations
export const SAFEGUARDS = {
  twoTickConfirmation: true,
  trendFilterThreshold: 0.15, // Skip tier 1 if 24h move > 15%
  dailyPnlStopThreshold: -0.10, // Halt buys if down > 10%
};


export const TIER: "basic" | "resilient" | "institutional" = "basic";
