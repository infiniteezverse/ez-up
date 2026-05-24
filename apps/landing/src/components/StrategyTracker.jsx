import { useEffect, useState } from 'react';
import {
  BOT_WALLET,
  ZEN_ADDRESS,
  USDC_ADDRESS,
  ZEN_DECIMALS,
  USDC_DECIMALS,
  ZEN_PRICE_USD,
  USDC_PRICE_USD,
  HISTORY_URL,
  STATS_REFRESH_MS,
  LINKS,
} from '../config.js';
import { fetchTokenBalance } from '../utils/basescan.js';
import { fetchZenPriceUsd } from '../utils/dexscreener.js';

function fmtUsd(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function fmtPct(n, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtSignedPct(n) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(2)}%`;
}

async function fetchHistory() {
  if (!HISTORY_URL) return null;
  try {
    const res = await fetch(HISTORY_URL);
    if (!res.ok) return null;
    const data = await res.json();
    return data.entries ?? [];
  } catch {
    return null;
  }
}

function Sparkline({ data, width = 600, height = 120 }) {
  if (!data || data.length < 2) return null;
  const values = data.map((d) => d.tvlUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  const points = data
    .map((d, i) => {
      const x = i * stepX;
      const y = height - ((d.tvlUsd - min) / range) * (height - 10) - 5;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const last = data[data.length - 1];
  const first = data[0];
  const delta = last.tvlUsd - first.tvlUsd;
  const positive = delta >= 0;
  const stroke = positive ? '#22c55e' : '#ef4444';
  const fill = positive ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-32 w-full"
    >
      <polygon points={areaPoints} fill={fill} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-100 sm:text-3xl">{value}</div>
      {sub && <div className="mt-1 text-sm text-slate-400">{sub}</div>}
    </div>
  );
}

export default function StrategyTracker() {
  const [live, setLive] = useState(null);     // { zen, usdc, zenPrice, tvl, zenPct, usdcPct }
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [zenRaw, usdcRaw, zenPriceLive, hist] = await Promise.all([
        fetchTokenBalance(BOT_WALLET, ZEN_ADDRESS),
        fetchTokenBalance(BOT_WALLET, USDC_ADDRESS),
        fetchZenPriceUsd(),
        fetchHistory(),
      ]);
      if (cancelled) return;

      const zen = zenRaw / 10 ** ZEN_DECIMALS;
      const usdc = usdcRaw / 10 ** USDC_DECIMALS;
      const zenPrice = zenPriceLive ?? ZEN_PRICE_USD;
      const zenValueUsd = zen * zenPrice;
      const usdcValueUsd = usdc * USDC_PRICE_USD;
      const tvl = zenValueUsd + usdcValueUsd;
      const zenPct = tvl > 0 ? zenValueUsd / tvl : 0;
      const usdcPct = tvl > 0 ? usdcValueUsd / tvl : 0;

      setLive({ zen, usdc, zenPrice, tvl, zenPct, usdcPct });
      setHistory(hist);
      setLoading(false);
      setUpdatedAt(new Date());
    }

    load();
    const id = setInterval(load, STATS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Compute 7-day P&L from history if available
  let pnl7d = null;
  let totalTradesFromHistory = null;
  let last7 = null;
  if (history && history.length > 0 && live) {
    last7 = history.slice(-7);
    if (last7.length >= 2) {
      const start = last7[0].tvlUsd;
      const end = live.tvl;
      pnl7d = start > 0 ? (end - start) / start : 0;
    }
    totalTradesFromHistory = history[history.length - 1].totalTrades;
  }

  const showWaiting = !HISTORY_URL;

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-500">
          Loading strategy data…
        </div>
      ) : (
        <>
          {/* Top row: 4 metric cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="TVL"
              value={fmtUsd(live.tvl)}
              sub={`ZEN $${live.zenPrice.toFixed(4)}`}
            />
            <MetricCard
              label="7-Day P&L"
              value={
                pnl7d === null ? '—' : fmtSignedPct(pnl7d)
              }
              sub={
                pnl7d === null
                  ? showWaiting
                    ? 'Waiting for history feed'
                    : 'Need ≥ 2 days of data'
                  : `${last7?.length ?? 0}-day window`
              }
            />
            <MetricCard
              label="Allocation"
              value={`${fmtPct(live.zenPct, 0)} / ${fmtPct(live.usdcPct, 0)}`}
              sub="ZEN / USDC"
            />
            <MetricCard
              label="Lifetime Trades"
              value={totalTradesFromHistory ?? '—'}
              sub={
                totalTradesFromHistory === null
                  ? showWaiting
                    ? 'Waiting for history feed'
                    : 'Will appear after first snapshot'
                  : 'Executed via EZ Path'
              }
            />
          </div>

          {/* Sparkline */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-slate-100">
                TVL — Last 7 Days
              </h3>
              <span className="text-xs text-slate-500">
                {updatedAt && `Updated ${updatedAt.toLocaleTimeString()}`}
              </span>
            </div>

            {history && history.length >= 2 ? (
              <Sparkline data={history.slice(-7)} />
            ) : (
              <div className="py-8 text-center text-sm text-slate-500">
                {showWaiting
                  ? 'Chart will appear once the bot publishes its history feed.'
                  : 'Chart will appear once the bot has run for ≥ 2 days.'}
              </div>
            )}

            <p className="mt-4 text-xs text-slate-500">
              Live balances from{' '}
              <a
                href={LINKS.botWallet}
                target="_blank"
                rel="noreferrer"
                className="text-brand-cyan hover:underline"
              >
                bot wallet on Basescan
              </a>
              {' '}· ZEN price from DexScreener · daily TVL snapshots written
              by the bot.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
