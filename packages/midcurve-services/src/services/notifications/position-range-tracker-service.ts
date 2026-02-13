/**
 * Position Range Tracker Service
 *
 * Tracks whether positions are in-range or out-of-range and detects status changes.
 * Used by the RangeMonitor worker to detect when notifications should be sent.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { PositionRangeStatus } from '@midcurve/database';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type {
  PositionRangeTrackingInfo,
  RangeStatusChangeResult,
  UpdateRangeStatusInput,
} from '../types/notifications/index.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies for PositionRangeTrackerService
 */
export interface PositionRangeTrackerServiceDependencies {
  /**
   * Prisma client for database operations
   */
  prisma?: PrismaClient;
}

/**
 * Result of checking and updating position range status
 */
export interface RangeCheckResult {
  /** Whether the status changed */
  statusChanged: boolean;
  /** Previous status (null if first check) */
  previousStatus: {
    isInRange: boolean;
    tick: number;
  } | null;
  /** Current status after update */
  currentStatus: {
    isInRange: boolean;
    tick: number;
    sqrtPriceX96: string;
  };
}

// =============================================================================
// SERVICE
// =============================================================================

/**
 * Position Range Tracker Service
 *
 * Handles position range status tracking including:
 * - Getting current range status
 * - Updating range status when pool price changes
 * - Detecting status changes for notification purposes
 * - Bulk operations for efficient range monitoring
 */
export class PositionRangeTrackerService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new PositionRangeTrackerService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: PositionRangeTrackerServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('PositionRangeTrackerService');
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  /**
   * Gets the current range status for a position
   *
   * @param positionId - Position ID
   * @returns Range status or null if not tracked yet
   */
  async getByPositionId(positionId: string): Promise<PositionRangeStatus | null> {
    log.methodEntry(this.logger, 'getByPositionId', { positionId });

    try {
      const result = await this.prisma.positionRangeStatus.findUnique({
        where: { positionId },
      });

      log.methodExit(this.logger, 'getByPositionId', { found: !!result });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'getByPositionId', error as Error, { positionId });
      throw error;
    }
  }

  /**
   * Checks if a tick is within a position's range
   *
   * @param currentTick - Current pool tick
   * @param tickLower - Position's lower tick
   * @param tickUpper - Position's upper tick
   * @returns true if currentTick is within [tickLower, tickUpper)
   */
  isTickInRange(currentTick: number, tickLower: number, tickUpper: number): boolean {
    return currentTick >= tickLower && currentTick < tickUpper;
  }

  /**
   * Updates the range status for a position and returns whether it changed
   *
   * This is the primary method for range tracking. It:
   * 1. Creates or updates the PositionRangeStatus record
   * 2. Compares with previous status to detect changes
   * 3. Returns change information for notification purposes
   *
   * @param positionId - Position ID
   * @param input - Current tick and price data
   * @param tickLower - Position's lower tick (from config)
   * @param tickUpper - Position's upper tick (from config)
   * @returns Result containing whether status changed and current/previous states
   */
  async updateAndCheckChange(
    positionId: string,
    input: UpdateRangeStatusInput,
    tickLower: number,
    tickUpper: number
  ): Promise<RangeCheckResult> {
    log.methodEntry(this.logger, 'updateAndCheckChange', {
      positionId,
      currentTick: input.tick,
      tickLower,
      tickUpper,
    });

    try {
      // Calculate current in-range status
      const isInRange = this.isTickInRange(input.tick, tickLower, tickUpper);

      // Get existing status
      const existingStatus = await this.prisma.positionRangeStatus.findUnique({
        where: { positionId },
      });

      const previousStatus = existingStatus
        ? {
            isInRange: existingStatus.isInRange,
            tick: existingStatus.lastTick,
          }
        : null;

      // Detect if status changed
      const statusChanged = previousStatus !== null && previousStatus.isInRange !== isInRange;

      // Update or create the status record
      await this.prisma.positionRangeStatus.upsert({
        where: { positionId },
        update: {
          isInRange,
          lastSqrtPriceX96: input.sqrtPriceX96,
          lastTick: input.tick,
          lastCheckedAt: new Date(),
        },
        create: {
          positionId,
          isInRange,
          lastSqrtPriceX96: input.sqrtPriceX96,
          lastTick: input.tick,
          lastCheckedAt: new Date(),
        },
      });

      const result: RangeCheckResult = {
        statusChanged,
        previousStatus,
        currentStatus: {
          isInRange,
          tick: input.tick,
          sqrtPriceX96: input.sqrtPriceX96,
        },
      };

      if (statusChanged) {
        this.logger.info(
          {
            positionId,
            previouslyInRange: previousStatus?.isInRange,
            nowInRange: isInRange,
            tick: input.tick,
          },
          'Position range status changed'
        );
      }

      log.methodExit(this.logger, 'updateAndCheckChange', {
        statusChanged,
        isInRange,
      });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'updateAndCheckChange', error as Error, {
        positionId,
      });
      throw error;
    }
  }

  /**
   * Gets all positions that need range tracking for a specific pool
   *
   * Returns position info needed for range checking including
   * current range status if available.
   *
   * @param poolId - Pool ID to get positions for
   * @returns Array of position tracking info
   */
  async getPositionsForPool(poolId: string): Promise<PositionRangeTrackingInfo[]> {
    log.methodEntry(this.logger, 'getPositionsForPool', { poolId });

    try {
      // Get all active positions for this pool with their range status
      const positions = await this.prisma.position.findMany({
        where: {
          poolId,
          isActive: true,
        },
        include: {
          rangeStatus: true,
          pool: true,
        },
      });

      // Map to tracking info type
      const result: PositionRangeTrackingInfo[] = positions.map((position) => {
        // Extract tick bounds from position config
        // UniswapV3 config structure: { chainId, nftId, poolAddress, tickLower, tickUpper }
        const config = position.config as {
          chainId: number;
          nftId: number;
          poolAddress: string;
          tickLower: number;
          tickUpper: number;
        };

        // Extract pool address and chainId from pool config
        const poolConfig = position.pool.config as {
          chainId: number;
          poolAddress: string;
        };

        return {
          positionId: position.id,
          userId: position.userId,
          poolId: position.poolId,
          tickLower: config.tickLower,
          tickUpper: config.tickUpper,
          chainId: poolConfig.chainId,
          poolAddress: poolConfig.poolAddress,
          currentRangeStatus: position.rangeStatus
            ? {
                isInRange: position.rangeStatus.isInRange,
                lastTick: position.rangeStatus.lastTick,
              }
            : null,
        };
      });

      log.methodExit(this.logger, 'getPositionsForPool', { count: result.length });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'getPositionsForPool', error as Error, { poolId });
      throw error;
    }
  }

  /**
   * Gets all unique pool IDs that have active positions for range tracking
   *
   * @returns Array of unique pool IDs
   */
  async getActivePoolIds(): Promise<string[]> {
    log.methodEntry(this.logger, 'getActivePoolIds', {});

    try {
      const pools = await this.prisma.position.findMany({
        where: {
          isActive: true,
        },
        select: {
          poolId: true,
        },
        distinct: ['poolId'],
      });

      const poolIds = pools.map((p) => p.poolId);

      log.methodExit(this.logger, 'getActivePoolIds', { count: poolIds.length });
      return poolIds;
    } catch (error) {
      log.methodError(this.logger, 'getActivePoolIds', error as Error, {});
      throw error;
    }
  }

  /**
   * Batch check and update range status for multiple positions
   *
   * Used by the RangeMonitor worker to efficiently process all positions
   * for a pool after fetching the current price.
   *
   * @param poolId - Pool ID
   * @param currentTick - Current pool tick
   * @param sqrtPriceX96 - Current sqrtPriceX96
   * @returns Array of positions that had status changes
   */
  async batchCheckAndUpdate(
    poolId: string,
    currentTick: number,
    sqrtPriceX96: string
  ): Promise<RangeStatusChangeResult[]> {
    log.methodEntry(this.logger, 'batchCheckAndUpdate', {
      poolId,
      currentTick,
    });

    try {
      // Get all positions for this pool
      const positions = await this.getPositionsForPool(poolId);

      const changes: RangeStatusChangeResult[] = [];

      // Process each position
      for (const position of positions) {
        const result = await this.updateAndCheckChange(
          position.positionId,
          {
            isInRange: this.isTickInRange(currentTick, position.tickLower, position.tickUpper),
            sqrtPriceX96,
            tick: currentTick,
          },
          position.tickLower,
          position.tickUpper
        );

        // If status changed, add to results
        if (result.statusChanged && result.previousStatus) {
          changes.push({
            positionId: position.positionId,
            userId: position.userId,
            previouslyInRange: result.previousStatus.isInRange,
            nowInRange: result.currentStatus.isInRange,
            currentTick,
            sqrtPriceX96,
          });
        }
      }

      this.logger.info(
        {
          poolId,
          positionsChecked: positions.length,
          changesDetected: changes.length,
        },
        'Batch range check completed'
      );

      log.methodExit(this.logger, 'batchCheckAndUpdate', {
        changesDetected: changes.length,
      });
      return changes;
    } catch (error) {
      log.methodError(this.logger, 'batchCheckAndUpdate', error as Error, {
        poolId,
      });
      throw error;
    }
  }

  /**
   * Deletes range status for a position
   *
   * Called when a position is deleted or closed.
   *
   * @param positionId - Position ID
   */
  async delete(positionId: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { positionId });

    try {
      await this.prisma.positionRangeStatus.deleteMany({
        where: { positionId },
      });

      log.methodExit(this.logger, 'delete', { positionId });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { positionId });
      throw error;
    }
  }
}
