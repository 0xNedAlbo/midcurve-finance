/**
 * Lot Selector — Strategy pattern for cost basis tracking methods.
 *
 * Each implementation orders open lots differently for disposal:
 * - FIFO: oldest lots first (acquiredAt ASC)
 * - LIFO: newest lots first (future)
 * - HIFO: highest cost basis first (future)
 * - WAC:  weighted average across all open lots (future)
 */

import type { CostBasisMethod } from '@midcurve/shared';

// =============================================================================
// Types
// =============================================================================

/** Minimal lot data needed by selectors. */
export interface OpenLot {
  id: string;
  openQuantity: string; // bigint string — remaining unconsumed
  costBasisAbsolute: string; // bigint string — total lot cost basis (reporting currency, scaled 10^8)
  quantity: string; // bigint string — original lot quantity
  acquiredAt: Date;
  sequenceNum: number;
}

/** A single allocation from a lot toward a disposal. */
export interface LotAllocation {
  lotId: string;
  quantityFromLot: bigint; // how much to consume from this lot
  costBasisAllocated: bigint; // proportional cost basis (reporting currency, scaled 10^8)
}

/** Strategy interface — implementations define lot ordering. */
export interface LotSelector {
  readonly method: CostBasisMethod;

  /**
   * Select and allocate lots for a disposal of `quantityNeeded`.
   *
   * Implementations MUST:
   * 1. Order lots according to their strategy
   * 2. Greedily consume lots until quantityNeeded is satisfied
   * 3. Compute proportional cost basis for partial lot consumption
   *
   * @throws Error if total open quantity across all lots is insufficient
   */
  allocate(openLots: readonly OpenLot[], quantityNeeded: bigint): LotAllocation[];
}

// =============================================================================
// FIFO Implementation
// =============================================================================

export class FifoLotSelector implements LotSelector {
  readonly method: CostBasisMethod = 'fifo';

  allocate(openLots: readonly OpenLot[], quantityNeeded: bigint): LotAllocation[] {
    // Sort oldest first (acquiredAt ASC, sequenceNum ASC for tie-breaking)
    const sorted = [...openLots].sort((a, b) => {
      const timeDiff = a.acquiredAt.getTime() - b.acquiredAt.getTime();
      return timeDiff !== 0 ? timeDiff : a.sequenceNum - b.sequenceNum;
    });

    return greedyAllocate(sorted, quantityNeeded);
  }
}

// =============================================================================
// Factory
// =============================================================================

const SELECTORS: Record<CostBasisMethod, () => LotSelector> = {
  fifo: () => new FifoLotSelector(),
  lifo: () => { throw new Error('LIFO lot selector not yet implemented'); },
  hifo: () => { throw new Error('HIFO lot selector not yet implemented'); },
  wac: () => { throw new Error('WAC lot selector not yet implemented'); },
};

/** Resolve a LotSelector by method name. */
export function createLotSelector(method: CostBasisMethod): LotSelector {
  return SELECTORS[method]();
}

// =============================================================================
// Shared allocation logic
// =============================================================================

/**
 * Greedily consume lots in the given order until `quantityNeeded` is met.
 * Cost basis is allocated proportionally for partial consumption.
 */
function greedyAllocate(
  orderedLots: readonly OpenLot[],
  quantityNeeded: bigint,
): LotAllocation[] {
  let remaining = quantityNeeded;
  const allocations: LotAllocation[] = [];

  for (const lot of orderedLots) {
    if (remaining <= 0n) break;

    const available = BigInt(lot.openQuantity);
    if (available <= 0n) continue;

    const take = available <= remaining ? available : remaining;
    const totalCost = BigInt(lot.costBasisAbsolute);
    const totalQty = BigInt(lot.quantity);

    // Proportional cost basis: (take / totalQty) * totalCost
    // If taking the entire remaining open quantity and it equals the original quantity,
    // allocate full cost basis to avoid rounding dust.
    const costBasisAllocated =
      take === totalQty ? totalCost : (take * totalCost) / totalQty;

    allocations.push({ lotId: lot.id, quantityFromLot: take, costBasisAllocated });
    remaining -= take;
  }

  if (remaining > 0n) {
    throw new Error(
      `Insufficient open lots: needed ${quantityNeeded.toString()}, ` +
        `short by ${remaining.toString()}`
    );
  }

  return allocations;
}
