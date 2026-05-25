/**
 * CLI: npx tsx src/backtest/runner.ts [--days 90] [--out backtest-results/{date}.md]
 *
 * Fetches historical ZEN/USDC OHLCV, replays the live strategy across a
 * Cartesian sweep of bracket × slice × twoTick variants, and writes a
 * markdown report.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { configV3 } from "../config.js";
import { computeMetrics, fmtPct, fmtUsd, type BacktestMetrics } from "./metrics.js";
import { loadOrFetch } from "./priceHistory.js";
import { buildVariants, runSweep, type SweepResult } from "./paramSweep.js";
import { replay } from "./replay.js";

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
  const initialUsd = Number(arg("initial", "150"));
  const slippageBps = Number(arg("slippage", "10"));
  const fee = Number(arg("fee", "0.03"));

  console.log(`📊 Backtest — ${days}d of ZEN/USDC on Base`);
  console.log(`   Initial portfolio: $${initialUsd.toFixed(2)} (50/50 split)`);
  console.log(`   Fee per trade: $${fee} · Slippage: ${slippageBps} bps`);
  console.log("");

  console.log("⏳ Fetching historical OHLCV from Geckoterminal…");
  const history = await loadOrFetch({ days, timeframe: "hour" });
  if (history.bars.length === 0) {
    console.error("❌ No bars returned");
    process.exit(1);
  }
  const actualDays = (history.bars[history.bars.length - 1].ts - history.bars[0].ts) / 86400;
  console.log(`   Got ${history.bars.length} hourly bars covering ${actualDays.toFixed(1)} days`);
  console.log("");

  // Run baseline (live config, twoTick=on)
  console.log("🎯 Running BASELINE (live config)…");
  const baselineReplay = replay({
    bars: history.bars,
    config: configV3,
    initialUsd,
    feePerTradeUsd: fee,
    slippageBps,
    twoTickConfirmation: true,
  });
  const baseline = computeMetrics(baselineReplay);
  console.log(
    `   trades=${baseline.tradeCount} net=${fmtPct(baseline.netReturnPct)} ` +
      `vs B&H=${fmtPct(baseline.buyAndHoldReturnPct)} ` +
      `dd=${fmtPct(baseline.maxDrawdownPct)} sharpe=${baseline.sharpeRatio.toFixed(2)}`
  );
  console.log("");

  // Run sweep
  const variants = buildVariants();
  console.log(`🔬 Running param sweep (${variants.length} variants)…`);
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
    initialUsd,
    fee,
    slippageBps,
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
  initialUsd: number;
  fee: number;
  slippageBps: number;
}): string {
  const { days, history, baseline, baselineReplay, sweep, initialUsd, fee, slippageBps } = p;
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
  lines.push(`> **Caveat**: backtest assumes you'd have gotten the same closing-bar price as a fill, ` +
    `with a flat ${slippageBps} bps slippage adjustment and \$${fee} per trade. Real fills will differ, ` +
    `especially during fast moves.`);
  lines.push("");

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
