import { configV3 } from "../config.js";
import type { Config } from "../types.js";
import { computeMetrics, type BacktestMetrics } from "./metrics.js";
import type { OhlcvBar } from "./priceHistory.js";
import { replay } from "./replay.js";

export interface SweepVariant {
  label: string;
  config: Config;
  twoTickConfirmation: boolean;
}

export interface SweepResult extends SweepVariant {
  metrics: BacktestMetrics;
}

/**
 * Build a Cartesian product of bracket × slice × twoTick variants
 * around the live configV3 baseline.
 */
export function buildVariants(): SweepVariant[] {
  // bracketScales multiply the BASE brackets [4,6,8,12]%
  // 0.5  -> [2, 3, 4, 6]
  // 0.75 -> [3, 4.5, 6, 9]
  // 1.0  -> [4, 6, 8, 12]  (baseline)
  // 1.25 -> [5, 7.5, 10, 15]
  const bracketScales = [0.5, 0.75, 1.0, 1.25];

  // sliceProfiles control how aggressive each tier's slice is
  const sliceProfiles: Array<{ name: string; up: number[]; down: number[] }> = [
    { name: "conservative", up: [0.03, 0.03, 0.05, 0.08], down: [0.03, 0.03, 0.05, 0.08] },
    { name: "baseline",     up: [0.05, 0.05, 0.10, 0.15], down: [0.05, 0.05, 0.10, 0.15] },
    { name: "aggressive",   up: [0.08, 0.10, 0.15, 0.25], down: [0.08, 0.10, 0.15, 0.25] },
  ];

  const twoTickOptions = [true, false];

  const variants: SweepVariant[] = [];
  for (const scale of bracketScales) {
    for (const slice of sliceProfiles) {
      for (const twoTick of twoTickOptions) {
        const ups = configV3.upsideBrackets.map((b) => +(b * scale).toFixed(4));
        const downs = configV3.downsideBrackets.map((b) => +(b * scale).toFixed(4));
        const cfg: Config = {
          ...configV3,
          upsideBrackets: ups,
          downsideBrackets: downs,
          upsideSlices: slice.up,
          downsideSlices: slice.down,
          maxTradesPerDay: 24, // raise cap for backtest; live cap is separate
        };
        const upsPct = ups.map((b) => `${(b * 100).toFixed(1)}%`).join("/");
        const label = `brk=${upsPct} slice=${slice.name} 2tick=${twoTick ? "on" : "off"}`;
        variants.push({ label, config: cfg, twoTickConfirmation: twoTick });
      }
    }
  }
  return variants;
}

export function runSweep(opts: {
  bars: OhlcvBar[];
  variants: SweepVariant[];
  initialUsd?: number;
  feePerTradeUsd?: number;
  slippageBps?: number;
}): SweepResult[] {
  const results: SweepResult[] = [];
  for (const v of opts.variants) {
    const r = replay({
      bars: opts.bars,
      config: v.config,
      initialUsd: opts.initialUsd,
      feePerTradeUsd: opts.feePerTradeUsd,
      slippageBps: opts.slippageBps,
      twoTickConfirmation: v.twoTickConfirmation,
    });
    const metrics = computeMetrics(r);
    results.push({ ...v, metrics });
  }
  // Sort by net return desc
  results.sort((a, b) => b.metrics.netReturnPct - a.metrics.netReturnPct);
  return results;
}
