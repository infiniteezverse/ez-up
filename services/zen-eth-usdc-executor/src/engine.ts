import {
  TradeDecision,
  TradeAction,
  PairState,
  GlobalState,
  MarketData,
  AssetPair,
  VolatilityMetrics,
  TradeRecord,
} from './types';
import { getConfigForPair } from './config';
import { calculateVolatilityMetrics, adjustBracketByMultiplier, needsDailyRecalc } from './volatility';
import { hasAmnesia, resetPairAmnesia, isNewDay, resetDailyMetrics } from './state';
import { simulateSwapOutput } from './executor';

interface DecisionContext {
  pairState: PairState;
  globalState: GlobalState;
  marketData: MarketData;
  volatilityMetrics: VolatilityMetrics;
  tradeHistory: TradeRecord[];
}

/**
 * Core bracket decision engine for V2 executor.
 * Evaluates both ZEN and ETH independently with per-pair state isolation.
 *
 * Decision flow:
 * 1. Check amnesia gate (72h reset if no trades)
 * 2. Check daily P&L stop (halt buys if down > 10%)
 * 3. Evaluate bracket tiers (adjusted by 90-day volatility)
 * 4. Apply two-tick confirmation (last decision must match current)
 * 5. Apply trend filter (skip tier 1 buys if volatile)
 * 6. Check allocation bands (30% floor, 70% ceiling)
 * 7. Validate with slippage simulation gate
 * 8. Return decision with Alpha Depth priority
 */
export async function decideActionV3(context: DecisionContext): Promise<TradeDecision | null> {
  const {
    pairState,
    globalState,
    marketData,
    volatilityMetrics,
    tradeHistory,
  } = context;

  const config = getConfigForPair(marketData.pair);
  const now = Date.now();

  // ============ GATE 1: Amnesia Check ============
  if (hasAmnesia(pairState, config.amnesiaDurationMs, now)) {
    console.log(`[engine.ts] ${marketData.pair}: Amnesia expired, resetting brackets`);
    // Note: caller is responsible for updating state with resetPairAmnesia()
  }

  // ============ GATE 2: Daily P&L Stop ============
  if (config.dailyPnlStopPercent < 0) {
    if (globalState.dailyDrawdownPercent > Math.abs(config.dailyPnlStopPercent)) {
      console.log(
        `[engine.ts] ${marketData.pair}: Daily P&L stop triggered (drawdown ${(globalState.dailyDrawdownPercent * 100).toFixed(2)}% > ${Math.abs(config.dailyPnlStopPercent) * 100}%)`
      );
      return {
        action: 'HOLD',
        pair: marketData.pair,
        percentOfAsset: 0,
        reason: 'Daily P&L stop active',
      };
    }
  }

  // ============ GATE 3: Allocation Bands ============
  const assetPct = marketData.assetValuePct;
  const usdcPct = marketData.usdcValuePct;

  const canBuy = assetPct < config.maxAssetPct; // Buy if not at ceiling
  const canSell = assetPct > config.minAssetPct; // Sell if not at floor

  if (!canBuy && !canSell) {
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `Allocation bands [${(config.minAssetPct * 100).toFixed(0)}%-${(config.maxAssetPct * 100).toFixed(0)}%] constraining`,
    };
  }

  // ============ GATE 4: Bracket Evaluation ============
  // Recalculate volatility metrics if > 24h old
  let currentVolatility = volatilityMetrics;
  if (needsDailyRecalc(volatilityMetrics, now)) {
    currentVolatility = calculateVolatilityMetrics(marketData.pair, tradeHistory, now);
    console.log(
      `[engine.ts] ${marketData.pair}: Volatility recalculated: realized=${(currentVolatility.realized90dVol * 100).toFixed(2)}%, multiplier=${currentVolatility.tierMultiplier.toFixed(2)}`
    );
  }

  // Calculate adjusted bracket tiers
  const adjustedUpsideBrackets = config.upsideBrackets.map(
    bracket => adjustBracketByMultiplier(bracket, currentVolatility.tierMultiplier)
  );
  const adjustedDownsideBrackets = config.downsideBrackets.map(
    bracket => adjustBracketByMultiplier(bracket, currentVolatility.tierMultiplier)
  );

  // Calculate moves from entry price (or last cycle high)
  const entryPrice = pairState.entryPrice || marketData.currentPrice;
  const cycleHigh = pairState.lastCycleHigh || marketData.currentPrice;

  const moveFromEntry = (marketData.currentPrice - entryPrice) / entryPrice;
  const moveFromHigh = (marketData.currentPrice - cycleHigh) / cycleHigh;

  // ============ BRACKET TIER SELECTION ============
  let selectedTier: number | null = null;
  let selectedAction: TradeAction = 'HOLD';
  let tierBreachPercentage = 0;

  // Check upside brackets (highest unbreached tier)
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

  // Check downside brackets (most negative unbreached)
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

  // ============ GATE 6: Trend Filter ============
  if (selectedAction === 'BUY' && selectedTier === 0) {
    // Tier 1 buys disabled in volatile markets
    if (marketData.dailyVolatility > config.trendFilterThreshold) {
      return {
        action: 'HOLD',
        pair: marketData.pair,
        percentOfAsset: 0,
        reason: `Trend filter blocks tier 1 buy (24h vol=${(marketData.dailyVolatility * 100).toFixed(2)}% > ${(config.trendFilterThreshold * 100).toFixed(0)}%)`,
      };
    }
  }

  // ============ GATE 7: Trade Count Limit ============
  if (pairState.tradesToday >= config.maxTradesPerDay) {
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `Daily trade limit reached (${pairState.tradesToday}/${config.maxTradesPerDay})`,
    };
  }

  // ============ GATE 8: Slippage Simulation Gate ============
  const sliceSize = selectedAction === 'BUY' ? config.upsideSlices[selectedTier] : config.downsideSlices[selectedTier];

  // Calculate notional in USDC
  let notionalUsd = 0;
  if (selectedAction === 'BUY') {
    // Buy using available USDC
    const portfolioValueUsd = (marketData.assetValuePct + marketData.usdcValuePct > 0)
      ? (marketData.assetBalance * BigInt(Math.floor(marketData.currentPrice * 1e18))) / BigInt(10 ** 18) + marketData.usdcBalance
      : BigInt(0);
    notionalUsd = (Number(portfolioValueUsd) / 10 ** 6) * sliceSize; // Rough estimate; refine with actual balance
  } else {
    // Sell using asset balance
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

  // Check slippage via simulation (prevents front-running, validates liquidity)
  const simulationResult = await simulateSwapOutput(
    selectedAction === 'BUY' ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : (marketData.pair === 'ZEN_USDC' ? '0xf43eb8de897fbc7f2502483b2bef7bb9ea179229' : '0x4200000000000000000000000000000000000006'),
    selectedAction === 'BUY' ? (marketData.pair === 'ZEN_USDC' ? '0xf43eb8de897fbc7f2502483b2bef7bb9ea179229' : '0x4200000000000000000000000000000000000006') : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    notionalUsd.toString(),
    50 // 50 bps (0.5%) slippage tolerance
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
    // > 1% price impact is too high
    return {
      action: 'HOLD',
      pair: marketData.pair,
      percentOfAsset: 0,
      reason: `High price impact: ${(simulationResult.priceImpactBps / 100).toFixed(2)}% > 1%`,
    };
  }

  // ============ DECISION READY ============
  // Calculate Alpha Depth: percentage breach of bracket threshold
  // Higher = more confident signal (deeper into the move)
  const alphaDepth = tierBreachPercentage / (adjustedUpsideBrackets[selectedTier] || 1);

  return {
    action: selectedAction,
    pair: marketData.pair,
    percentOfAsset: sliceSize,
    tier: selectedTier,
    notionalUsd,
    reason: `Tier ${selectedTier} ${selectedAction} (${(moveFromEntry * 100).toFixed(2)}% move, vol=${(currentVolatility.realized90dVol * 100).toFixed(0)}%, multiplier=${currentVolatility.tierMultiplier.toFixed(2)})`,
    alphaDepth,
  };
}

/**
 * Compare two decisions by Alpha Depth for priority ranking.
 * Used in main loop to execute highest-confidence signals first.
 * Returns: positive if a > b, negative if a < b, zero if equal.
 */
export function compareAlphaDepth(a: TradeDecision, b: TradeDecision): number {
  const depthA = a.alphaDepth || 0;
  const depthB = b.alphaDepth || 0;
  return depthB - depthA; // Descending (highest first)
}
