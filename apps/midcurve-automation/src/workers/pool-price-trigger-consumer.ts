/**
 * Pool Price Trigger Consumer
 *
 * Consumes raw Swap events from the pool-prices exchange via PoolPriceSubscriber
 * and checks for trigger conditions on close orders and hedge vaults.
 *
 * Key design:
 * - 1 PoolPriceSubscriber per active order or vault
 * - Subscriber lifecycle tied to order/vault lifecycle
 * - Multiple subscribers for same pool is OK (RabbitMQ handles fan-out)
 * - No deduplication needed (pool-prices backend handles that)
 *
 * Trigger detection for close orders uses direct TICK comparison:
 * - LOWER (triggerMode=0): triggered when currentTick <= triggerTick
 * - UPPER (triggerMode=1): triggered when currentTick >= triggerTick
 */

import { prisma } from '@midcurve/database';
import type { OnChainCloseOrder } from '@midcurve/database';
import {
  getOnChainCloseOrderService,
  getHedgeVaultService,
} from '../lib/services';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { EXCHANGES, ROUTING_KEYS } from '../mq/topology';
import {
  serializeMessage,
  type OrderTriggerMessage,
  type HedgeVaultTriggerMessage,
  type HedgeVaultTriggerType,
} from '../mq/messages';
import {
  createPoolPriceSubscriber,
  type PoolPriceSubscriber,
  type RawSwapEventWrapper,
} from '@midcurve/services';

const log = automationLogger.child({ component: 'PoolPriceTriggerConsumer' });

// =============================================================================
// Constants
// =============================================================================

/** Interval for syncing subscriptions (5 minutes) */
const SUBSCRIPTION_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

/** Viem Swap event args structure */
interface SwapEventArgs {
  sender: string;
  recipient: string;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
}

/** Raw log structure from viem */
interface RawSwapLog {
  args: SwapEventArgs;
  blockNumber: bigint;
}

export interface PoolPriceTriggerConsumerStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  orderSubscribers: number;
  vaultSubscribers: number;
  eventsProcessed: number;
  triggersPublished: number;
  lastProcessedAt: string | null;
  lastSyncAt: string | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract sqrtPriceX96, tick, and blockNumber from raw Swap event
 */
function extractSwapData(raw: unknown): { sqrtPriceX96: bigint; tick: number; blockNumber: bigint } {
  const swapLog = raw as RawSwapLog;
  return {
    sqrtPriceX96: BigInt(swapLog.args.sqrtPriceX96),
    tick: Number(swapLog.args.tick),
    blockNumber: BigInt(swapLog.blockNumber),
  };
}

// =============================================================================
// Worker
// =============================================================================

export class PoolPriceTriggerConsumer {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private orderSubscribers = new Map<string, PoolPriceSubscriber>();
  private vaultSubscribers = new Map<string, PoolPriceSubscriber>();
  private eventsProcessed = 0;
  private triggersPublished = 0;
  private lastProcessedAt: Date | null = null;
  private lastSyncAt: Date | null = null;
  private syncTimer: NodeJS.Timeout | null = null;

  /**
   * Start the pool price trigger consumer
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'PoolPriceTriggerConsumer already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'PoolPriceTriggerConsumer', 'starting');
    this.status = 'running';

    try {
      // Sync subscriptions on startup
      await this.syncSubscriptions();

      // Schedule periodic subscription sync
      this.scheduleSyncTimer();

      autoLog.workerLifecycle(log, 'PoolPriceTriggerConsumer', 'started', {
        orderSubscribers: this.orderSubscribers.size,
        vaultSubscribers: this.vaultSubscribers.size,
      });
    } catch (err) {
      this.status = 'stopped';
      autoLog.methodError(log, 'start', err);
      throw err;
    }
  }

  /**
   * Stop the pool price trigger consumer
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'PoolPriceTriggerConsumer', 'stopping');
    this.status = 'stopping';

    // Stop sync timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Shutdown all order subscribers
    const orderShutdowns = Array.from(this.orderSubscribers.values()).map((sub) =>
      sub.shutdown().catch((err) => {
        log.warn({ error: err, msg: 'Error shutting down order subscriber' });
      })
    );

    // Shutdown all vault subscribers
    const vaultShutdowns = Array.from(this.vaultSubscribers.values()).map((sub) =>
      sub.shutdown().catch((err) => {
        log.warn({ error: err, msg: 'Error shutting down vault subscriber' });
      })
    );

    await Promise.all([...orderShutdowns, ...vaultShutdowns]);

    this.orderSubscribers.clear();
    this.vaultSubscribers.clear();

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'PoolPriceTriggerConsumer', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): PoolPriceTriggerConsumerStatus {
    return {
      status: this.status,
      orderSubscribers: this.orderSubscribers.size,
      vaultSubscribers: this.vaultSubscribers.size,
      eventsProcessed: this.eventsProcessed,
      triggersPublished: this.triggersPublished,
      lastProcessedAt: this.lastProcessedAt?.toISOString() || null,
      lastSyncAt: this.lastSyncAt?.toISOString() || null,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Sync subscriptions with active orders and vaults
   */
  private async syncSubscriptions(): Promise<void> {
    autoLog.methodEntry(log, 'syncSubscriptions');

    try {
      await Promise.all([this.syncOrderSubscriptions(), this.syncVaultSubscriptions()]);

      this.lastSyncAt = new Date();

      log.info({
        orderSubscribers: this.orderSubscribers.size,
        vaultSubscribers: this.vaultSubscribers.size,
        msg: 'Subscription sync complete',
      });

      autoLog.methodExit(log, 'syncSubscriptions');
    } catch (err) {
      autoLog.methodError(log, 'syncSubscriptions', err);
    }
  }

  /**
   * Sync order subscriptions using OnChainCloseOrderService
   */
  private async syncOrderSubscriptions(): Promise<void> {
    const onChainCloseOrderService = getOnChainCloseOrderService();

    // Get all monitoring orders with position→pool relations
    const monitoringOrders = await onChainCloseOrderService.findMonitoringOrders();

    // Get set of active order IDs
    const activeOrderIds = new Set(monitoringOrders.map((o) => o.id));

    // Remove subscribers for orders that are no longer monitoring
    for (const [orderId, subscriber] of this.orderSubscribers.entries()) {
      if (!activeOrderIds.has(orderId)) {
        log.debug({ orderId }, 'Removing subscriber for inactive order');
        await subscriber.shutdown().catch((err) => {
          log.warn({ error: err, orderId, msg: 'Error shutting down order subscriber' });
        });
        this.orderSubscribers.delete(orderId);
      }
    }

    // Add subscribers for new monitoring orders
    for (const order of monitoringOrders) {
      if (!this.orderSubscribers.has(order.id)) {
        // pool column is the on-chain pool address
        const poolAddress = order.pool;
        // position.pool.id is the database pool ID (for subscriber record)
        const poolId = order.position?.pool?.id;

        if (poolAddress && poolId) {
          await this.createOrderSubscriber({
            id: order.id,
            positionId: order.positionId,
            poolAddress,
            poolId,
            chainId: order.chainId,
            triggerTick: order.triggerTick,
            triggerMode: order.triggerMode,
          });
        } else {
          log.warn({
            orderId: order.id,
            poolAddress,
            poolId,
            msg: 'Cannot create subscriber: missing pool data',
          });
        }
      }
    }
  }

  /**
   * Sync vault subscriptions
   */
  private async syncVaultSubscriptions(): Promise<void> {
    const hedgeVaultService = getHedgeVaultService();
    const activeVaults = await hedgeVaultService.findActiveVaults();

    // Get set of active vault IDs
    const activeVaultIds = new Set(activeVaults.map((v) => v.id));

    // Remove subscribers for vaults that are no longer active
    for (const [vaultId, subscriber] of this.vaultSubscribers.entries()) {
      if (!activeVaultIds.has(vaultId)) {
        log.debug({ vaultId }, 'Removing subscriber for inactive vault');
        await subscriber.shutdown().catch((err) => {
          log.warn({ error: err, vaultId, msg: 'Error shutting down vault subscriber' });
        });
        this.vaultSubscribers.delete(vaultId);
      }
    }

    // Add subscribers for new active vaults
    for (const vault of activeVaults) {
      if (!this.vaultSubscribers.has(vault.id)) {
        await this.createVaultSubscriber(vault);
      }
    }
  }

  /**
   * Create a subscriber for an order
   */
  private async createOrderSubscriber(order: {
    id: string;
    positionId: string;
    poolAddress: string;
    poolId: string;
    chainId: number;
    triggerTick: number | null;
    triggerMode: number;
  }): Promise<void> {
    try {
      // Create or find the subscriber record in the database
      const subscriptionTag = `order-trigger-${order.id}`;

      // Try to find existing record
      let subscriberRecord = await prisma.poolPriceSubscribers.findFirst({
        where: {
          poolId: order.poolId,
          subscriptionTag,
        },
      });

      // Create if not found
      if (!subscriberRecord) {
        subscriberRecord = await prisma.poolPriceSubscribers.create({
          data: {
            poolId: order.poolId,
            subscriptionTag,
            isActive: true,
          },
        });
        log.debug({ orderId: order.id, subscriptionTag }, 'Created subscriber record');
      } else {
        // Update existing to mark as active
        await prisma.poolPriceSubscribers.update({
          where: { id: subscriberRecord.id },
          data: { isActive: true },
        });
        log.debug({ orderId: order.id, subscriptionTag }, 'Reusing existing subscriber record');
      }

      const subscriber = createPoolPriceSubscriber({
        subscriberId: subscriberRecord.id,
        chainId: order.chainId,
        poolAddress: order.poolAddress,
        messageHandler: async (message) => {
          await this.handleOrderSwapEvent(order.id, message);
        },
        errorHandler: async (error) => {
          log.error({ error: error.message, orderId: order.id }, 'Order subscriber error');
          // Remove from map so it can be recreated on next sync
          this.orderSubscribers.delete(order.id);
        },
      });

      await subscriber.start();
      this.orderSubscribers.set(order.id, subscriber);
      log.info({
        orderId: order.id,
        chainId: order.chainId,
        poolAddress: order.poolAddress,
        subscriberId: subscriberRecord.id,
        msg: 'Created order subscriber',
      });
    } catch (err) {
      log.error({ error: err, orderId: order.id, msg: 'Failed to start order subscriber' });
    }
  }

  /**
   * Create a subscriber for a vault
   */
  private async createVaultSubscriber(vault: {
    id: string;
    vaultAddress: string;
    poolAddress: string;
    chainId: number;
    state: string;
    token0IsQuote: boolean;
    silSqrtPriceX96: string;
    tipSqrtPriceX96: string;
    lastCloseBlock: string | null;
    reopenCooldownBlocks: string;
  }): Promise<void> {
    try {
      // First, find the pool record by chainId and poolAddress
      const poolAddress = vault.poolAddress.toLowerCase();
      const pool = await prisma.pool.findFirst({
        where: {
          config: {
            path: ['chainId'],
            equals: vault.chainId,
          },
        },
      });

      // If we found a potential pool, verify it has the right address
      // Since Prisma doesn't support filtering JSON string fields easily, we need to check manually
      let poolId: string | null = null;
      if (pool) {
        const poolConfig = pool.config as { address?: string };
        if (poolConfig.address?.toLowerCase() === poolAddress) {
          poolId = pool.id;
        }
      }

      // If no matching pool found, try a different approach - search all pools for this chain
      if (!poolId) {
        const pools = await prisma.pool.findMany({
          where: {
            config: {
              path: ['chainId'],
              equals: vault.chainId,
            },
          },
        });

        for (const p of pools) {
          const pConfig = p.config as { address?: string };
          if (pConfig.address?.toLowerCase() === poolAddress) {
            poolId = p.id;
            break;
          }
        }
      }

      if (!poolId) {
        log.warn({
          vaultId: vault.id,
          chainId: vault.chainId,
          poolAddress: vault.poolAddress,
          msg: 'Pool not found for vault, cannot create subscriber',
        });
        return;
      }

      // Create or find the subscriber record in the database
      const subscriptionTag = `vault-trigger-${vault.id}`;

      // Try to find existing record
      let subscriberRecord = await prisma.poolPriceSubscribers.findFirst({
        where: {
          poolId,
          subscriptionTag,
        },
      });

      // Create if not found
      if (!subscriberRecord) {
        subscriberRecord = await prisma.poolPriceSubscribers.create({
          data: {
            poolId,
            subscriptionTag,
            isActive: true,
          },
        });
        log.debug({ vaultId: vault.id, subscriptionTag }, 'Created subscriber record');
      } else {
        // Update existing to mark as active
        await prisma.poolPriceSubscribers.update({
          where: { id: subscriberRecord.id },
          data: { isActive: true },
        });
        log.debug({ vaultId: vault.id, subscriptionTag }, 'Reusing existing subscriber record');
      }

      const subscriber = createPoolPriceSubscriber({
        subscriberId: subscriberRecord.id,
        chainId: vault.chainId,
        poolAddress: vault.poolAddress,
        messageHandler: async (message) => {
          await this.handleVaultSwapEvent(vault.id, message);
        },
        errorHandler: async (error) => {
          log.error({ error: error.message, vaultId: vault.id }, 'Vault subscriber error');
          // Remove from map so it can be recreated on next sync
          this.vaultSubscribers.delete(vault.id);
        },
      });

      await subscriber.start();
      this.vaultSubscribers.set(vault.id, subscriber);
      log.info({
        vaultId: vault.id,
        chainId: vault.chainId,
        poolAddress: vault.poolAddress,
        subscriberId: subscriberRecord.id,
        msg: 'Created vault subscriber',
      });
    } catch (err) {
      log.error({ error: err, vaultId: vault.id, msg: 'Failed to start vault subscriber' });
    }
  }

  /**
   * Handle Swap event for an order — tick-based trigger detection
   */
  private async handleOrderSwapEvent(
    orderId: string,
    message: RawSwapEventWrapper
  ): Promise<void> {
    this.eventsProcessed++;
    this.lastProcessedAt = new Date();

    try {
      // Get fresh order data (may have been modified)
      const onChainCloseOrderService = getOnChainCloseOrderService();
      const order = await onChainCloseOrderService.findById(orderId);

      if (!order) {
        log.debug({ orderId }, 'Order not found, shutting down subscriber');
        await this.shutdownOrderSubscriber(orderId);
        return;
      }

      if (order.monitoringState !== 'monitoring') {
        log.debug({ orderId, monitoringState: order.monitoringState }, 'Order no longer monitoring');
        await this.shutdownOrderSubscriber(orderId);
        return;
      }

      const { sqrtPriceX96, tick } = extractSwapData(message.raw);

      const triggered = await this.checkOrderTrigger(
        order,
        message.poolAddress,
        message.chainId,
        sqrtPriceX96,
        tick
      );

      if (triggered) {
        this.triggersPublished++;
        // Shutdown subscriber since order is now triggered
        await this.shutdownOrderSubscriber(orderId);
      }
    } catch (err) {
      autoLog.methodError(log, 'handleOrderSwapEvent', err, { orderId });
    }
  }

  /**
   * Handle Swap event for a vault
   */
  private async handleVaultSwapEvent(
    vaultId: string,
    message: RawSwapEventWrapper
  ): Promise<void> {
    this.eventsProcessed++;
    this.lastProcessedAt = new Date();

    try {
      // Get fresh vault data (may have been modified)
      const hedgeVaultService = getHedgeVaultService();
      const vault = await hedgeVaultService.findById(vaultId);

      if (!vault) {
        log.debug({ vaultId }, 'Vault not found, shutting down subscriber');
        await this.shutdownVaultSubscriber(vaultId);
        return;
      }

      if (vault.monitoringStatus !== 'active') {
        log.debug({ vaultId, status: vault.monitoringStatus }, 'Vault no longer active');
        await this.shutdownVaultSubscriber(vaultId);
        return;
      }

      const { sqrtPriceX96, blockNumber } = extractSwapData(message.raw);

      const triggerType = this.checkHedgeVaultTrigger(sqrtPriceX96, blockNumber, vault);

      if (triggerType) {
        autoLog.hedgeVaultTriggered(
          log,
          vault.id,
          vault.vaultAddress,
          vault.poolAddress,
          triggerType,
          sqrtPriceX96.toString()
        );

        await this.publishHedgeVaultTrigger({
          vaultId: vault.id,
          vaultAddress: vault.vaultAddress,
          poolAddress: vault.poolAddress,
          chainId: vault.chainId,
          triggerType,
          currentSqrtPriceX96: sqrtPriceX96.toString(),
          silSqrtPriceX96: vault.silSqrtPriceX96,
          tipSqrtPriceX96: vault.tipSqrtPriceX96,
          token0IsQuote: vault.token0IsQuote,
          currentBlock: blockNumber.toString(),
          triggeredAt: new Date().toISOString(),
        });

        this.triggersPublished++;
        // Note: Don't shutdown vault subscriber - it may need to trigger again (reopen)
      }
    } catch (err) {
      autoLog.methodError(log, 'handleVaultSwapEvent', err, { vaultId });
    }
  }

  /**
   * Shutdown an order subscriber
   */
  private async shutdownOrderSubscriber(orderId: string): Promise<void> {
    const subscriber = this.orderSubscribers.get(orderId);
    if (subscriber) {
      await subscriber.shutdown().catch((err) => {
        log.warn({ error: err, orderId, msg: 'Error shutting down order subscriber' });
      });
      this.orderSubscribers.delete(orderId);
    }
  }

  /**
   * Shutdown a vault subscriber
   */
  private async shutdownVaultSubscriber(vaultId: string): Promise<void> {
    const subscriber = this.vaultSubscribers.get(vaultId);
    if (subscriber) {
      await subscriber.shutdown().catch((err) => {
        log.warn({ error: err, vaultId, msg: 'Error shutting down vault subscriber' });
      });
      this.vaultSubscribers.delete(vaultId);
    }
  }

  /**
   * Check if an order's trigger condition is met using direct tick comparison.
   *
   * - LOWER (triggerMode=0): triggered when currentTick <= triggerTick
   * - UPPER (triggerMode=1): triggered when currentTick >= triggerTick
   */
  private async checkOrderTrigger(
    order: OnChainCloseOrder,
    poolAddress: string,
    chainId: number,
    currentSqrtPriceX96: bigint,
    currentTick: number
  ): Promise<boolean> {
    // Guard: triggerTick must be set
    if (order.triggerTick === null || order.triggerTick === undefined) {
      log.warn({ orderId: order.id, msg: 'Order has no triggerTick set' });
      return false;
    }

    // Tick-based trigger comparison
    let triggered = false;
    let triggerSide: 'lower' | 'upper';

    if (order.triggerMode === 0) {
      // LOWER: triggered when currentTick <= triggerTick
      triggered = currentTick <= order.triggerTick;
      triggerSide = 'lower';
    } else {
      // UPPER: triggered when currentTick >= triggerTick
      triggered = currentTick >= order.triggerTick;
      triggerSide = 'upper';
    }

    if (!triggered) {
      return false;
    }

    // Verify order is still monitoring before publishing (race safety)
    const onChainCloseOrderService = getOnChainCloseOrderService();
    const freshOrder = await onChainCloseOrderService.findById(order.id);
    if (!freshOrder || freshOrder.monitoringState !== 'monitoring') {
      log.debug(
        { orderId: order.id, monitoringState: freshOrder?.monitoringState },
        'Order no longer monitoring, skipping trigger'
      );
      return false;
    }

    // Log trigger detection
    autoLog.orderTriggered(
      log,
      order.id,
      order.positionId,
      poolAddress,
      `tick=${currentTick}`,
      `triggerTick=${order.triggerTick}`
    );

    // Publish trigger message
    // Include currentSqrtPriceX96 as the price context for the executor
    await this.publishOrderTrigger({
      orderId: order.id,
      positionId: order.positionId,
      poolAddress,
      chainId,
      currentPrice: currentSqrtPriceX96.toString(),
      triggerPrice: currentSqrtPriceX96.toString(),
      triggerSide,
      triggeredAt: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Check hedge vault trigger condition
   */
  private checkHedgeVaultTrigger(
    currentSqrtPrice: bigint,
    currentBlock: bigint,
    vault: {
      state: string;
      token0IsQuote: boolean;
      silSqrtPriceX96: string;
      tipSqrtPriceX96: string;
      lastCloseBlock: string | null;
      reopenCooldownBlocks: string;
    }
  ): HedgeVaultTriggerType | null {
    const silSqrtPriceX96 = BigInt(vault.silSqrtPriceX96);
    const tipSqrtPriceX96 = BigInt(vault.tipSqrtPriceX96);

    // Check SIL/TIP triggers when IN_POSITION
    if (vault.state === 'IN_POSITION') {
      if (vault.token0IsQuote) {
        // sqrtPrice UP = actual price DOWN (price inversion)
        if (currentSqrtPrice >= silSqrtPriceX96) return 'sil';
        if (currentSqrtPrice <= tipSqrtPriceX96) return 'tip';
      } else {
        // sqrtPrice DOWN = actual price DOWN (no inversion)
        if (currentSqrtPrice <= silSqrtPriceX96) return 'sil';
        if (currentSqrtPrice >= tipSqrtPriceX96) return 'tip';
      }
    }

    // Check reopen trigger when OUT_OF_POSITION
    if (vault.state === 'OUT_OF_POSITION_QUOTE' || vault.state === 'OUT_OF_POSITION_BASE') {
      const lastCloseBlock = vault.lastCloseBlock ? BigInt(vault.lastCloseBlock) : 0n;
      const reopenCooldownBlocks = BigInt(vault.reopenCooldownBlocks);

      // Check cooldown
      const cooldownExpired = currentBlock >= lastCloseBlock + reopenCooldownBlocks;
      if (!cooldownExpired) return null;

      // Price must be between SIL and TIP
      let priceInRange: boolean;
      if (vault.token0IsQuote) {
        priceInRange = currentSqrtPrice < silSqrtPriceX96 && currentSqrtPrice > tipSqrtPriceX96;
      } else {
        priceInRange = currentSqrtPrice > silSqrtPriceX96 && currentSqrtPrice < tipSqrtPriceX96;
      }

      if (priceInRange) return 'reopen';
    }

    return null;
  }

  /**
   * Publish order trigger message
   */
  private async publishOrderTrigger(message: OrderTriggerMessage): Promise<void> {
    const mq = getRabbitMQConnection();
    const content = serializeMessage(message);

    await mq.publish(EXCHANGES.TRIGGERS, ROUTING_KEYS.ORDER_TRIGGERED, content);

    autoLog.mqEvent(log, 'published', EXCHANGES.TRIGGERS, {
      orderId: message.orderId,
      routingKey: ROUTING_KEYS.ORDER_TRIGGERED,
      source: 'pool-price',
    });
  }

  /**
   * Publish hedge vault trigger message
   */
  private async publishHedgeVaultTrigger(message: HedgeVaultTriggerMessage): Promise<void> {
    const mq = getRabbitMQConnection();
    const content = serializeMessage(message);

    await mq.publish(EXCHANGES.TRIGGERS, ROUTING_KEYS.HEDGE_VAULT_TRIGGERED, content);

    autoLog.mqEvent(log, 'published', EXCHANGES.TRIGGERS, {
      vaultId: message.vaultId,
      triggerType: message.triggerType,
      routingKey: ROUTING_KEYS.HEDGE_VAULT_TRIGGERED,
    });
  }

  /**
   * Schedule periodic subscription sync
   */
  private scheduleSyncTimer(): void {
    this.syncTimer = setInterval(() => {
      if (this.status === 'running') {
        this.syncSubscriptions().catch((err) => {
          autoLog.methodError(log, 'scheduledSync', err);
        });
      }
    }, SUBSCRIPTION_SYNC_INTERVAL_MS);

    log.debug({
      intervalMs: SUBSCRIPTION_SYNC_INTERVAL_MS,
      msg: 'Scheduled periodic subscription sync',
    });
  }
}
