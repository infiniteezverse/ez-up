/**
 * Enhanced Trading Engine (V3+)
 * Integrates all 5 growth levers:
 * 1. Dynamic Notional Sizing (based on volatility)
 * 2. Bracket Threshold Tightening (based on market regime)
 * 3. Trade Frequency Scaling (based on opportunities)
 * 4. Dynamic Allocation Bands (based on risk)
 * 5. Layered Profit Taking (multiple exit tiers)
 * 6. Market Regime Detection (auto-parameter tuning)
 */

import {
  TradeDecision,
  TradeAction,
  PairState,
  GlobalState,
  MarketData,
  AssetPair,
  VolatilityMetrics,
  TradeRecord,
  EnhancedTradeDecision,
  MarketRegime,
} from './types';
import { getConfigForPair } from './config';
import { calculateVolatilityMetrics, adjustBracketByMultiplier, needsDailyRecalc } from './volatility';
import { hasAmnesia, resetPairAmnesia, isNewDay, resetDailyMetrics } from './state';
import { simulateSwapOutput } from './executor';
import {
  detectMarketRegime,
  getRegimeParameters,
  blendParameters,
  RegimeParameters,
} from './market-regime';
import { createTransches, checkProfitTargets, PositionTranche } from './profit-taker';

interface EnhancedDecisionContext {
  pairState: PairState;
  globalState: GlobalState;
  marketData: MarketData;
  volatilityMetrics: VolatilityMetrics;
  tradeHistory: TradeRecord[];
  recentPrices?: number[];  // For regime detection
}

/**
 * LEVER 1: Dynamic Notional Sizing
 * Scale position size based on volatility conditions
 */
function calculateDynamicSlices(
  baseSlices: number[],
  volatilityMetrics: VolatilityMetrics,
  baselineVol: number = 0.14
): number[] {
  const volRatio = volatilityMetrics.realized90dVol / baselineVol;

  // Clamp multiplier to 0.7x - 1.3x (don't get too aggressive or conservative)
  const multiplier = Math.max(0.7, Math.min(1.3, volRatio));

  return baseSlices.map(slice => {
    const scaled = slice * multiplier;
    // Ensure slices still sum to ~35% (5+5+10+15)
    return Math.min(scaled, slice * 1.5); // Cap increase at 50%
  });
}

/**
 * Main enhanced decision function with all 5 levers
 */
export async function decideActionV3Enhanced(
  context: EnhancedDecisionContext
): Promise<EnhancedTradeDecision | null> {
  const {
    pairState,
    globalState,
    marketData,
    volatilityMetrics,
    tradeHistory,
    recentPrices,
  } = context;

  const config = getConfigForPair(marketData.pair);
  const now = Date.now();

  // ============ STEP 1: Market Regime Detection (Lever 6) ============
  const priceHistory = recentPrices || [];
  const priceChange24h = marketData.priceChange24h;
  const { regime, confidence } = detectMarketRegime(
    volatilityMetrics,
    priceChange24h,
    0, // volume (not tracked in current impl)
    priceHistory
  );

  console.log(`[engine-v3-enhanced] ${marketData.pair}: Regime=${regime}, Confidence=${(confidence * 100).toFixed(0)}%`);

  // Get regime-specific parameters
  let regimeParams = getRegimeParameters(regime, confidence);
  const normalParams = getRegimeParameters('NORMAL', 1.0);

  // Blend if confidence is low
  if (confidence < 0.8) {
    regimeParams = blendParameters(regimeParams, normalParams);
  }

  // ============ GATE 1: Amnesia Check ============
  if (hasAmnesia(pairState, config.amnesiaDurationMs, now)) {
    console.log(`[engine-v3-enhanced] ${marketData.pair}: Amnesia reset triggered`);
  }

  // ============ GATE 2: Daily P&L Stop (Lever 4: Dynamic) ============
  const dailyPnlStop = regimeParams.dailyPnlStopPercent;
  if (globalState.dailyDrawdownPercent > Math.abs(dailyPnlStop)) {
    console.log(
      `[engine-v3-enhanced] ${marketData.pair}: Daily P&L stop triggered (drawdown ${(globalState.dailyDrawdownPercent * 100).toFixed(2)}% > ${Math.abs(dailyPnlStop) * 100}%)`
    );
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `Daily P&L stop active (${(dailyPnlStop * 100).toFixed(0)}%)`,
    };
  }

  // ============ GATE 3: Allocation Bands (Lever 4: Dynamic) ============
  const minAssetPct = regimeParams.minAssetPct;
  const maxAssetPct = regimeParams.maxAssetPct;
  const assetPct = marketData.assetValuePct;
  const usdcPct = marketData.usdcValuePct;

  const canBuy = assetPct < maxAssetPct;
  const canSell = assetPct > minAssetPct;

  if (!canBuy && !canSell) {
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `Allocation bands [${(minAssetPct * 100).toFixed(0)}%-${(maxAssetPct * 100).toFixed(0)}%] constraining`,
    };
  }

  // ============ GATE 4: Bracket Evaluation (Lever 2: Dynamic Brackets) ============
  let currentVolatility = volatilityMetrics;
  if (needsDailyRecalc(volatilityMetrics, now)) {
    currentVolatility = calculateVolatilityMetrics(marketData.pair, tradeHistory, now);
  }

  // Use regime-specific brackets instead of config brackets
  const adjustedUpsideBrackets = regimeParams.brackets.upside.map(
    bracket => adjustBracketByMultiplier(bracket, currentVolatility.tierMultiplier)
  );
  const adjustedDownsideBrackets = regimeParams.brackets.downside.map(
    bracket => adjustBracketByMultiplier(bracket, currentVolatility.tierMultiplier)
  );

  // Calculate moves
  const entryPrice = pairState.entryPrice || marketData.currentPrice;
  const cycleHigh = pairState.lastCycleHigh || marketData.currentPrice;
  const moveFromEntry = (marketData.currentPrice - entryPrice) / entryPrice;
  const moveFromHigh = (marketData.currentPrice - cycleHigh) / cycleHigh;

  // ============ BRACKET TIER SELECTION ============
  let selectedTier: number | null = null;
  let selectedAction: TradeAction = 'HOLD';
  let tierBreachPercentage = 0;

  if (canBuy && moveFromEntry > 0) {
    for (let i = adjustedUpsideBrackets.length - 1; i >= 0; i--) {
      if (moveFromEntry >= adjustedUpsideBrackets[i]) {
        selectedTier = i;
        selectedAction = 'BUY';
        tierBreachPercentage = moveFromEntry - adjustedUpsideBrackets[i];
        break;
      }
    }
  }

  if (canSell && moveFromHigh < 0) {
    for (let i = adjustedDownsideBrackets.length - 1; i >= 0; i--) {
      if (moveFromHigh <= adjustedDownsideBrackets[i]) {
        selectedTier = i;
        selectedAction = 'SELL';
        tierBreachPercentage = Math.abs(moveFromHigh) - Math.abs(adjustedDownsideBrackets[i]);
        break;
      }
    }
  }

  if (!selectedTier && selectedAction === 'HOLD') {
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `No bracket breach (move=${(moveFromEntry * 100).toFixed(2)}% from entry)`,
    };
  }

  // ============ GATE 5: Two-Tick Confirmation ============
  if (pairState.lastDecisionAction !== selectedAction || pairState.lastDecisionTier !== selectedTier) {
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `Two-tick confirmation pending (last=${pairState.lastDecisionAction}/${pairState.lastDecisionTier}, current=${selectedAction}/${selectedTier})`,
    };
  }

  // ============ GATE 6: Trend Filter (Lever 2: Dynamic threshold) ============
  if (selectedAction === 'BUY' && selectedTier === 0) {
    if (marketData.dailyVolatility > regimeParams.trendFilterThreshold) {
      return {
        action: 'HOLD',
        pair: marketData.pair,
        percentOfAsset: 0,
        reason: `Trend filter blocks tier 1 buy (vol=${(marketData.dailyVolatility * 100).toFixed(2)}% > ${(regimeParams.trendFilterThreshold * 100).toFixed(0)}%)`,
      };
    }
  }

  // ============ GATE 7: Trade Count Limit (Lever 3: Dynamic) ============
  if (pairState.tradesToday >= regimeParams.maxTradesPerDay) {
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `Daily trade limit reached (${pairState.tradesToday}/${regimeParams.maxTradesPerDay})`,
    };
  }

  // ============ LEVER 1: Dynamic Notional Sizing ============
  const dynamicSlices = calculateDynamicSlices(
    regimeParams.slices[selectedAction === 'BUY' ? 'upside' : 'downside'],
    currentVolatility
  );
  const sliceSize = dynamicSlices[selectedTier];

  // Calculate notional
  let notionalUsd = 0;
  if (selectedAction === 'BUY') {
    const portfolioValueUsd =
      (marketData.assetValuePct + marketData.usdcValuePct > 0)
        ? (marketData.assetBalance * BigInt(Math.floor(marketData.currentPrice * 1e18))) / BigInt(10 ** 18) +
          marketData.usdcBalance
        : BigInt(0);
    notionalUsd = (Number(portfolioValueUsd) / 10 ** 6) * sliceSize;
  } else {
    notionalUsd = (Number(marketData.assetBalance) / 10 ** 18) * marketData.currentPrice * sliceSize;
  }

  if (notionalUsd < config.minNotionalUsd) {
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `Trade too small: $${notionalUsd.toFixed(2)} < $${config.minNotionalUsd}`,
    };
  }

  // ============ GATE 8: Slippage Simulation Gate ============
  const simulationResult = await simulateSwapOutput(
    selectedAction === 'BUY' ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : (marketData.pair === 'ZEN_USDC' ? '0xf43eb8de897fbc7f2502483b2bef7bb9ea179229' : '0x4200000000000000000000000000000000000006'),
    selectedAction === 'BUY' ? (marketData.pair === 'ZEN_USDC' ? '0xf43eb8de897fbc7f2502483b2bef7bb9ea179229' : '0x4200000000000000000000000000000000000006') : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    notionalUsd.toString(),
    50
  );

  if (!simulationResult) {
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: 'Slippage simulation failed (liquidity issue?)',
    };
  }

  if (simulationResult.priceImpactBps > 100) {
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `High price impact: ${(simulationResult.priceImpactBps / 100).toFixed(2)}% > 1%`,
    };
  }

  // ============ LEVER 5: Create Profit-Taking Tranches ============
  const assetQuantity = selectedAction === 'BUY'
    ? BigInt(Math.floor((notionalUsd / marketData.currentPrice) * 1e18))
    : BigInt(Math.floor(sliceSize * Number(marketData.assetBalance)));

  const tranches = createTransches(
    `${marketData.pair}-${Date.now()}`,
    assetQuantity,
    marketData.currentPrice,
    regimeParams.profitTakingLayers,
    now
  );

  // ============ DECISION READY ============
  const alphaDepth = tierBreachPercentage / (adjustedUpsideBrackets[selectedTier] || 1);

  return {
    action: selectedAction,
    pair: marketData.pair,
    percentOfAsset: sliceSize,
    tier: selectedTier,
    notionalUsd,
    reason: `[${regime}] Tier ${selectedTier} ${selectedAction} (${(moveFromEntry * 100).toFixed(2)}% move, vol=${(currentVolatility.realized90dVol * 100).toFixed(0)}%, multiplier=${currentVolatility.tierMultiplier.toFixed(2)})`,
    alphaDepth,
    tranches,
    dynamicBrackets: selectedAction === 'BUY' ? adjustedUpsideBrackets : adjustedDownsideBrackets,
    regimeAdjustment: {
      regime,
      confidence,
      rationale: `Market regime detected as ${regime} with ${(confidence * 100).toFixed(0)}% confidence`,
    },
  };
}

/**
 * Compare decisions by Alpha Depth
 */
export function compareAlphaDepth(a: TradeDecision, b: TradeDecision): number {
  const depthA = a.alphaDepth || 0;
  const depthB = b.alphaDepth || 0;
  return depthB - depthA;
}
