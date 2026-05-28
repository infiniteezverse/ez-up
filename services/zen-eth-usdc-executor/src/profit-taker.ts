/**
 * Profit Taking Layers System
 * Exits positions in tranches at different profit levels
 * Locks in gains and reduces risk while capturing upside
 */

import { ProfitLayer } from './market-regime';

export interface PositionTranche {
  trancheId: string;
  quantity: bigint; // Amount of asset in this tranche
  entryPrice: number; // Price at which we bought
  entryTimestamp: number;
  profitTarget: number; // Profit % at which to exit (0.02 = 2%)
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  exitTimestamp?: number;
  realizedPnL?: number; // In USD
}

/**
 * Create tranches from a buy trade
 * Divides position into layers for profit-taking
 */
export function createTransches(
  baseTrancheId: string,
  totalQuantity: bigint,
  entryPrice: number,
  layers: ProfitLayer[],
  timestamp: number
): PositionTranche[] {
  const tranches: PositionTranche[] = [];

  layers.forEach((layer, index) => {
    const trancheQuantity = (totalQuantity * BigInt(Math.floor(layer.percentOfPosition * 10000))) / BigInt(10000);

    tranches.push({
      trancheId: `${baseTrancheId}-L${index + 1}`,
      quantity: trancheQuantity,
      entryPrice,
      entryTimestamp: timestamp,
      profitTarget: layer.profitTarget,
      status: 'OPEN',
    });
  });

  return tranches;
}

/**
 * Check if any tranches should be exited at current price
 */
export function checkProfitTargets(
  tranches: PositionTranche[],
  currentPrice: number,
  timestamp: number
): {
  tranches: PositionTranche[];
  exitingTransches: PositionTranche[];
  totalQuantityToExit: bigint;
  estimatedProceeds: number;
} {
  const exitingTransches: PositionTranche[] = [];
  let totalQuantityToExit = BigInt(0);
  let estimatedProceeds = 0;

  const updatedTranches = tranches.map(tranche => {
    if (tranche.status === 'CLOSED') {
      return tranche;
    }

    // Calculate profit on this tranche
    const profitPercent = (currentPrice - tranche.entryPrice) / tranche.entryPrice;

    // If profit target hit, mark for exit
    if (profitPercent >= tranche.profitTarget) {
      const exitedTranche: PositionTranche = {
        ...tranche,
        status: 'CLOSED',
        exitPrice: currentPrice,
        exitTimestamp: timestamp,
        realizedPnL:
          Number(tranche.quantity) / 1e18 * currentPrice -
          Number(tranche.quantity) / 1e18 * tranche.entryPrice,
      };

      exitingTransches.push(exitedTranche);
      totalQuantityToExit += tranche.quantity;
      estimatedProceeds += Number(tranche.quantity) / 1e18 * currentPrice;

      return exitedTranche;
    }

    return tranche;
  });

  return {
    tranches: updatedTranches,
    exitingTransches,
    totalQuantityToExit,
    estimatedProceeds,
  };
}

/**
 * Calculate portfolio-level profit metrics from tranches
 */
export function calculateTrancheMetrics(tranches: PositionTranche[]) {
  const closedTranches = tranches.filter(t => t.status === 'CLOSED');
  const openTranches = tranches.filter(t => t.status === 'OPEN');

  const realizedPnL = closedTranches.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
  const realizedCount = closedTranches.length;

  const unrealizedValue = openTranches.reduce((sum, t) => sum + Number(t.quantity) / 1e18, 0);

  return {
    realizedPnL,
    realizedTrancheCount: realizedCount,
    unrealizedQuantity: unrealizedValue,
    totalTranches: tranches.length,
    closureRate: realizedCount / Math.max(1, tranches.length),
  };
}

/**
 * Log tranche activity for transparency
 */
export function formatTrancheLog(tranche: PositionTranche, asset: string): string {
  if (tranche.status === 'OPEN') {
    return `[${tranche.trancheId}] OPEN ${tranche.quantity} @ $${tranche.entryPrice.toFixed(2)}, target +${(tranche.profitTarget * 100).toFixed(1)}%`;
  }

  const pnl = tranche.realizedPnL || 0;
  const pnlStr = pnl > 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;

  return `[${tranche.trancheId}] CLOSED ${tranche.quantity} @ $${tranche.exitPrice?.toFixed(2)} (${pnlStr})`;
}

/**
 * Aggregate tranches by entry price (for accounting)
 */
export function aggregateTranschesByEntry(
  tranches: PositionTranche[]
): Map<number, { totalQuantity: bigint; tranches: PositionTranche[] }> {
  const aggregated = new Map<number, { totalQuantity: bigint; tranches: PositionTranche[] }>();

  tranches.forEach(tranche => {
    const key = tranche.entryPrice;
    const existing = aggregated.get(key);

    if (existing) {
      existing.totalQuantity += tranche.quantity;
      existing.tranches.push(tranche);
    } else {
      aggregated.set(key, {
        totalQuantity: tranche.quantity,
        tranches: [tranche],
      });
    }
  });

  return aggregated;
}

/**
 * Calculate average entry price for a group of tranches
 */
export function calculateAverageEntryPrice(tranches: PositionTranche[]): number {
  if (tranches.length === 0) return 0;

  const totalCost = tranches.reduce((sum, t) => {
    return sum + Number(t.quantity) / 1e18 * t.entryPrice;
  }, 0);

  const totalQuantity = tranches.reduce((sum, t) => sum + Number(t.quantity) / 1e18, 0);

  return totalQuantity > 0 ? totalCost / totalQuantity : 0;
}
