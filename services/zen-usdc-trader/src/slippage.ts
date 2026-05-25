/**
 * Pre-trade slippage estimator using constant-product AMM math.
 *
 * For a constant-product pool (x * y = k) with reserves R_in and R_out,
 * trading dx into the pool yields:
 *   dy = (R_out * dx) / (R_in + dx)
 *
 * The price impact (slippage) vs the spot price R_out/R_in is:
 *   slippage = dx / (R_in + dx)
 *
 * For two-sided liquidity expressed as USD TVL (DexScreener gives total
 * liquidity in USD across both sides), one side ≈ liquidityUsd / 2.
 *
 * This is a conservative estimate that ignores EZ Path's multi-venue
 * routing (which would split the trade across venues to reduce per-pool
 * impact). Real fills will typically be BETTER than this estimate.
 */
export function estimateSlippageBps(params: {
  tradeNotionalUsd: number;
  poolLiquidityUsd: number;
}): number {
  const oneSide = params.poolLiquidityUsd / 2;
  if (oneSide <= 0 || params.tradeNotionalUsd <= 0) return 0;
  const slippageFraction = params.tradeNotionalUsd / (oneSide + params.tradeNotionalUsd);
  return Math.round(slippageFraction * 10_000);
}

/**
 * Tier 1 (2% bracket) → 200 bps. With maxFraction=0.25 → max acceptable slippage = 50 bps.
 * Tier 5 (12% bracket) → 1200 bps → max acceptable = 300 bps.
 */
export function maxAcceptableSlippageBps(bracketPct: number, maxFraction: number): number {
  return Math.round(Math.abs(bracketPct) * 10_000 * maxFraction);
}
