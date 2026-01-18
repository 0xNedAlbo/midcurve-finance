/**
 * Price Monitor Worker
 *
 * Polls pool prices for pools with active close orders.
 * Publishes trigger events to RabbitMQ when price conditions are met.
 */

import { getPoolSubscriptionService, getCloseOrderService, getUniswapV3PoolService, getPositionService, getHedgeVaultService } from '../lib/services';
import { readPoolPrice, readBlockNumber, type SupportedChainId } from '../lib/evm';
import { isSupportedChain, getWorkerConfig } from '../lib/config';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { EXCHANGES, ROUTING_KEYS } from '../mq/topology';
import { serializeMessage, type OrderTriggerMessage, type HedgeVaultTriggerMessage, type HedgeVaultTriggerType } from '../mq/messages';
import { pricePerToken0InToken1, pricePerToken1InToken0, formatCurrency } from '@midcurve/shared';

const log = automationLogger.child({ component: 'PriceMonitor' });

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert sqrtPriceX96 to actual token price (quote per base)
 * Takes isToken0Quote into account to return the user-facing price
 *
 * When isToken0Quote=true: quote=token0, base=token1, price=token0/token1
 * When isToken0Quote=false: quote=token1, base=token0, price=token1/token0
 */
function sqrtPriceToActualPrice(
  sqrtPriceX96: bigint,
  isToken0Quote: boolean,
  baseTokenDecimals: number
): bigint {
  if (isToken0Quote) {
    // quote = token0, base = token1
    // Price = token0 per token1
    return pricePerToken1InToken0(sqrtPriceX96, baseTokenDecimals);
  } else {
    // quote = token1, base = token0
    // Price = token1 per token0
    return pricePerToken0InToken1(sqrtPriceX96, baseTokenDecimals);
  }
}

// =============================================================================
// Types
// =============================================================================

export interface PriceMonitorStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  poolsMonitored: number;
  lastPollAt: string | null;
  pollIntervalMs: number;
  triggeredOrdersTotal: number;
  triggeredVaultsTotal: number;
}

// =============================================================================
// Worker
// =============================================================================

export class PriceMonitor {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private pollIntervalMs: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private poolsMonitored = 0;
  private lastPollAt: Date | null = null;
  private triggeredOrdersTotal = 0;
  private triggeredVaultsTotal = 0;

  constructor() {
    const config = getWorkerConfig();
    this.pollIntervalMs = config.pricePollIntervalMs;
  }

  /**
   * Start the price monitor
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'PriceMonitor already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'PriceMonitor', 'starting');
    this.status = 'running';

    // Start polling loop
    this.schedulePoll();

    autoLog.workerLifecycle(log, 'PriceMonitor', 'started', {
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  /**
   * Stop the price monitor
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'PriceMonitor', 'stopping');
    this.status = 'stopping';

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'PriceMonitor', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): PriceMonitorStatus {
    return {
      status: this.status,
      poolsMonitored: this.poolsMonitored,
      lastPollAt: this.lastPollAt?.toISOString() || null,
      pollIntervalMs: this.pollIntervalMs,
      triggeredOrdersTotal: this.triggeredOrdersTotal,
      triggeredVaultsTotal: this.triggeredVaultsTotal,
    };
  }

  /**
   * Schedule next poll
   */
  private schedulePoll(): void {
    if (this.status !== 'running') {
      return;
    }

    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll();
      } catch (err) {
        autoLog.methodError(log, 'poll', err);
      }

      // Schedule next poll
      this.schedulePoll();
    }, this.pollIntervalMs);
  }

  /**
   * Execute one poll cycle
   */
  private async poll(): Promise<void> {
    const startTime = Date.now();

    // Get pools with active orders
    const subscriptionService = getPoolSubscriptionService();
    const poolService = getUniswapV3PoolService();
    const hedgeVaultService = getHedgeVaultService();
    const subscriptions = await subscriptionService.getSubscriptionsToMonitor();

    // Also get pools with active hedge vaults (may overlap with subscriptions)
    const activeVaults = await hedgeVaultService.findActiveVaults();
    const vaultPoolAddresses = new Set(activeVaults.map((v) => v.poolAddress.toLowerCase()));

    // Count unique pools monitored (subscriptions + vault pools)
    const subscriptionPoolIds = new Set(subscriptions.map((s) => s.poolId));
    this.poolsMonitored = subscriptionPoolIds.size + vaultPoolAddresses.size;

    if (subscriptions.length === 0 && activeVaults.length === 0) {
      return;
    }

    let triggeredOrderCount = 0;
    let triggeredVaultCount = 0;

    // Track processed pool addresses to avoid duplicate price reads
    const processedPools = new Map<string, { sqrtPriceX96: bigint; tick: number; chainId: number }>();

    // Check pools from subscriptions (for close orders)
    for (const subscription of subscriptions) {
      try {
        // Get pool details (chainId and address) from the Pool table
        const pool = await poolService.findById(subscription.poolId);
        if (!pool) {
          log.warn({ poolId: subscription.poolId, msg: 'Pool not found for subscription' });
          continue;
        }

        // Extract chain and address from pool config
        const poolConfig = pool.config as { chainId?: number; address?: string };
        const chainId = poolConfig.chainId;
        const poolAddress = poolConfig.address;

        if (!chainId || !poolAddress) {
          log.warn({ poolId: subscription.poolId, msg: 'Pool missing chainId or address' });
          continue;
        }

        // Skip unsupported chains
        if (!isSupportedChain(chainId)) {
          log.warn({ chainId, poolId: subscription.poolId, msg: 'Unsupported chain' });
          continue;
        }

        // Read current price
        const { sqrtPriceX96, tick } = await readPoolPrice(
          chainId as SupportedChainId,
          poolAddress as `0x${string}`
        );

        // Cache for vault checks
        processedPools.set(poolAddress.toLowerCase(), { sqrtPriceX96, tick, chainId });

        // Update subscription with current price
        await subscriptionService.updatePrice(subscription.poolId, sqrtPriceX96, tick);

        // Get active orders for this pool
        const closeOrderService = getCloseOrderService();
        const orders = await closeOrderService.findActiveOrdersForPool(poolAddress);

        // Check each order for trigger condition
        for (const order of orders) {
          // Order config stores prices as strings
          const orderConfig = order.config as {
            sqrtPriceX96Lower?: string;
            sqrtPriceX96Upper?: string;
          };

          const triggered = await this.checkTrigger(
            order.id,
            order.positionId,
            poolAddress,
            chainId,
            sqrtPriceX96,
            {
              sqrtPriceX96Lower: BigInt(orderConfig.sqrtPriceX96Lower || '0'),
              sqrtPriceX96Upper: BigInt(orderConfig.sqrtPriceX96Upper || '0'),
            }
          );

          if (triggered) {
            triggeredOrderCount++;
            this.triggeredOrdersTotal++;
          }
        }
      } catch (err) {
        autoLog.methodError(log, 'poll.pool', err, {
          poolId: subscription.poolId,
        });
      }
    }

    // Check hedge vaults (may need to read additional pools)
    for (const vault of activeVaults) {
      try {
        const poolKey = vault.poolAddress.toLowerCase();
        let priceData = processedPools.get(poolKey);

        // If pool wasn't processed via subscription, read price now
        if (!priceData) {
          if (!isSupportedChain(vault.chainId)) {
            log.warn({ chainId: vault.chainId, vaultId: vault.id, msg: 'Unsupported chain for vault' });
            continue;
          }

          const { sqrtPriceX96, tick } = await readPoolPrice(
            vault.chainId as SupportedChainId,
            vault.poolAddress as `0x${string}`
          );
          priceData = { sqrtPriceX96, tick, chainId: vault.chainId };
          processedPools.set(poolKey, priceData);
        }

        // Get current block number for reopen cooldown check
        const currentBlock = await readBlockNumber(vault.chainId as SupportedChainId);

        // Check hedge vault trigger
        const triggerType = this.checkHedgeVaultTrigger(
          priceData.sqrtPriceX96,
          currentBlock,
          vault
        );

        if (triggerType) {
          // Verify vault is still in correct state before publishing
          const currentVault = await hedgeVaultService.findById(vault.id);
          if (!currentVault || currentVault.monitoringStatus !== 'active') {
            log.debug({ vaultId: vault.id }, 'Vault no longer active, skipping trigger');
            continue;
          }

          autoLog.hedgeVaultTriggered(
            log,
            vault.id,
            vault.vaultAddress,
            vault.poolAddress,
            triggerType,
            priceData.sqrtPriceX96.toString()
          );

          // Publish trigger message
          await this.publishHedgeVaultTrigger({
            vaultId: vault.id,
            vaultAddress: vault.vaultAddress,
            poolAddress: vault.poolAddress,
            chainId: vault.chainId,
            triggerType,
            currentSqrtPriceX96: priceData.sqrtPriceX96.toString(),
            silSqrtPriceX96: vault.silSqrtPriceX96,
            tipSqrtPriceX96: vault.tipSqrtPriceX96,
            token0IsQuote: vault.token0IsQuote,
            currentBlock: currentBlock.toString(),
            triggeredAt: new Date().toISOString(),
          });

          triggeredVaultCount++;
          this.triggeredVaultsTotal++;
        }
      } catch (err) {
        autoLog.methodError(log, 'poll.vault', err, {
          vaultId: vault.id,
        });
      }
    }

    this.lastPollAt = new Date();
    const durationMs = Date.now() - startTime;

    log.info({
      poolsMonitored: this.poolsMonitored,
      triggeredOrders: triggeredOrderCount,
      triggeredVaults: triggeredVaultCount,
      durationMs,
      msg: `Price poll: ${this.poolsMonitored} pools, ${triggeredOrderCount} orders triggered, ${triggeredVaultCount} vaults triggered (${durationMs}ms)`,
    });
  }

  /**
   * Check if an order's trigger condition is met
   *
   * Converts sqrtPriceX96 values to actual token prices before comparison,
   * taking isToken0Quote into account to handle inverted price relationships.
   */
  private async checkTrigger(
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
    // Base token is token1 if isToken0Quote, otherwise token0
    const baseTokenDecimals = isToken0Quote
      ? position.pool.token1.decimals
      : position.pool.token0.decimals;
    // Quote token decimals for formatting
    const quoteTokenDecimals = isToken0Quote
      ? position.pool.token0.decimals
      : position.pool.token1.decimals;

    // Convert sqrtPrices to actual token prices (quote per base)
    const currentPrice = sqrtPriceToActualPrice(currentSqrtPrice, isToken0Quote, baseTokenDecimals);
    const lowerTriggerPrice = sqrtPriceX96Lower > 0n
      ? sqrtPriceToActualPrice(sqrtPriceX96Lower, isToken0Quote, baseTokenDecimals)
      : 0n;
    const upperTriggerPrice = sqrtPriceX96Upper > 0n
      ? sqrtPriceToActualPrice(sqrtPriceX96Upper, isToken0Quote, baseTokenDecimals)
      : 0n;

    let triggerSide: 'lower' | 'upper' | null = null;
    let triggerPrice: bigint | null = null;

    // Compare ACTUAL prices (not sqrtPrices)
    // Lower trigger = stop loss: actual price dropped to or below threshold
    if (lowerTriggerPrice > 0n && currentPrice <= lowerTriggerPrice) {
      triggerSide = 'lower';
      triggerPrice = lowerTriggerPrice;
    }
    // Upper trigger = take profit: actual price rose to or above threshold
    else if (upperTriggerPrice > 0n && currentPrice >= upperTriggerPrice) {
      triggerSide = 'upper';
      triggerPrice = upperTriggerPrice;
    }

    if (!triggerSide || !triggerPrice) {
      return false;
    }

    // CRITICAL: Verify order is still 'active' before publishing trigger message
    // This prevents duplicate messages when the order is already being processed
    const closeOrderService = getCloseOrderService();
    const order = await closeOrderService.findById(orderId);

    if (!order) {
      log.debug({ orderId }, 'Order not found, skipping trigger');
      return false;
    }

    if (order.status !== 'active') {
      log.debug(
        { orderId, status: order.status },
        'Order no longer active, skipping trigger (already processing or completed)'
      );
      return false;
    }

    // Log with human-readable prices for clarity
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

    // Publish trigger message (with raw prices for precision)
    await this.publishTrigger({
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
   * Publish trigger message to RabbitMQ
   */
  private async publishTrigger(message: OrderTriggerMessage): Promise<void> {
    const mq = getRabbitMQConnection();
    const content = serializeMessage(message);

    await mq.publish(EXCHANGES.TRIGGERS, ROUTING_KEYS.ORDER_TRIGGERED, content);

    autoLog.mqEvent(log, 'published', EXCHANGES.TRIGGERS, {
      orderId: message.orderId,
      routingKey: ROUTING_KEYS.ORDER_TRIGGERED,
    });
  }

  // =============================================================================
  // Hedge Vault Trigger Detection
  // =============================================================================

  /**
   * Vault data interface for trigger checking
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
      // Explicit inversion handling (same logic as contract)
      if (vault.token0IsQuote) {
        // sqrtPrice UP = actual price DOWN (price inversion)
        // SIL = "Stop Impermanent Loss" = actual price dropped
        if (currentSqrtPrice >= silSqrtPriceX96) return 'sil';
        // sqrtPrice DOWN = actual price UP
        // TIP = "Take Impermanent Profit" = actual price rose
        if (currentSqrtPrice <= tipSqrtPriceX96) return 'tip';
      } else {
        // sqrtPrice DOWN = actual price DOWN (no inversion)
        if (currentSqrtPrice <= silSqrtPriceX96) return 'sil';
        // sqrtPrice UP = actual price UP
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

      // Price must be between SIL and TIP (in actual price terms)
      let priceInRange: boolean;
      if (vault.token0IsQuote) {
        // Inverted: SIL sqrtPrice > TIP sqrtPrice (in sqrtPrice space)
        priceInRange = currentSqrtPrice < silSqrtPriceX96 && currentSqrtPrice > tipSqrtPriceX96;
      } else {
        // Normal: SIL sqrtPrice < TIP sqrtPrice
        priceInRange = currentSqrtPrice > silSqrtPriceX96 && currentSqrtPrice < tipSqrtPriceX96;
      }

      if (priceInRange) return 'reopen';
    }

    return null;
  }

  /**
   * Publish hedge vault trigger message to RabbitMQ
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
}
