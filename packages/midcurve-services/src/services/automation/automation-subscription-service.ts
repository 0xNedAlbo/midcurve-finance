/**
 * Automation Subscription Service
 *
 * Manages persistent OnchainDataSubscribers records for the automation system.
 * Each consumer owns its own subscriptions and is responsible for its own lifecycle.
 *
 * SubscriptionId formats:
 * - Per-order (close order): auto:close-order:{orderId}
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
   * Ensure a persistent pool price subscription exists for a specific close order.
   * Used by CloseOrderMonitor — 1 subscription per order for trivial lifecycle management.
   *
   * Idempotent — safe to call multiple times for the same order.
   */
  async ensureOrderSubscription(orderId: string, chainId: number, poolAddress: string): Promise<void> {
    log.methodEntry(this.logger, 'ensureOrderSubscription', { orderId, chainId, poolAddress });

    const normalizedAddress = poolAddress.toLowerCase();
    const subscriptionId = this.buildOrderSubscriptionId(orderId);

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
          expiresAfterMs: null,
          lastPolledAt: new Date(),
          config: config as unknown as Prisma.InputJsonValue,
          state: emptyUniswapV3PoolPriceState() as unknown as Prisma.InputJsonValue,
        },
        update: {
          status: 'active',
          expiresAfterMs: null,
          pausedAt: null,
        },
      });

      this.logger.info(
        { orderId, chainId, poolAddress: normalizedAddress, subscriptionId },
        'Order subscription ensured',
      );
      log.methodExit(this.logger, 'ensureOrderSubscription', { subscriptionId });
    } catch (error) {
      log.methodError(this.logger, 'ensureOrderSubscription', error as Error, {
        orderId,
        chainId,
        poolAddress,
      });
      throw error;
    }
  }

  /**
   * Remove a close order's pool price subscription.
   * No pool lookup needed — subscriptionId is deterministic from orderId.
   */
  async removeOrderSubscription(orderId: string): Promise<void> {
    log.methodEntry(this.logger, 'removeOrderSubscription', { orderId });

    try {
      const subscriptionId = this.buildOrderSubscriptionId(orderId);

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
          { orderId, subscriptionId },
          'Order subscription marked for deletion',
        );
      }

      log.methodExit(this.logger, 'removeOrderSubscription', {
        orderId,
        removed: result.count > 0,
      });
    } catch (error) {
      log.methodError(this.logger, 'removeOrderSubscription', error as Error, {
        orderId,
      });
      throw error;
    }
  }

  /**
   * Build deterministic subscriptionId for per-order subscriptions (close order monitor).
   * Format: auto:close-order:<orderId>
   */
  private buildOrderSubscriptionId(orderId: string): string {
    return `auto:close-order:${orderId}`;
  }
}
