/**
 * Automation Subscription Service
 *
 * Manages persistent OnchainDataSubscribers records for the automation system.
 * Replaces PoolSubscriptionService's increment/decrement order count pattern
 * with a simpler ensure/remove pattern backed by the generic OnchainDataSubscribers table.
 *
 * Key difference from UI subscriptions:
 * - Automation subscriptions use expiresAfterMs: null (persistent, never auto-paused)
 * - UI subscriptions use expiresAfterMs: 60000 (paused after 60s without polling)
 */

import { prisma as prismaClient, PrismaClient, Prisma } from '@midcurve/database';
import {
  emptyUniswapV3PoolPriceState,
} from '@midcurve/shared';
import type { UniswapV3PoolPriceSubscriptionConfig } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

export interface AutomationSubscriptionServiceDependencies {
  prisma?: PrismaClient;
}

export class AutomationSubscriptionService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: AutomationSubscriptionServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('AutomationSubscriptionService');
  }

  /**
   * Ensure a persistent pool price subscription exists in OnchainDataSubscribers.
   * Creates one if missing, reactivates if paused/deleted.
   *
   * Idempotent — safe to call multiple times for the same pool.
   */
  async ensurePoolSubscription(chainId: number, poolAddress: string): Promise<void> {
    log.methodEntry(this.logger, 'ensurePoolSubscription', { chainId, poolAddress });

    const normalizedAddress = poolAddress.toLowerCase();
    const subscriptionId = this.buildSubscriptionId(chainId, normalizedAddress);

    try {
      const config: UniswapV3PoolPriceSubscriptionConfig = {
        chainId,
        poolAddress: normalizedAddress,
        startedAt: new Date().toISOString(),
      };

      await this.prisma.onchainDataSubscribers.upsert({
        where: { subscriptionId },
        create: {
          subscriptionType: 'uniswapv3-pool-price',
          subscriptionId,
          status: 'active',
          expiresAfterMs: null, // persistent — never auto-paused
          config: config as unknown as Prisma.InputJsonValue,
          state: emptyUniswapV3PoolPriceState() as unknown as Prisma.InputJsonValue,
        },
        update: {
          status: 'active',
          expiresAfterMs: null, // ensure persistent even if previously UI-created
          pausedAt: null,
        },
      });

      this.logger.info(
        { chainId, poolAddress: normalizedAddress, subscriptionId },
        'Pool subscription ensured',
      );
      log.methodExit(this.logger, 'ensurePoolSubscription', { subscriptionId });
    } catch (error) {
      log.methodError(this.logger, 'ensurePoolSubscription', error as Error, {
        chainId,
        poolAddress,
      });
      throw error;
    }
  }

  /**
   * Remove a pool subscription if no more active close orders reference this pool.
   *
   * Checks for monitoring orders via the position→pool relation. If none remain,
   * marks the subscription as 'deleted' for the onchain-data cleanup to prune.
   */
  async removePoolSubscriptionIfUnused(poolId: string): Promise<void> {
    log.methodEntry(this.logger, 'removePoolSubscriptionIfUnused', { poolId });

    try {
      // Check if any active monitoring orders still reference this pool
      const remainingOrders = await this.prisma.closeOrder.count({
        where: {
          position: { pool: { id: poolId } },
          automationState: 'monitoring',
        },
      });

      if (remainingOrders > 0) {
        this.logger.debug(
          { poolId, remainingOrders },
          'Pool still has monitoring orders, keeping subscription active',
        );
        log.methodExit(this.logger, 'removePoolSubscriptionIfUnused', {
          poolId,
          removed: false,
          remainingOrders,
        });
        return;
      }

      // Look up pool to get chainId and poolAddress from config JSON
      const pool = await this.prisma.pool.findUnique({
        where: { id: poolId },
        select: { config: true },
      });

      if (!pool) {
        this.logger.warn({ poolId }, 'Pool not found, cannot remove subscription');
        return;
      }

      const poolConfig = pool.config as Record<string, unknown>;
      const chainId = poolConfig.chainId as number | undefined;
      const poolAddress = (poolConfig.address as string | undefined)?.toLowerCase();

      if (!chainId || !poolAddress) {
        this.logger.warn(
          { poolId, chainId, poolAddress },
          'Pool config missing chainId or address',
        );
        return;
      }

      const subscriptionId = this.buildSubscriptionId(chainId, poolAddress);

      // Mark as deleted (onchain-data cleanup will prune it)
      const result = await this.prisma.onchainDataSubscribers.updateMany({
        where: {
          subscriptionId,
          status: 'active',
        },
        data: {
          status: 'deleted',
          pausedAt: new Date(),
        },
      });

      if (result.count > 0) {
        this.logger.info(
          { poolId, subscriptionId },
          'Pool subscription marked for deletion (no remaining orders)',
        );
      } else {
        this.logger.debug(
          { poolId, subscriptionId },
          'No active subscription found to remove',
        );
      }

      log.methodExit(this.logger, 'removePoolSubscriptionIfUnused', {
        poolId,
        removed: result.count > 0,
      });
    } catch (error) {
      log.methodError(this.logger, 'removePoolSubscriptionIfUnused', error as Error, {
        poolId,
      });
      throw error;
    }
  }

  /**
   * Build deterministic subscriptionId for automation pool subscriptions.
   * Format: auto:uniswapv3-pool-price:<chainId>:<poolAddress>
   */
  private buildSubscriptionId(chainId: number, poolAddress: string): string {
    return `auto:uniswapv3-pool-price:${chainId}:${poolAddress}`;
  }
}
