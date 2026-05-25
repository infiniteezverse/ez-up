import type { BotState, Config, MarketData, TradeAction } from "./types.js";

export interface SafeguardContext {
  priceChange24h: number;
  openingZenValueUsd: number;
  openingUsdcValueUsd: number;
}

export function getDayKey(ts: number): number {
  const d = new Date(ts);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export function decideActionV3(
  state: BotState,
  market: MarketData,
  config: Config,
  safeguards: SafeguardContext,
  now: number
): TradeAction {
  const {
    currentPrice,
    zenBalance,
    usdcBalance,
    zenValuePct,
    usdcValuePct,
    dailyVol,
    hourlyVolumeUsd,
    dailyVolumeUsd,
  } = market;

  const { entryPrice, lastCycleHigh, lastTradeAt, tradesToday, lastTradeDay } = state;

  const todayKey = getDayKey(now);
  const effectiveTradesToday = todayKey === lastTradeDay ? tradesToday : 0;
  if (config.maxTradesPerDay && effectiveTradesToday >= config.maxTradesPerDay) {
    return { action: "HOLD", percentOfAsset: 0, reason: "Daily trade cap reached." };
  }

  if (now - lastTradeAt < config.minTradeIntervalMs) {
    const remainingMin = Math.ceil((config.minTradeIntervalMs - (now - lastTradeAt)) / 60000);
    return { action: "HOLD", percentOfAsset: 0, reason: `Cooldown active (${remainingMin}m remaining).` };
  }

  if (config.enableVolFilter && config.minDailyVol !== undefined && dailyVol !== undefined) {
    if (dailyVol < config.minDailyVol) {
      return { action: "HOLD", percentOfAsset: 0, reason: "Daily volatility too low." };
    }
  }

  if (
    config.enableVolumeFilter &&
    config.minVolumeRatio !== undefined &&
    hourlyVolumeUsd !== undefined &&
    dailyVolumeUsd !== undefined &&
    dailyVolumeUsd > 0
  ) {
    const hourlyAvg = dailyVolumeUsd / 24;
    const ratio = hourlyVolumeUsd / hourlyAvg;
    if (ratio < config.minVolumeRatio) {
      return { action: "HOLD", percentOfAsset: 0, reason: "Market volume too low." };
    }
  }

  const currentZenValueUsd = (Number(zenBalance) / 1e18) * currentPrice;
  const currentUsdcValueUsd = Number(usdcBalance) / 1e6;
  const totalCurrentUsd = currentZenValueUsd + currentUsdcValueUsd;
  const totalOpeningUsd = safeguards.openingZenValueUsd + safeguards.openingUsdcValueUsd;
  const dailyPnlPct = totalOpeningUsd > 0 ? (totalCurrentUsd - totalOpeningUsd) / totalOpeningUsd : 0;

  const effectiveHigh = Math.max(lastCycleHigh, currentPrice);
  const upsideMove = (currentPrice - entryPrice) / entryPrice;
  const downsideMove = (currentPrice - effectiveHigh) / effectiveHigh;

  if (upsideMove > 0) {
    let idx = -1;
    for (let i = config.upsideBrackets.length - 1; i >= 0; i--) {
      if (upsideMove >= config.upsideBrackets[i]) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) {
      if (zenValuePct <= config.minZenPct) {
        return { action: "HOLD", percentOfAsset: 0, reason: "ZEN at 30% floor; cannot sell more." };
      }

      const isTier1 = idx === 0;
      const isStrongTrend = Math.abs(safeguards.priceChange24h) > 0.15;
      if (isTier1 && isStrongTrend) {
        return { action: "HOLD", percentOfAsset: 0, reason: `Strong 24h trend (+${(safeguards.priceChange24h * 100).toFixed(1)}%); skipping tier 1 to let trend run.` };
      }

      const isSameDecision = state.lastDecisionAction === "SELL_ZEN" && state.lastDecisionTier === idx + 1;
      if (isSameDecision) {
        const slice = config.upsideSlices[idx];
        const zenAmount = Number(zenBalance) / 1e18;
        const notional = zenAmount * slice * currentPrice;
        if (notional < config.minTradeNotional) {
          return { action: "HOLD", percentOfAsset: 0, reason: `Upside slice $${notional.toFixed(2)} < $${config.minTradeNotional} min.` };
        }
        return {
          action: "SELL_ZEN",
          percentOfAsset: slice,
          tier: idx + 1,
          notionalUsd: notional,
          reason: `Upside +${(upsideMove * 100).toFixed(2)}% tier ${idx + 1} confirmed (2 ticks). Sell ${(slice * 100).toFixed(0)}% ZEN ($${notional.toFixed(2)}).`,
        };
      } else {
        return {
          action: "SELL_ZEN",
          percentOfAsset: 0,
          tier: idx + 1,
          reason: `Upside +${(upsideMove * 100).toFixed(2)}% tier ${idx + 1} signal; awaiting 2-tick confirmation.`,
        };
      }
    }
  }

  if (downsideMove < 0) {
    let idx = -1;
    for (let i = config.downsideBrackets.length - 1; i >= 0; i--) {
      if (downsideMove <= config.downsideBrackets[i]) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) {
      const minUsdcPct = 1 - config.maxZenPct;
      if (zenValuePct >= config.maxZenPct || usdcValuePct <= minUsdcPct) {
        return { action: "HOLD", percentOfAsset: 0, reason: "ZEN at 70% ceiling or USDC below 30%; cannot buy more." };
      }

      if (dailyPnlPct < -0.10) {
        return { action: "HOLD", percentOfAsset: 0, reason: `Daily P&L down ${(dailyPnlPct * 100).toFixed(1)}%; halting buys to prevent averaging into dump.` };
      }

      const isSameDecision = state.lastDecisionAction === "BUY_ZEN" && state.lastDecisionTier === idx + 1;
      if (isSameDecision) {
        const slice = config.downsideSlices[idx];
        const usdcAmount = Number(usdcBalance) / 1e6;
        const notional = usdcAmount * slice;
        if (notional < config.minTradeNotional) {
          return { action: "HOLD", percentOfAsset: 0, reason: `Downside slice $${notional.toFixed(2)} < $${config.minTradeNotional} min.` };
        }
        return {
          action: "BUY_ZEN",
          percentOfAsset: slice,
          tier: idx + 1,
          notionalUsd: notional,
          reason: `Downside ${(downsideMove * 100).toFixed(2)}% tier ${idx + 1} confirmed (2 ticks). Buy ZEN with ${(slice * 100).toFixed(0)}% USDC ($${notional.toFixed(2)}).`,
        };
      } else {
        return {
          action: "BUY_ZEN",
          percentOfAsset: 0,
          tier: idx + 1,
          reason: `Downside ${(downsideMove * 100).toFixed(2)}% tier ${idx + 1} signal; awaiting 2-tick confirmation.`,
        };
      }
    }
  }

  return {
    action: "HOLD",
    percentOfAsset: 0,
    reason: `Within bands (price=$${currentPrice.toFixed(4)}, entry=$${entryPrice.toFixed(4)}, high=$${effectiveHigh.toFixed(4)}).`,
  };
}
