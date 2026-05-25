import type { Config, PairConfig } from "./types.js";

// ===== Stable side (shared by all pairs) =====
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_DECIMALS = 6;

// ===== Volatile sides =====
export const ZEN_ADDRESS = "0xf43eb8de897fbc7f2502483b2bef7bb9ea179229" as const;
export const ZEN_DECIMALS = 18;
export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as const;
export const WETH_DECIMALS = 18;

// ===== EZ Path + Base =====
export const EZPATH_ENDPOINT = "https://ezpath.myezverse.xyz/api/v1/quote";
export const TOLL_ADDRESS = "0x13dDE704389b1118B20d2BCc6D3Ace749600e2ad";
export const BASE_RPC = "https://mainnet.base.org";
export const CHAIN_ID = 8453;

// ===== Shared strategy parameters =====
// Single strategy template; each pair can override individual fields.
const STRATEGY_BASE: Config = {
  minZenPct: 0.30,
  maxZenPct: 0.70,
  minTradeNotional: 10,
  minTradeIntervalMs: 0,
  maxTradesPerDay: 8,
  upsideBrackets: [0.02, 0.04, 0.06, 0.08, 0.12],
  downsideBrackets: [-0.02, -0.04, -0.06, -0.08, -0.12],
  upsideSlices: [0.05, 0.075, 0.11, 0.17, 0.25],
  downsideSlices: [0.05, 0.075, 0.11, 0.17, 0.25],
  enableVolFilter: false,
  minDailyVol: 0.05,
  enableVolumeFilter: false,
  minVolumeRatio: 0.5,
  twoTickConfirmation: false,
  referenceResetWindowMs: 72 * 3600 * 1000,
  maxSlippageFractionOfBracket: 0.25,
};

// ===== Pair definitions =====
export const ZEN_USDC_PAIR: PairConfig = {
  name: "ZEN/USDC",
  symbol: "ZEN",
  tokenAddress: ZEN_ADDRESS,
  tokenDecimals: ZEN_DECIMALS,
  poolAddress: "0x0392B12a1cEb0cd13af5Ea448CF5586EA609852D", // Aerodrome
  // 100% while only pair in PAIRS. Change to 0.5 (or whatever split desired)
  // when ETH_USDC_PAIR is added to PAIRS.
  weightOfTreasury: 1.0,
  strategy: STRATEGY_BASE,
};

export const ETH_USDC_PAIR: PairConfig = {
  name: "ETH/USDC",
  symbol: "ETH",
  tokenAddress: WETH_ADDRESS,
  tokenDecimals: WETH_DECIMALS,
  poolAddress: "0x6c561B446416E1A00E8E93E221854d6eA4171372", // Uniswap V3 (deepest)
  weightOfTreasury: 0.5,
  strategy: STRATEGY_BASE,
};

// PAIRS controls which pairs the live bot processes. ETH is defined above but
// disabled here until we decide to enable it. To go multi-pair: add ETH_USDC_PAIR.
export const PAIRS: PairConfig[] = [ZEN_USDC_PAIR];

// Legacy single-pair export (still used by older callers; will retire after refactor)
export const configV3: Config = STRATEGY_BASE;

// Safeguard configurations
export const SAFEGUARDS = {
  twoTickConfirmation: false,
  trendFilterThreshold: 0.15,
  dailyPnlStopThreshold: -0.10,
};

export const TIER: "basic" | "resilient" | "institutional" = "basic";
