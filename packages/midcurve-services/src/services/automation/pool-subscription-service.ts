/**
 * Pool Subscription Service
 *
 * Manages pool price subscriptions for the automation system.
 * Tracks which pools have active orders and need price monitoring.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { Prisma } from '@midcurve/database';
import {
  type PoolPriceSubscriptionData,
  type PoolPriceSubscriptionState,
  poolSubscriptionToJSON,
  emptySubscriptionState,
} from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { FindPoolSubscriptionOptions } from '../types/automation/index.js';

/**
 * Dependencies for PoolSubscriptionService
 */
export interface PoolSubscriptionServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Pool Subscription Service
 *
 * Handles pool subscription management for automation:
 * - Creating/updating subscriptions when orders are registered
 * - Tracking active order counts per pool
 * - Providing list of pools to monitor
 * - Updating last known prices
 */
export class PoolSubscriptionService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new PoolSubscriptionService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: PoolSubscriptionServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('PoolSubscriptionService');
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Ensures a subscription exists for a pool, creating if needed
   *
   * @param poolId - Pool ID (from Pool table)
   * @returns The subscription
   */
  async ensureSubscription(poolId: string): Promise<PoolPriceSubscriptionData> {
    log.methodEntry(this.logger, 'ensureSubscription', { poolId });

    try {
      // Try to find existing subscription
      const existing = await this.prisma.poolPriceSubscription.findUnique({
        where: { poolId },
        include: { pool: true },
      });

      if (existing) {
        const subscription = this.mapToSubscription(existing);
        log.methodExit(this.logger, 'ensureSubscription', {
          poolId,
          created: false,
        });
        return subscription;
      }

      // Create new subscription
      const state = emptySubscriptionState();

      const result = await this.prisma.poolPriceSubscription.create({
        data: {
          poolId,
          isActive: true,
          activeOrderCount: 0,
          state: poolSubscriptionToJSON({
            id: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            poolId,
            isActive: true,
            activeOrderCount: 0,
            state,
          }).state as unknown as Prisma.InputJsonValue,
        },
        include: { pool: true },
      });

      const subscription = this.mapToSubscription(result);

      this.logger.info({ poolId, id: subscription.id }, 'Pool subscription created');
      log.methodExit(this.logger, 'ensureSubscription', { poolId, created: true });
      return subscription;
    } catch (error) {
      log.methodError(this.logger, 'ensureSubscription', error as Error, { poolId });
      throw error;
    }
  }

  /**
   * Finds a subscription by pool ID
   *
   * @param poolId - Pool ID
   * @returns The subscription if found, null otherwise
   */
  async findByPoolId(poolId: string): Promise<PoolPriceSubscriptionData | null> {
    log.methodEntry(this.logger, 'findByPoolId', { poolId });

    try {
      const result = await this.prisma.poolPriceSubscription.findUnique({
        where: { poolId },
        include: { pool: true },
      });

      if (!result) {
        log.methodExit(this.logger, 'findByPoolId', { poolId, found: false });
        return null;
      }

      const subscription = this.mapToSubscription(result);
      log.methodExit(this.logger, 'findByPoolId', { poolId, found: true });
      return subscription;
    } catch (error) {
      log.methodError(this.logger, 'findByPoolId', error as Error, { poolId });
      throw error;
    }
  }

  /**
   * Gets all active subscriptions
   *
   * @param options - Find options for filtering
   * @returns Array of active subscriptions
   */
  async findActive(
    options: FindPoolSubscriptionOptions = {}
  ): Promise<PoolPriceSubscriptionData[]> {
    log.methodEntry(this.logger, 'findActive', { options });

    try {
      const where: Prisma.PoolPriceSubscriptionWhereInput = {
        isActive: true,
      };

      if (options.hasActiveOrders) {
        where.activeOrderCount = { gt: 0 };
      }

      const results = await this.prisma.poolPriceSubscription.findMany({
        where,
        include: { pool: true },
        orderBy: { updatedAt: 'desc' },
      });

      const subscriptions = results.map((r) => this.mapToSubscription(r));

      log.methodExit(this.logger, 'findActive', { count: subscriptions.length });
      return subscriptions;
    } catch (error) {
      log.methodError(this.logger, 'findActive', error as Error, { options });
      throw error;
    }
  }

  /**
   * Gets all subscriptions with active orders (for price monitoring)
   *
   * @returns Array of subscriptions that need monitoring
   */
  async getSubscriptionsToMonitor(): Promise<PoolPriceSubscriptionData[]> {
    return this.findActive({ hasActiveOrders: true });
  }

  // ============================================================================
  // ORDER COUNT MANAGEMENT
  // ============================================================================

  /**
   * Increments the active order count for a pool
   *
   * @param poolId - Pool ID
   * @returns The updated subscription
   */
  async incrementOrderCount(poolId: string): Promise<PoolPriceSubscriptionData> {
    log.methodEntry(this.logger, 'incrementOrderCount', { poolId });

    try {
      // Ensure subscription exists
      await this.ensureSubscription(poolId);

      const result = await this.prisma.poolPriceSubscription.update({
        where: { poolId },
        data: {
          activeOrderCount: { increment: 1 },
          isActive: true, // Reactivate if was inactive
        },
        include: { pool: true },
      });

      const subscription = this.mapToSubscription(result);

      this.logger.debug(
        { poolId, activeOrderCount: subscription.activeOrderCount },
        'Pool order count incremented'
      );

      log.methodExit(this.logger, 'incrementOrderCount', { poolId });
      return subscription;
    } catch (error) {
      log.methodError(this.logger, 'incrementOrderCount', error as Error, { poolId });
      throw error;
    }
  }

  /**
   * Decrements the active order count for a pool
   *
   * @param poolId - Pool ID
   * @returns The updated subscription
   */
  async decrementOrderCount(poolId: string): Promise<PoolPriceSubscriptionData> {
    log.methodEntry(this.logger, 'decrementOrderCount', { poolId });

    try {
      const existing = await this.prisma.poolPriceSubscription.findUnique({
        where: { poolId },
      });

      if (!existing) {
        throw new Error(`Pool subscription not found for pool: ${poolId}`);
      }

      const newCount = Math.max(0, existing.activeOrderCount - 1);

      const result = await this.prisma.poolPriceSubscription.update({
        where: { poolId },
        data: {
          activeOrderCount: newCount,
          // Optionally deactivate if no more orders
          // isActive: newCount > 0,
        },
        include: { pool: true },
      });

      const subscription = this.mapToSubscription(result);

      this.logger.debug(
        { poolId, activeOrderCount: subscription.activeOrderCount },
        'Pool order count decremented'
      );

      log.methodExit(this.logger, 'decrementOrderCount', { poolId });
      return subscription;
    } catch (error) {
      log.methodError(this.logger, 'decrementOrderCount', error as Error, { poolId });
      throw error;
    }
  }

  // ============================================================================
  // PRICE STATE MANAGEMENT
  // ============================================================================

  /**
   * Updates the last known price for a pool
   *
   * @param poolId - Pool ID
   * @param sqrtPriceX96 - Current sqrtPriceX96
   * @param tick - Current tick
   * @returns The updated subscription
   */
  async updatePrice(
    poolId: string,
    sqrtPriceX96: bigint,
    tick: number
  ): Promise<PoolPriceSubscriptionData> {
    log.methodEntry(this.logger, 'updatePrice', { poolId, tick });

    try {
      const existing = await this.prisma.poolPriceSubscription.findUnique({
        where: { poolId },
      });

      if (!existing) {
        throw new Error(`Pool subscription not found for pool: ${poolId}`);
      }

      const updatedState: PoolPriceSubscriptionState = {
        lastSqrtPriceX96: sqrtPriceX96.toString(),
        lastTick: tick,
        lastUpdatedAt: new Date().toISOString(),
      };

      const result = await this.prisma.poolPriceSubscription.update({
        where: { poolId },
        data: {
          state: updatedState as unknown as Prisma.InputJsonValue,
        },
        include: { pool: true },
      });

      const subscription = this.mapToSubscription(result);

      this.logger.debug(
        { poolId, tick, sqrtPriceX96: sqrtPriceX96.toString() },
        'Pool price updated'
      );

      log.methodExit(this.logger, 'updatePrice', { poolId });
      return subscription;
    } catch (error) {
      log.methodError(this.logger, 'updatePrice', error as Error, { poolId });
      throw error;
    }
  }

  // ============================================================================
  // SUBSCRIPTION STATE MANAGEMENT
  // ============================================================================

  /**
   * Activates a subscription
   *
   * @param poolId - Pool ID
   * @returns The updated subscription
   */
  async activate(poolId: string): Promise<PoolPriceSubscriptionData> {
    log.methodEntry(this.logger, 'activate', { poolId });

    try {
      const result = await this.prisma.poolPriceSubscription.update({
        where: { poolId },
        data: { isActive: true },
        include: { pool: true },
      });

      const subscription = this.mapToSubscription(result);

      this.logger.info({ poolId }, 'Pool subscription activated');
      log.methodExit(this.logger, 'activate', { poolId });
      return subscription;
    } catch (error) {
      log.methodError(this.logger, 'activate', error as Error, { poolId });
      throw error;
    }
  }

  /**
   * Deactivates a subscription
   *
   * @param poolId - Pool ID
   * @returns The updated subscription
   */
  async deactivate(poolId: string): Promise<PoolPriceSubscriptionData> {
    log.methodEntry(this.logger, 'deactivate', { poolId });

    try {
      const result = await this.prisma.poolPriceSubscription.update({
        where: { poolId },
        data: { isActive: false },
        include: { pool: true },
      });

      const subscription = this.mapToSubscription(result);

      this.logger.info({ poolId }, 'Pool subscription deactivated');
      log.methodExit(this.logger, 'deactivate', { poolId });
      return subscription;
    } catch (error) {
      log.methodError(this.logger, 'deactivate', error as Error, { poolId });
      throw error;
    }
  }

  /**
   * Deletes a subscription
   *
   * @param poolId - Pool ID
   */
  async delete(poolId: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { poolId });

    try {
      await this.prisma.poolPriceSubscription.delete({
        where: { poolId },
      });

      this.logger.info({ poolId }, 'Pool subscription deleted');
      log.methodExit(this.logger, 'delete', { poolId });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { poolId });
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Maps database result to typed subscription
   */
  private mapToSubscription(
    dbResult: Prisma.PoolPriceSubscriptionGetPayload<{ include: { pool: true } }>
  ): PoolPriceSubscriptionData {
    const stateJson = dbResult.state as Record<string, unknown>;

    // Parse state from JSON (all string types per PoolPriceSubscriptionState)
    const state: PoolPriceSubscriptionState = {
      lastSqrtPriceX96: (stateJson.lastSqrtPriceX96 as string) || '0',
      lastTick: (stateJson.lastTick as number) || 0,
      lastUpdatedAt: (stateJson.lastUpdatedAt as string) || new Date().toISOString(),
    };

    return {
      id: dbResult.id,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      poolId: dbResult.poolId,
      isActive: dbResult.isActive,
      activeOrderCount: dbResult.activeOrderCount,
      state,
    };
  }
}
