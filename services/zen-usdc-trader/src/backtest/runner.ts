/**
 * CLI: npx tsx src/backtest/runner.ts [--days 90] [--out backtest-results/{date}.md]
 *
 * Fetches historical ZEN/USDC OHLCV, replays the live strategy across a
 * Cartesian sweep of bracket × slice × twoTick variants, and writes a
 * markdown report.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { configV3, PAIRS } from "../config.js";
import { computeMetrics, fmtPct, fmtUsd, type BacktestMetrics } from "./metrics.js";
import { loadOrFetch } from "./priceHistory.js";
import { buildVariants, runSweep, type SweepResult } from "./paramSweep.js";
import { replay } from "./replay.js";
import type { PairConfig } from "../types.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function asciiSpark(values: number[], width = 60): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const blocks = "▁▂▃▄▅▆▇█";
  // Downsample to `width` points
  const step = Math.max(1, Math.floor(values.length / width));
  const samples: number[] = [];
  for (let i = 0; i < values.length; i += step) {
    samples.push(values[i]);
  }
  return samples
    .map((v) => blocks[Math.min(blocks.length - 1, Math.floor(((v - min) / range) * (blocks.length - 1)))])
    .join("");
}

async function main() {
  const days = Number(arg("days", "90"));
  const outPath = arg("out", `backtest-results/${todayKey()}.md`);
  // Comma-separated list of treasury sizes to test (default: just $150)
  const initialList = arg("initial", "150")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
  const initialUsd = initialList[0];
  const slippageBps = Number(arg("slippage", "5"));
  const fee = Number(arg("fee", "0.03"));
  const poolLiquidityUsd = Number(arg("pool", "500000"));
  // If --pair flag is provided, run for that pair name. Otherwise run all PAIRS.
  const pairFilter = arg("pair", "");
  const pairsToRun: PairConfig[] = pairFilter
    ? PAIRS.filter((p) => p.name === pairFilter)
    : PAIRS;

  console.log(`📊 Backtest — ${days}d on Base`);
  console.log(`   Pairs: ${pairsToRun.map((p) => p.name).join(", ")}`);
  console.log(`   Treasury sizes: ${initialList.map((n) => "$" + n.toLocaleString()).join(", ")}`);
  console.log(`   Fee per trade: $${fee} · Slippage floor: ${slippageBps} bps`);
  console.log(`   Pool liquidity assumed: $${(poolLiquidityUsd / 1000).toFixed(0)}K (for slippage model)`);
  console.log("");

  // Fetch OHLCV history per pair
  type PairHistory = { pair: PairConfig; bars: Awaited<ReturnType<typeof loadOrFetch>>["bars"] };
  const pairHistories: PairHistory[] = [];
  for (const pair of pairsToRun) {
    console.log(`⏳ Fetching ${pair.name} OHLCV (pool ${pair.poolAddress})…`);
    const h = await loadOrFetch({ days, timeframe: "hour", pool: pair.poolAddress });
    if (h.bars.length === 0) {
      console.error(`❌ No bars for ${pair.name}`);
      continue;
    }
    const d = (h.bars[h.bars.length - 1].ts - h.bars[0].ts) / 86400;
    console.log(`   Got ${h.bars.length} hourly bars covering ${d.toFixed(1)} days`);
    pairHistories.push({ pair, bars: h.bars });
  }
  if (pairHistories.length === 0) {
    console.error("❌ No history fetched for any pair");
    process.exit(1);
  }
  const history = { ...(await loadOrFetch({ days, timeframe: "hour", pool: pairHistories[0].pair.poolAddress })), bars: pairHistories[0].bars };
  const actualDays = (history.bars[history.bars.length - 1].ts - history.bars[0].ts) / 86400;
  console.log("");

  // Run baseline per pair × treasury size matrix
  console.log("🎯 Running BASELINE (live config) per pair × treasury size…");
  type PairSized = {
    pair: PairConfig;
    sizeUsd: number;
    replay: ReturnType<typeof replay>;
    metrics: BacktestMetrics;
  };
  const pairSizedResults: PairSized[] = [];
  for (const { pair, bars } of pairHistories) {
    console.log(`  ── ${pair.name} ──`);
    for (const sizeUsd of initialList) {
      const r = replay({
        bars,
        config: pair.strategy,
        initialUsd: sizeUsd,
        feePerTradeUsd: fee,
        slippageBps,
        poolLiquidityUsd, // could be made per-pair later
        twoTickConfirmation: pair.strategy.twoTickConfirmation !== false,
      });
      const m = computeMetrics(r);
      console.log(
        `   $${sizeUsd.toLocaleString().padStart(8)} → trades=${String(m.tradeCount).padStart(3)} ` +
          `aborts=${String(r.slippageAborts).padStart(3)} resets=${String(r.referenceResets).padStart(2)} ` +
          `net=${fmtPct(m.netReturnPct).padStart(7)} vs B&H=${fmtPct(m.alphaPct).padStart(6)} ` +
          `dd=${fmtPct(m.maxDrawdownPct).padStart(7)} sharpe=${m.sharpeRatio.toFixed(2)}`
      );
      pairSizedResults.push({ pair, sizeUsd, replay: r, metrics: m });
    }
  }

  // Pick the first pair's first-size as the "baseline" for the rest of the report
  const baselinePair = pairSizedResults[0];
  const baselineReplay = baselinePair.replay;
  const baseline = baselinePair.metrics;

  // Backward-compat: build sizedResults from the FIRST pair only
  const sizedResults = pairSizedResults
    .filter((r) => r.pair.name === pairHistories[0].pair.name)
    .map(({ sizeUsd, replay: r, metrics }) => ({ sizeUsd, replay: r, metrics }));

  console.log("");

  // Run sweep at default size
  const variants = buildVariants();
  console.log(`🔬 Running param sweep (${variants.length} variants) at $${initialUsd.toLocaleString()}…`);
  const sweep = runSweep({
    bars: history.bars,
    variants,
    initialUsd,
    feePerTradeUsd: fee,
    slippageBps,
  });
  console.log(`   Done. Top: ${sweep[0].label} → net=${fmtPct(sweep[0].metrics.netReturnPct)}`);
  console.log("");

  // Write markdown report
  const md = renderReport({
    days: actualDays,
    history,
    baseline,
    baselineReplay,
    sweep,
    sizedResults,
    pairSizedResults,
    initialUsd,
    fee,
    slippageBps,
    poolLiquidityUsd,
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, md, "utf-8");
  console.log(`📝 Report written → ${outPath}`);

  // Decision gate
  const best = sweep[0];
  const gatePass =
    best.metrics.annualizedReturnPct >= 0.05 &&
    best.metrics.maxDrawdownPct >= -0.15;
  console.log("");
  console.log("─".repeat(60));
  console.log(
    `DECISION GATE: best config returns ${fmtPct(best.metrics.annualizedReturnPct)} annualized ` +
      `with ${fmtPct(best.metrics.maxDrawdownPct)} max DD → ${gatePass ? "✅ PASS" : "❌ FAIL"}`
  );
  console.log("─".repeat(60));
}

function renderReport(p: {
  days: number;
  history: Awaited<ReturnType<typeof loadOrFetch>>;
  baseline: BacktestMetrics;
  baselineReplay: ReturnType<typeof replay>;
  sweep: SweepResult[];
  sizedResults: Array<{ sizeUsd: number; replay: ReturnType<typeof replay>; metrics: BacktestMetrics }>;
  pairSizedResults: Array<{ pair: PairConfig; sizeUsd: number; replay: ReturnType<typeof replay>; metrics: BacktestMetrics }>;
  initialUsd: number;
  fee: number;
  slippageBps: number;
  poolLiquidityUsd: number;
}): string {
  const { days, history, baseline, baselineReplay, sweep, sizedResults, pairSizedResults, initialUsd, fee, slippageBps, poolLiquidityUsd } = p;
  const startDate = new Date(history.bars[0].ts * 1000).toISOString().slice(0, 10);
  const endDate = new Date(history.bars[history.bars.length - 1].ts * 1000).toISOString().slice(0, 10);
  const top = sweep.slice(0, 10);

  const lines: string[] = [];
  lines.push(`# EZ Up Bot — Backtest Report`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Pair: **ZEN/USDC** on Base (Aerodrome pool \`${history.pool}\`)`);
  lines.push(`Window: **${startDate} → ${endDate}** (${days.toFixed(1)} days, ${history.bars.length} hourly bars)`);
  lines.push(`Initial portfolio: **$${initialUsd.toFixed(2)}** (50/50 ZEN/USDC by USD value)`);
  lines.push(`Fee per trade: **$${fee}** · Slippage assumed: **${slippageBps} bps**`);
  lines.push("");
  lines.push(`> **Slippage model**: ${slippageBps} bps floor + AMM constant-product impact from ` +
    `trade notional vs assumed pool depth of \$${(poolLiquidityUsd / 1000).toFixed(0)}K. ` +
    `EZ Path's multi-venue routing splits trades, so real fills should be **better** than this conservative estimate.`);
  lines.push("");

  // === Per-pair comparison section ===
  const uniquePairs = Array.from(new Set(pairSizedResults.map((r) => r.pair.name)));
  if (uniquePairs.length > 1) {
    lines.push(`## Per-pair comparison (at \$${initialUsd.toLocaleString()})`);
    lines.push("");
    lines.push("Same strategy applied to each pair independently. Shows which pairs are good fits for the bracket-trading approach.");
    lines.push("");
    lines.push("| Pair | Trades | Aborts | Resets | Net | vs B&H | Annualized | Max DD | Sharpe |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const r of pairSizedResults.filter((x) => x.sizeUsd === initialUsd)) {
      const m = r.metrics;
      lines.push(
        `| **${r.pair.name}** | ${m.tradeCount} | ${r.replay.slippageAborts} | ${r.replay.referenceResets} | ${fmtPct(m.netReturnPct)} | ${fmtPct(m.alphaPct)} | ${fmtPct(m.annualizedReturnPct)} | ${fmtPct(m.maxDrawdownPct)} | ${m.sharpeRatio.toFixed(2)} |`
      );
    }
    lines.push("");
  }

  // === Treasury scaling section ===
  if (sizedResults.length > 1) {
    lines.push(`## Treasury scaling — same strategy at different sizes`);
    lines.push("");
    lines.push("How the strategy behaves as the Juicebox treasury grows. ");
    lines.push("Slippage scales non-linearly with trade size; the pre-trade gate aborts trades that would exceed 25% of the bracket size in slippage.");
    lines.push("");
    lines.push("| Treasury | Trades | Aborts | Resets | Net | vs B&H | Max DD | Sharpe | Fees+Slip |");
    lines.push("|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const r of sizedResults) {
      const m = r.metrics;
      lines.push(
        `| ${fmtUsd(r.sizeUsd)} | ${m.tradeCount} | ${r.replay.slippageAborts} | ${r.replay.referenceResets} | ${fmtPct(m.netReturnPct)} | ${fmtPct(m.alphaPct)} | ${fmtPct(m.maxDrawdownPct)} | ${m.sharpeRatio.toFixed(2)} | ${fmtUsd(m.totalFeesUsd + m.totalSlippageUsd)} |`
      );
    }
    lines.push("");
    lines.push("**Reading this table**: If the slippage-aborts column climbs with treasury size, it means the strategy is hitting its slippage gate more often — trades are being skipped because they'd cost too much. If alpha drops sharply at larger sizes, the strategy doesn't scale well at the current pool depth.");
    lines.push("");
  }

  // BASELINE section
  lines.push(`## Baseline (live config)`);
  lines.push("");
  lines.push(`Bracket triggers: ${configV3.upsideBrackets.map((b) => fmtPct(b, 0)).join(" / ")} ` +
    `· Slices: ${configV3.upsideSlices.map((s) => fmtPct(s, 0)).join(" / ")} · 2-tick confirmation: ON`);
  lines.push("");
  lines.push(metricsTable(baseline));
  lines.push("");
  lines.push("### TVL sparkline");
  lines.push("");
  lines.push("```");
  lines.push(asciiSpark(baselineReplay.tvlSeries));
  lines.push(`${baselineReplay.tvlSeries[0].toFixed(2)} → ${baselineReplay.tvlSeries[baselineReplay.tvlSeries.length - 1].toFixed(2)} USD`);
  lines.push("```");
  lines.push("");

  if (baselineReplay.trades.length > 0) {
    lines.push("### Baseline trades (first 20)");
    lines.push("");
    lines.push("| # | When | Side | Tier | Price | Notional | TVL after |");
    lines.push("|---:|---|---|---:|---:|---:|---:|");
    baselineReplay.trades.slice(0, 20).forEach((t, i) => {
      const when = new Date(t.ts * 1000).toISOString().slice(0, 16).replace("T", " ");
      const notional = t.zenAmount * t.price;
      lines.push(`| ${i + 1} | ${when} | ${t.side === "SELL_ZEN" ? "SELL" : "BUY "} | ${t.tier} | $${t.price.toFixed(4)} | ${fmtUsd(notional)} | ${fmtUsd(t.tvlAfter)} |`);
    });
    lines.push("");
    if (baselineReplay.trades.length > 20) {
      lines.push(`*…and ${baselineReplay.trades.length - 20} more.*`);
      lines.push("");
    }
  }

  // SWEEP section
  lines.push(`## Parameter sweep — top ${top.length} configs (of ${sweep.length})`);
  lines.push("");
  lines.push("Ranked by net return.");
  lines.push("");
  lines.push("| Rank | Config | Trades | Net | vs B&H | Annualized | Max DD | Sharpe | Fees |");
  lines.push("|---:|---|---:|---:|---:|---:|---:|---:|---:|");
  top.forEach((r, i) => {
    const m = r.metrics;
    lines.push(
      `| ${i + 1} | \`${r.label}\` | ${m.tradeCount} | ${fmtPct(m.netReturnPct)} | ${fmtPct(m.alphaPct)} | ${fmtPct(m.annualizedReturnPct)} | ${fmtPct(m.maxDrawdownPct)} | ${m.sharpeRatio.toFixed(2)} | ${fmtUsd(m.totalFeesUsd + m.totalSlippageUsd)} |`
    );
  });
  lines.push("");

  // Recommendation
  const best = sweep[0];
  const gatePass =
    best.metrics.annualizedReturnPct >= 0.05 && best.metrics.maxDrawdownPct >= -0.15;
  lines.push(`## Recommendation`);
  lines.push("");
  lines.push(`**Best config**: \`${best.label}\``);
  lines.push("");
  lines.push(metricsTable(best.metrics));
  lines.push("");
  lines.push(
    `**Decision gate** (≥5% annualized return AND ≤15% max drawdown): ` +
      (gatePass ? "✅ **PASS** — strategy meets minimum viability bar." : "❌ **FAIL** — strategy does not meet viability bar at any tested config.")
  );
  lines.push("");
  if (gatePass) {
    lines.push(`If this config holds up under walk-forward testing, consider applying it to the live bot.`);
  } else {
    lines.push(`Do not launch the Juicebox token at this point. Either: (a) wait for more market data, ` +
      `(b) revise the strategy fundamentally, or (c) accept that this strategy may not be profitable ` +
      `for ZEN/USDC at current volatility levels.`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("*Generated by `src/backtest/runner.ts`. Source: Geckoterminal. ` +" +
    "`Strategy under test: `decideActionV3` from `src/engine.ts` (no logic duplication).*");
  lines.push("");
  return lines.join("\n");
}

function metricsTable(m: BacktestMetrics): string {
  return [
    "| Metric | Value |",
    "|---|---:|",
    `| Start TVL | ${fmtUsd(m.startTvl)} |`,
    `| End TVL | ${fmtUsd(m.endTvl)} |`,
    `| Net return | **${fmtPct(m.netReturnPct)}** |`,
    `| Buy-and-hold return | ${fmtPct(m.buyAndHoldReturnPct)} |`,
    `| Alpha (strategy − B&H) | **${fmtPct(m.alphaPct)}** |`,
    `| Annualized return | ${fmtPct(m.annualizedReturnPct)} |`,
    `| Max drawdown | ${fmtPct(m.maxDrawdownPct)} |`,
    `| Sharpe ratio (annualized) | ${m.sharpeRatio.toFixed(2)} |`,
    `| Trades | ${m.tradeCount} (${m.buyCount} buys / ${m.sellCount} sells) |`,
    `| Avg trade notional | ${fmtUsd(m.avgTradeNotionalUsd)} |`,
    `| Win rate (next-bar TVL up) | ${fmtPct(m.winRate, 1)} |`,
    `| Total fees | ${fmtUsd(m.totalFeesUsd)} |`,
    `| Total slippage | ${fmtUsd(m.totalSlippageUsd)} |`,
    `| Fee drag (% of start TVL) | ${fmtPct(m.feeDragPct, 2)} |`,
    `| Window | ${m.days.toFixed(1)} days (${m.barsCount} bars) |`,
  ].join("\n");
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
