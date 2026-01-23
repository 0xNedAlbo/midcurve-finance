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
 */

import { prisma } from '@midcurve/database';
import {
  getCloseOrderService,
  getPositionService,
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
import {
  pricePerToken0InToken1,
  pricePerToken1InToken0,
  formatCurrency,
} from '@midcurve/shared';

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
 * Extract sqrtPriceX96 from raw Swap event
 */
function extractSwapData(raw: unknown): { sqrtPriceX96: bigint; blockNumber: bigint } {
  const swapLog = raw as RawSwapLog;
  return {
    sqrtPriceX96: BigInt(swapLog.args.sqrtPriceX96),
    blockNumber: BigInt(swapLog.blockNumber),
  };
}

/**
 * Convert sqrtPriceX96 to actual token price (quote per base)
 * Takes isToken0Quote into account to return the user-facing price
 */
function sqrtPriceToActualPrice(
  sqrtPriceX96: bigint,
  isToken0Quote: boolean,
  baseTokenDecimals: number
): bigint {
  if (isToken0Quote) {
    return pricePerToken1InToken0(sqrtPriceX96, baseTokenDecimals);
  } else {
    return pricePerToken0InToken1(sqrtPriceX96, baseTokenDecimals);
  }
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
   * Sync order subscriptions
   */
  private async syncOrderSubscriptions(): Promise<void> {
    const closeOrderService = getCloseOrderService();

    // Get all pools with active orders
    const poolsWithOrders = await closeOrderService.getPoolsWithActiveOrders();

    // Collect all active orders from all pools
    const allActiveOrders: Array<{
      id: string;
      positionId: string;
      poolAddress: string;
      poolId: string;
      chainId: number;
      config: unknown;
    }> = [];

    for (const pool of poolsWithOrders) {
      const ordersForPool = await closeOrderService.findActiveOrdersForPool(pool.poolAddress);
      for (const order of ordersForPool) {
        allActiveOrders.push({
          id: order.id,
          positionId: order.positionId,
          poolAddress: pool.poolAddress,
          poolId: pool.poolId,
          chainId: pool.chainId,
          config: order.config,
        });
      }
    }

    // Get set of active order IDs
    const activeOrderIds = new Set(allActiveOrders.map((o) => o.id));

    // Remove subscribers for orders that are no longer active
    for (const [orderId, subscriber] of this.orderSubscribers.entries()) {
      if (!activeOrderIds.has(orderId)) {
        log.debug({ orderId }, 'Removing subscriber for inactive order');
        await subscriber.shutdown().catch((err) => {
          log.warn({ error: err, orderId, msg: 'Error shutting down order subscriber' });
        });
        this.orderSubscribers.delete(orderId);
      }
    }

    // Add subscribers for new active orders
    for (const order of allActiveOrders) {
      if (!this.orderSubscribers.has(order.id)) {
        await this.createOrderSubscriber(order);
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
    config: unknown;
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
   * Handle Swap event for an order
   */
  private async handleOrderSwapEvent(
    orderId: string,
    message: RawSwapEventWrapper
  ): Promise<void> {
    this.eventsProcessed++;
    this.lastProcessedAt = new Date();

    try {
      // Get fresh order data (may have been modified)
      const closeOrderService = getCloseOrderService();
      const order = await closeOrderService.findById(orderId);

      if (!order) {
        log.debug({ orderId }, 'Order not found, shutting down subscriber');
        await this.shutdownOrderSubscriber(orderId);
        return;
      }

      if (order.status !== 'active') {
        log.debug({ orderId, status: order.status }, 'Order no longer active');
        await this.shutdownOrderSubscriber(orderId);
        return;
      }

      const { sqrtPriceX96 } = extractSwapData(message.raw);
      const orderConfig = order.config as {
        sqrtPriceX96Lower?: string;
        sqrtPriceX96Upper?: string;
      };

      const triggered = await this.checkOrderTrigger(
        order.id,
        order.positionId,
        message.poolAddress,
        message.chainId,
        sqrtPriceX96,
        {
          sqrtPriceX96Lower: BigInt(orderConfig.sqrtPriceX96Lower || '0'),
          sqrtPriceX96Upper: BigInt(orderConfig.sqrtPriceX96Upper || '0'),
        }
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
   * Check if an order's trigger condition is met
   */
  private async checkOrderTrigger(
    orderId: string,
    positionId: string,
    poolAddress: string,
    chainId: number,
    currentSqrtPrice: bigint,
    config: { sqrtPriceX96Lower: bigint; sqrtPriceX96Upper: bigint }
  ): Promise<boolean> {
    const { sqrtPriceX96Lower, sqrtPriceX96Upper } = config;

    // Fetch position to get isToken0Quote and token decimals
    const positionService = getPositionService();
    const position = await positionService.findById(positionId);

    if (!position) {
      log.warn({ orderId, positionId, msg: 'Position not found for trigger evaluation' });
      return false;
    }

    const { isToken0Quote } = position;
    const baseTokenDecimals = isToken0Quote
      ? position.pool.token1.decimals
      : position.pool.token0.decimals;
    const quoteTokenDecimals = isToken0Quote
      ? position.pool.token0.decimals
      : position.pool.token1.decimals;

    // Convert sqrtPrices to actual token prices
    const currentPrice = sqrtPriceToActualPrice(currentSqrtPrice, isToken0Quote, baseTokenDecimals);
    const lowerTriggerPrice =
      sqrtPriceX96Lower > 0n
        ? sqrtPriceToActualPrice(sqrtPriceX96Lower, isToken0Quote, baseTokenDecimals)
        : 0n;
    const upperTriggerPrice =
      sqrtPriceX96Upper > 0n
        ? sqrtPriceToActualPrice(sqrtPriceX96Upper, isToken0Quote, baseTokenDecimals)
        : 0n;

    let triggerSide: 'lower' | 'upper' | null = null;
    let triggerPrice: bigint | null = null;

    // Lower trigger = stop loss
    if (lowerTriggerPrice > 0n && currentPrice <= lowerTriggerPrice) {
      triggerSide = 'lower';
      triggerPrice = lowerTriggerPrice;
    }
    // Upper trigger = take profit
    else if (upperTriggerPrice > 0n && currentPrice >= upperTriggerPrice) {
      triggerSide = 'upper';
      triggerPrice = upperTriggerPrice;
    }

    if (!triggerSide || !triggerPrice) {
      return false;
    }

    // Verify order is still active before publishing
    const closeOrderService = getCloseOrderService();
    const order = await closeOrderService.findById(orderId);

    if (!order || order.status !== 'active') {
      log.debug({ orderId, status: order?.status }, 'Order no longer active, skipping trigger');
      return false;
    }

    // Log with human-readable prices
    const currentPriceFormatted = formatCurrency(currentPrice.toString(), quoteTokenDecimals);
    const triggerPriceFormatted = formatCurrency(triggerPrice.toString(), quoteTokenDecimals);

    autoLog.orderTriggered(
      log,
      orderId,
      positionId,
      poolAddress,
      currentPriceFormatted,
      triggerPriceFormatted
    );

    // Publish trigger message
    await this.publishOrderTrigger({
      orderId,
      positionId,
      poolAddress,
      chainId,
      currentPrice: currentPrice.toString(),
      triggerPrice: triggerPrice.toString(),
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
