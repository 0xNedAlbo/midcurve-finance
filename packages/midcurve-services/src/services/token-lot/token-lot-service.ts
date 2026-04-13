/**
 * Token Lot Service
 *
 * CRUD operations for token lots, lot state, and disposals.
 * Provides acquisition (lot creation) and disposal (lot consumption)
 * as atomic Prisma transactions.
 */

import { prisma } from '@midcurve/database';
import type { Prisma } from '@midcurve/database';
import type { AcquisitionTransferEvent, DisposalTransferEvent } from '@midcurve/shared';
import type { LotSelector, LotAllocation } from './lot-selector.js';

// =============================================================================
// Types
// =============================================================================

export interface CreateLotInput {
  userId: string;
  tokenId: string;
  tokenHash: string;
  quantity: string; // bigint string (deltaL)
  costBasisAbsolute: string; // bigint string (reporting currency, scaled 10^8)
  acquiredAt: Date;
  acquisitionEventId: string; // inputHash from PositionLedgerEvent
  transferEvent: AcquisitionTransferEvent;
  journalEntryId?: string;
}

export interface DisposeLotInput {
  userId: string;
  tokenHash: string;
  quantityToDispose: string; // bigint string (deltaL to consume)
  proceedsReporting: string; // bigint string (reporting currency, scaled 10^8)
  disposedAt: Date;
  disposalEventId: string; // inputHash from PositionLedgerEvent
  transferEvent: DisposalTransferEvent;
  lotSelector: LotSelector;
  journalEntryId?: string;
}

export interface DisposalResult {
  disposals: Array<{
    id: string;
    lotId: string;
    quantityDisposed: string;
    costBasisAllocated: string;
    realizedPnl: string;
  }>;
  totalCostBasisAllocated: bigint;
  totalRealizedPnl: bigint;
}

// =============================================================================
// Service
// =============================================================================

export class TokenLotService {
  private static instance: TokenLotService | null = null;

  static getInstance(): TokenLotService {
    if (!TokenLotService.instance) {
      TokenLotService.instance = new TokenLotService();
    }
    return TokenLotService.instance;
  }

  // ===========================================================================
  // Acquisition — create a new lot
  // ===========================================================================

  /**
   * Create a token lot with its initial state.
   * Idempotent via @@unique([userId, tokenHash, acquisitionEventId]).
   */
  async createLot(
    input: CreateLotInput,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const db = tx ?? prisma;

    // Check idempotency
    const existing = await db.tokenLot.findUnique({
      where: {
        userId_tokenHash_acquisitionEventId: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          acquisitionEventId: input.acquisitionEventId,
        },
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    // Next sequence number for this user+token
    const seqNum = await this.nextSequenceNum(input.userId, input.tokenHash, db);

    const lot = await db.tokenLot.create({
      data: {
        userId: input.userId,
        tokenId: input.tokenId,
        tokenHash: input.tokenHash,
        quantity: input.quantity,
        costBasisAbsolute: input.costBasisAbsolute,
        acquiredAt: input.acquiredAt,
        acquisitionEventId: input.acquisitionEventId,
        transferEvent: input.transferEvent,
        sequenceNum: seqNum,
        journalEntryId: input.journalEntryId,
        // Create the 1:1 state row in the same call
        lotState: {
          create: {
            openQuantity: input.quantity,
            isFullyConsumed: false,
          },
        },
      },
    });

    return lot.id;
  }

  // ===========================================================================
  // Disposal — consume lots using a selector strategy
  // ===========================================================================

  /**
   * Dispose (consume) lots according to the given selector strategy.
   *
   * 1. Fetches open lots for the user+token
   * 2. Runs the selector to determine allocation
   * 3. Creates disposal records and updates lot states
   * 4. All within a single transaction
   */
  async disposeLots(input: DisposeLotInput): Promise<DisposalResult> {
    return prisma.$transaction(async (tx) => {
      const openLots = await this.getOpenLots(input.userId, input.tokenHash, tx);

      const quantityNeeded = BigInt(input.quantityToDispose);
      const allocations = input.lotSelector.allocate(openLots, quantityNeeded);

      const totalProceeds = BigInt(input.proceedsReporting);
      const totalCostBasis = allocations.reduce(
        (sum, a) => sum + a.costBasisAllocated, 0n,
      );

      // Distribute proceeds proportionally across allocations
      const disposals = await this.applyAllocations(
        tx,
        input,
        allocations,
        totalProceeds,
        quantityNeeded,
      );

      return {
        disposals,
        totalCostBasisAllocated: totalCostBasis,
        totalRealizedPnl: totalProceeds - totalCostBasis,
      };
    });
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  /**
   * Get all open (not fully consumed) lots for a user+token,
   * suitable for passing to a LotSelector.
   */
  async getOpenLots(
    userId: string,
    tokenHash: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? prisma;
    const lots = await db.tokenLot.findMany({
      where: {
        userId,
        tokenHash,
        lotState: { isFullyConsumed: false },
      },
      include: { lotState: true },
      orderBy: [{ acquiredAt: 'asc' }, { sequenceNum: 'asc' }],
    });

    return lots.map((lot) => ({
      id: lot.id,
      openQuantity: lot.lotState!.openQuantity,
      costBasisAbsolute: lot.costBasisAbsolute,
      quantity: lot.quantity,
      acquiredAt: lot.acquiredAt,
      sequenceNum: lot.sequenceNum,
    }));
  }

  // ===========================================================================
  // Deletion — for position deletion and revert handling
  // ===========================================================================

  /**
   * Delete all lots (and cascading state + disposals) for a user+token.
   */
  async deleteLotsByTokenHash(userId: string, tokenHash: string): Promise<number> {
    const result = await prisma.tokenLot.deleteMany({
      where: { userId, tokenHash },
    });
    return result.count;
  }

  /**
   * Delete lots by their acquisition event IDs (for chain revert handling).
   */
  async deleteLotsByAcquisitionEventIds(
    userId: string,
    tokenHash: string,
    acquisitionEventIds: string[],
  ): Promise<number> {
    const result = await prisma.tokenLot.deleteMany({
      where: {
        userId,
        tokenHash,
        acquisitionEventId: { in: acquisitionEventIds },
      },
    });
    return result.count;
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async nextSequenceNum(
    userId: string,
    tokenHash: string,
    db: Prisma.TransactionClient | typeof prisma,
  ): Promise<number> {
    const result = await db.tokenLot.aggregate({
      where: { userId, tokenHash },
      _max: { sequenceNum: true },
    });
    return (result._max.sequenceNum ?? 0) + 1;
  }

  /**
   * Apply lot allocations: create disposal records and update lot states.
   */
  private async applyAllocations(
    tx: Prisma.TransactionClient,
    input: DisposeLotInput,
    allocations: LotAllocation[],
    totalProceeds: bigint,
    totalQuantity: bigint,
  ) {
    const disposals: DisposalResult['disposals'] = [];
    let proceedsDistributed = 0n;

    for (let i = 0; i < allocations.length; i++) {
      const alloc = allocations[i]!;
      const isLast = i === allocations.length - 1;

      // Proportional proceeds: avoid rounding dust on last allocation
      const proceeds = isLast
        ? totalProceeds - proceedsDistributed
        : (alloc.quantityFromLot * totalProceeds) / totalQuantity;
      proceedsDistributed += proceeds;

      const realizedPnl = proceeds - alloc.costBasisAllocated;

      // Next disposal sequence for this user
      const seqNum = await this.nextDisposalSequenceNum(input.userId, tx);

      const disposal = await tx.tokenLotDisposal.create({
        data: {
          lotId: alloc.lotId,
          userId: input.userId,
          quantityDisposed: alloc.quantityFromLot.toString(),
          proceedsReporting: proceeds.toString(),
          costBasisAllocated: alloc.costBasisAllocated.toString(),
          realizedPnl: realizedPnl.toString(),
          disposedAt: input.disposedAt,
          transferEvent: input.transferEvent,
          disposalEventId: input.disposalEventId,
          sequenceNum: seqNum,
          journalEntryId: input.journalEntryId,
        },
      });

      // Update lot state
      const lot = await tx.tokenLot.findUnique({
        where: { id: alloc.lotId },
        select: { lotState: { select: { id: true, openQuantity: true } } },
      });
      const currentOpen = BigInt(lot!.lotState!.openQuantity);
      const newOpen = currentOpen - alloc.quantityFromLot;

      await tx.tokenLotState.update({
        where: { id: lot!.lotState!.id },
        data: {
          openQuantity: newOpen.toString(),
          isFullyConsumed: newOpen <= 0n,
        },
      });

      disposals.push({
        id: disposal.id,
        lotId: alloc.lotId,
        quantityDisposed: alloc.quantityFromLot.toString(),
        costBasisAllocated: alloc.costBasisAllocated.toString(),
        realizedPnl: realizedPnl.toString(),
      });
    }

    return disposals;
  }

  private async nextDisposalSequenceNum(
    userId: string,
    db: Prisma.TransactionClient | typeof prisma,
  ): Promise<number> {
    const result = await db.tokenLotDisposal.aggregate({
      where: { userId },
      _max: { sequenceNum: true },
    });
    return (result._max.sequenceNum ?? 0) + 1;
  }
}
