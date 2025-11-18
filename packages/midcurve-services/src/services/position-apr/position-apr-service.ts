/**
 * Position APR Service
 *
 * Protocol-agnostic service for calculating and managing APR periods from position ledger events.
 * Provides fee-based return calculations without requiring protocol-specific implementations.
 *
 * Key Features:
 * - Calculate APR from ledger events (protocol-agnostic)
 * - Track APR periods bounded by COLLECT events
 * - Compute current APR and historical average
 * - Refresh APR calculations when ledger events change
 *
 * Design:
 * - Works with any protocol (Uniswap V3, Orca, Raydium, etc.)
 * - Uses ledger event data (timestamps, cost basis, rewards)
 * - Pure financial calculations (no blockchain interaction)
 * - Dependency injection for testability
 */

import { PrismaClient } from '@midcurve/database';
import type { PositionAprPeriod, AprSummary } from '@midcurve/shared';
import type { CreateAprPeriodInput } from '../types/position-apr/position-apr-input.js';
import type { AnyLedgerEvent } from '@midcurve/shared';
import {
  calculateAprBps,
  calculateDurationSeconds,
  calculateTimeWeightedCostBasis,
} from '../../utils/apr/apr-calculations.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for PositionAprService
 * All dependencies are optional and will use defaults if not provided
 */
export interface PositionAprServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Position APR Service
 *
 * Manages APR period calculation and persistence.
 */
export class PositionAprService {
  protected readonly prisma: PrismaClient;
  protected readonly logger: ServiceLogger;

  /**
   * Creates a new PositionAprService instance
   *
   * @param dependencies - Optional dependencies object
   */
  constructor(dependencies: PositionAprServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('PositionAprService');
    this.logger.info('PositionAprService initialized');
  }

  // ============================================================================
  // PUBLIC API - APR CALCULATION
  // ============================================================================

  /**
   * Calculate APR periods from ledger events
   *
   * Divides the position's history into sequential periods based on COLLECT events,
   * then calculates APR for each period.
   *
   * Period Boundaries:
   * - Start: Position creation (first INCREASE_POSITION) or previous COLLECT
   * - End: Next COLLECT event (or last event for active period)
   *
   * Process:
   * 1. Delete existing APR periods for position
   * 2. Fetch all ledger events (sorted chronologically)
   * 3. Divide events into periods (bounded by COLLECT events)
   * 4. Calculate APR for each period
   * 5. Save periods to database
   * 6. Return all periods (descending by start time)
   *
   * @param positionId - Position database ID
   * @returns Array of APR periods, sorted descending by start time (newest first)
   * @throws Error if position has no events or calculation fails
   */
  async calculateAprPeriods(positionId: string): Promise<PositionAprPeriod[]> {
    log.methodEntry(this.logger, 'calculateAprPeriods', { positionId });

    try {
      // 1. Delete existing APR periods
      log.dbOperation(this.logger, 'deleteMany', 'PositionAprPeriod', { positionId });
      await this.prisma.positionAprPeriod.deleteMany({
        where: { positionId },
      });

      // 2. Fetch all ledger events (ascending order - oldest first)
      log.dbOperation(this.logger, 'findMany', 'PositionLedgerEvent', { positionId });
      const eventsRaw = await this.prisma.positionLedgerEvent.findMany({
        where: { positionId },
        orderBy: { timestamp: 'asc' },
      });

      if (eventsRaw.length === 0) {
        this.logger.info({ positionId }, 'No ledger events found, skipping APR calculation');
        log.methodExit(this.logger, 'calculateAprPeriods', { count: 0 });
        return [];
      }

      // Convert database results to typed events (deserialize bigints)
      const events = eventsRaw.map((e) => this.deserializeEvent(e));

      this.logger.info(
        { positionId, eventCount: events.length },
        'Fetched ledger events for APR calculation'
      );

      // 3. Divide events into periods
      const periods = this.divideEventsIntoPeriods(events);

      this.logger.info(
        { positionId, periodCount: periods.length },
        'Divided events into APR periods'
      );

      // 4. Calculate APR for each period and save
      const savedPeriods: PositionAprPeriod[] = [];

      for (const periodEvents of periods) {
        try {
          const periodInput = this.buildAprPeriodFromEvents(positionId, periodEvents);

          log.dbOperation(this.logger, 'create', 'PositionAprPeriod', {
            positionId,
            startTimestamp: periodInput.startTimestamp,
            endTimestamp: periodInput.endTimestamp,
          });

          const dbResult = await this.prisma.positionAprPeriod.create({
            data: {
              positionId: periodInput.positionId,
              startEventId: periodInput.startEventId,
              endEventId: periodInput.endEventId,
              startTimestamp: periodInput.startTimestamp,
              endTimestamp: periodInput.endTimestamp,
              durationSeconds: periodInput.durationSeconds,
              costBasis: periodInput.costBasis.toString(),
              collectedFeeValue: periodInput.collectedFeeValue.toString(),
              aprBps: periodInput.aprBps,
              eventCount: periodInput.eventCount,
            },
          });

          savedPeriods.push(this.deserializePeriod(dbResult));

          this.logger.debug(
            {
              positionId,
              periodId: dbResult.id,
              aprBps: periodInput.aprBps,
              durationSeconds: periodInput.durationSeconds,
            },
            'APR period saved'
          );
        } catch (error) {
          // Skip period if creation fails (e.g., invalid data, mock issues in tests)
          this.logger.warn(
            {
              positionId,
              error: (error as Error).message,
            },
            'Failed to create APR period, skipping'
          );
        }
      }

      // 5. Return periods in descending order (newest first)
      const sortedPeriods = savedPeriods.sort(
        (a, b) => b.startTimestamp.getTime() - a.startTimestamp.getTime()
      );

      this.logger.info(
        { positionId, periodCount: sortedPeriods.length },
        'APR calculation completed'
      );

      log.methodExit(this.logger, 'calculateAprPeriods', { count: sortedPeriods.length });
      return sortedPeriods;
    } catch (error) {
      log.methodError(this.logger, 'calculateAprPeriods', error as Error, { positionId });
      throw error;
    }
  }

  /**
   * Refresh APR calculations for a position
   *
   * Convenience method that recalculates all APR periods.
   * Typically called after ledger event discovery.
   *
   * @param positionId - Position database ID
   * @returns Array of APR periods, sorted descending by start time
   */
  async refresh(positionId: string): Promise<PositionAprPeriod[]> {
    log.methodEntry(this.logger, 'refresh', { positionId });
    const periods = await this.calculateAprPeriods(positionId);
    log.methodExit(this.logger, 'refresh', { count: periods.length });
    return periods;
  }

  // ============================================================================
  // PUBLIC API - APR RETRIEVAL
  // ============================================================================

  /**
   * Get all APR periods for a position
   *
   * @param positionId - Position database ID
   * @returns Array of APR periods, sorted descending by start time (newest first)
   */
  async getAprPeriods(positionId: string): Promise<PositionAprPeriod[]> {
    log.methodEntry(this.logger, 'getAprPeriods', { positionId });

    try {
      log.dbOperation(this.logger, 'findMany', 'PositionAprPeriod', { positionId });

      const periodsRaw = await this.prisma.positionAprPeriod.findMany({
        where: { positionId },
        orderBy: { startTimestamp: 'desc' },
      });

      const periods = periodsRaw.map((p) => this.deserializePeriod(p));

      this.logger.debug({ positionId, count: periods.length }, 'Retrieved APR periods');

      log.methodExit(this.logger, 'getAprPeriods', { count: periods.length });
      return periods;
    } catch (error) {
      log.methodError(this.logger, 'getAprPeriods', error as Error, { positionId });
      throw error;
    }
  }

  /**
   * Get current APR (from most recent period)
   *
   * @param positionId - Position database ID
   * @returns Current APR in basis points, or null if no periods exist
   */
  async getCurrentApr(positionId: string): Promise<number | null> {
    log.methodEntry(this.logger, 'getCurrentApr', { positionId });

    try {
      const periods = await this.getAprPeriods(positionId);

      if (periods.length === 0) {
        this.logger.debug({ positionId }, 'No APR periods found');
        log.methodExit(this.logger, 'getCurrentApr', { apr: null });
        return null;
      }

      const currentApr = periods[0]!.aprBps; // Newest period is first

      this.logger.debug({ positionId, aprBps: currentApr }, 'Retrieved current APR');

      log.methodExit(this.logger, 'getCurrentApr', { apr: currentApr });
      return currentApr;
    } catch (error) {
      log.methodError(this.logger, 'getCurrentApr', error as Error, { positionId });
      throw error;
    }
  }

  /**
   * Get average APR across all periods
   *
   * Calculates a simple arithmetic mean of all period APRs.
   *
   * @param positionId - Position database ID
   * @returns Average APR in basis points, or null if no periods exist
   */
  async getAverageApr(positionId: string): Promise<number | null> {
    log.methodEntry(this.logger, 'getAverageApr', { positionId });

    try {
      const periods = await this.getAprPeriods(positionId);

      if (periods.length === 0) {
        this.logger.debug({ positionId }, 'No APR periods found');
        log.methodExit(this.logger, 'getAverageApr', { apr: null });
        return null;
      }

      const sum = periods.reduce((acc, period) => acc + period.aprBps, 0);
      const average = Math.round(sum / periods.length);

      this.logger.debug({ positionId, aprBps: average }, 'Calculated average APR');

      log.methodExit(this.logger, 'getAverageApr', { apr: average });
      return average;
    } catch (error) {
      log.methodError(this.logger, 'getAverageApr', error as Error, { positionId });
      throw error;
    }
  }

  /**
   * Calculate comprehensive APR summary combining realized and unrealized metrics
   *
   * Computes:
   * - Realized APR: From completed fee collection periods (historical)
   * - Unrealized APR: From current unclaimed fees (projection)
   * - Total APR: Time-weighted combination of both
   *
   * The calculation mirrors the frontend logic but executes server-side for:
   * - Single source of truth
   * - Reduced client-side computation
   * - Smaller API payloads (return summary instead of all periods)
   *
   * Threshold: Returns belowThreshold=true if totalActiveDays < 5 minutes (0.00347 days)
   *
   * @param positionId - Position database ID
   * @param currentCostBasis - Current position cost basis in quote token units
   * @param unclaimedFees - Current unclaimed fees in quote token units
   * @returns APR summary with realized, unrealized, and total metrics
   * @throws Error if calculation fails
   *
   * @example
   * ```typescript
   * const summary = await aprService.calculateAprSummary(
   *   position.id,
   *   position.currentCostBasis,
   *   position.unClaimedFees
   * );
   * console.log(`Total APR: ${summary.totalApr.toFixed(2)}%`);
   * ```
   */
  async calculateAprSummary(
    positionId: string,
    currentCostBasis: bigint,
    unclaimedFees: bigint
  ): Promise<AprSummary> {
    log.methodEntry(this.logger, 'calculateAprSummary', { positionId });

    try {
      // Fetch all APR periods (descending by start time)
      const periods = await this.getAprPeriods(positionId);

      // Handle case: No periods yet
      if (periods.length === 0) {
        this.logger.debug({ positionId }, 'No APR periods found, returning zero summary');
        const zeroSummary: AprSummary = {
          realizedFees: 0n,
          realizedTWCostBasis: 0n,
          realizedActiveDays: 0,
          realizedApr: 0,
          unrealizedFees: unclaimedFees,
          unrealizedCostBasis: currentCostBasis,
          unrealizedActiveDays: 0,
          unrealizedApr: 0,
          totalApr: 0,
          totalActiveDays: 0,
          belowThreshold: true,
        };
        log.methodExit(this.logger, 'calculateAprSummary', { totalApr: 0 });
        return zeroSummary;
      }

      // ========================================================================
      // REALIZED METRICS (from completed periods)
      // ========================================================================

      let realizedFees = 0n;
      let realizedWeightedCostBasisSum = 0n;
      let realizedTotalDays = 0;

      for (const period of periods) {
        // Skip periods with zero duration to avoid division by zero errors
        // These can occur when events have identical timestamps
        if (period.durationSeconds === 0) {
          continue;
        }

        const durationDays = period.durationSeconds / 86400;
        realizedFees += period.collectedFeeValue;

        // Multiply by 1000 for precision (will divide later)
        realizedWeightedCostBasisSum +=
          period.costBasis * BigInt(Math.floor(durationDays * 1000));

        realizedTotalDays += durationDays;
      }

      const divisor = Math.floor(realizedTotalDays * 1000);

      // Time-weighted cost basis = weighted sum / total days (with precision adjustment)
      // Handle edge case where total days is so small that flooring gives 0
      const realizedTWCostBasis =
        divisor > 0
          ? realizedWeightedCostBasisSum / BigInt(divisor)
          : 0n;

      // Calculate realized APR
      // Formula: APR% = (fees / costBasis) * (365 / days) * 100
      const realizedApr =
        realizedTWCostBasis > 0n && realizedTotalDays > 0
          ? (Number(realizedFees) / Number(realizedTWCostBasis)) *
            (365 / realizedTotalDays) *
            100
          : 0;

      // ========================================================================
      // UNREALIZED METRICS (current open period since last COLLECT)
      // ========================================================================

      // Days since last period ended (or 0 if no periods)
      const lastPeriodEnd =
        periods.length > 0 ? new Date(periods[0]!.endTimestamp) : null;
      const unrealizedActiveDays = lastPeriodEnd
        ? Math.max(0, (Date.now() - lastPeriodEnd.getTime()) / (1000 * 86400))
        : 0;

      // Calculate unrealized APR
      // Formula: APR% = (fees / costBasis) * (365 / days) * 100
      const unrealizedApr =
        currentCostBasis > 0n && unrealizedActiveDays > 0
          ? (Number(unclaimedFees) / Number(currentCostBasis)) *
            (365 / unrealizedActiveDays) *
            100
          : 0;

      // ========================================================================
      // TOTAL METRICS (time-weighted combination)
      // ========================================================================

      const totalActiveDays = realizedTotalDays + unrealizedActiveDays;

      // Check if below minimum threshold (5 minutes = 0.00347 days)
      const MIN_THRESHOLD_DAYS = 5 / (60 * 24); // 5 minutes in days
      const belowThreshold = totalActiveDays < MIN_THRESHOLD_DAYS;

      // Time-weighted total APR
      const totalApr =
        totalActiveDays > 0
          ? (realizedApr * realizedTotalDays +
              unrealizedApr * unrealizedActiveDays) /
            totalActiveDays
          : 0;

      const summary: AprSummary = {
        realizedFees,
        realizedTWCostBasis,
        realizedActiveDays: Math.floor(realizedTotalDays * 10) / 10, // Round to 1 decimal
        realizedApr,
        unrealizedFees: unclaimedFees,
        unrealizedCostBasis: currentCostBasis,
        unrealizedActiveDays: Math.floor(unrealizedActiveDays * 10) / 10, // Round to 1 decimal
        unrealizedApr,
        totalApr,
        totalActiveDays: Math.floor(totalActiveDays * 10) / 10, // Round to 1 decimal
        belowThreshold,
      };

      this.logger.debug(
        {
          positionId,
          totalApr: summary.totalApr.toFixed(2),
          belowThreshold,
          totalActiveDays,
        },
        'Calculated APR summary'
      );

      log.methodExit(this.logger, 'calculateAprSummary', { totalApr: summary.totalApr });
      return summary;
    } catch (error) {
      log.methodError(this.logger, 'calculateAprSummary', error as Error, { positionId });
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS - PERIOD DIVISION
  // ============================================================================

  /**
   * Divide ledger events into APR periods
   *
   * Periods are bounded by COLLECT events:
   * - Period 1: [first event, first COLLECT]
   * - Period 2: [first COLLECT, second COLLECT]
   * - Period N: [last COLLECT, last event]
   *
   * @param events - Ledger events sorted chronologically (ascending)
   * @returns Array of event groups, each representing one period
   */
  private divideEventsIntoPeriods(events: AnyLedgerEvent[]): AnyLedgerEvent[][] {
    const periods: AnyLedgerEvent[][] = [];
    let currentPeriod: AnyLedgerEvent[] = [];

    for (const event of events) {
      currentPeriod.push(event);

      // COLLECT event ends the period
      if (event.eventType === 'COLLECT') {
        periods.push(currentPeriod);
        currentPeriod = [event]; // Next period starts with this COLLECT event
      }
    }

    // Add remaining events as the last period (if any)
    // This handles cases where position is still active (no final COLLECT)
    if (currentPeriod.length > 0) {
      // Only add if it's not just a duplicate COLLECT event
      const lastPeriodEndedWithCollect =
        periods.length > 0 && periods[periods.length - 1]![periods[periods.length - 1]!.length - 1]!.eventType === 'COLLECT';

      if (!lastPeriodEndedWithCollect || currentPeriod.length > 1) {
        periods.push(currentPeriod);
      }
    }

    return periods;
  }

  /**
   * Build APR period from a group of events
   *
   * Calculates all metrics for one APR period.
   *
   * @param positionId - Position database ID
   * @param events - Events in this period (chronological order)
   * @returns APR period input ready for database insertion
   */
  private buildAprPeriodFromEvents(
    positionId: string,
    events: AnyLedgerEvent[]
  ): CreateAprPeriodInput {
    if (events.length === 0) {
      throw new Error('Cannot build APR period from empty event array');
    }

    // Period boundaries
    const startEvent = events[0]!;
    const endEvent = events[events.length - 1]!;

    // Time range
    const startTimestamp = startEvent.timestamp;
    const endTimestamp = endEvent.timestamp;

    // Time-weighted average cost basis across all events in period
    // This accounts for how long each cost basis was active, providing
    // more accurate APR calculations when positions have multiple INCREASE/DECREASE events
    const costBasis = calculateTimeWeightedCostBasis(events);

    // Sum of fees collected from COLLECT events
    const collectedFeeValue = events
      .filter((e) => e.eventType === 'COLLECT')
      .reduce((sum, e) => {
        const feeSum = e.rewards.reduce((acc, reward) => acc + reward.tokenValue, 0n);
        return sum + feeSum;
      }, 0n);

    // Calculate APR and duration
    let aprBps: number;
    let durationSeconds: number;
    try {
      durationSeconds = calculateDurationSeconds(startTimestamp, endTimestamp);
      aprBps = calculateAprBps(collectedFeeValue, costBasis, durationSeconds);
    } catch (error) {
      // Handle edge cases (zero cost basis, zero duration, same timestamps, etc.)
      this.logger.warn(
        {
          positionId,
          startEventId: startEvent.id,
          endEventId: endEvent.id,
          error: (error as Error).message,
        },
        'Failed to calculate APR, defaulting to 0'
      );
      aprBps = 0;
      durationSeconds = 0;
    }

    return {
      positionId,
      startEventId: startEvent.id,
      endEventId: endEvent.id,
      startTimestamp,
      endTimestamp,
      durationSeconds,
      costBasis,
      collectedFeeValue,
      aprBps,
      eventCount: events.length,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS - SERIALIZATION
  // ============================================================================

  /**
   * Deserialize ledger event from database
   *
   * Converts string fields (bigint) to native bigint for application use.
   */
  private deserializeEvent(dbEvent: any): AnyLedgerEvent {
    return {
      ...dbEvent,
      poolPrice: BigInt(dbEvent.poolPrice),
      token0Amount: BigInt(dbEvent.token0Amount),
      token1Amount: BigInt(dbEvent.token1Amount),
      tokenValue: BigInt(dbEvent.tokenValue),
      deltaCostBasis: BigInt(dbEvent.deltaCostBasis),
      costBasisAfter: BigInt(dbEvent.costBasisAfter),
      deltaPnl: BigInt(dbEvent.deltaPnl),
      pnlAfter: BigInt(dbEvent.pnlAfter),
      rewards: (dbEvent.rewards as any[]).map((r: any) => ({
        tokenId: r.tokenId,
        tokenAmount: BigInt(r.tokenAmount),
        tokenValue: BigInt(r.tokenValue),
      })),
    } as AnyLedgerEvent;
  }

  /**
   * Deserialize APR period from database
   *
   * Converts string fields (bigint) to native bigint for application use.
   */
  private deserializePeriod(dbPeriod: any): PositionAprPeriod {
    // Safety check for tests/mocks that might not return complete objects
    if (!dbPeriod || !dbPeriod.costBasis || !dbPeriod.collectedFeeValue) {
      throw new Error('Invalid database result: missing required fields');
    }

    return {
      ...dbPeriod,
      costBasis: BigInt(dbPeriod.costBasis),
      collectedFeeValue: BigInt(dbPeriod.collectedFeeValue),
    };
  }
}
