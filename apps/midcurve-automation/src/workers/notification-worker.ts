/**
 * Notification Worker
 *
 * RabbitMQ consumer that processes notification events.
 * Creates notification records in database and sends webhooks.
 */

import type { UserNotification } from '@midcurve/database';
import type { NotificationEventType, NotificationPayload } from '@midcurve/api-shared';
import type { UniswapV3Position, UniswapV3Pool, CloseOrderInterface } from '@midcurve/shared';
import {
  formatCompactValue,
  tickToSqrtRatioX96,
  sqrtRatioX96ToToken1PerToken0,
  sqrtRatioX96ToToken0PerToken1,
  getQuoteToken,
  getBaseToken,
} from '@midcurve/shared';
import JSBI from 'jsbi';
import {
  getNotificationService,
  getWebhookDeliveryService,
  getPositionService,
  getCloseOrderService,
} from '../lib/services';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection, type ConsumeMessage } from '../mq/connection-manager';
import { QUEUES } from '../mq/topology';
import {
  deserializeMessage,
  type RangeChangeNotificationMessage,
  type ExecutionResultNotificationMessage,
} from '../mq/messages';

const log = automationLogger.child({ component: 'NotificationWorker' });

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Convert sqrtPriceX96 to human-readable price string
 * Price is expressed in quote token per base token
 */
function formatSqrtPriceX96(
  sqrtPriceX96: string | JSBI,
  decimals0: number,
  decimals1: number,
  quoteIsToken0: boolean
): string {
  const sqrtJSBI = typeof sqrtPriceX96 === 'string' ? JSBI.BigInt(sqrtPriceX96) : sqrtPriceX96;

  // Get price in the appropriate direction
  const priceRaw = quoteIsToken0
    ? sqrtRatioX96ToToken0PerToken1(sqrtJSBI, decimals1) // quote=token0, price of token1 in token0
    : sqrtRatioX96ToToken1PerToken0(sqrtJSBI, decimals0); // quote=token1, price of token0 in token1

  // Format using quote token decimals
  const quoteDecimals = quoteIsToken0 ? decimals0 : decimals1;
  return formatCompactValue(priceRaw, quoteDecimals);
}

/**
 * Convert tick to human-readable price string
 */
function formatTickAsPrice(
  tick: number,
  decimals0: number,
  decimals1: number,
  quoteIsToken0: boolean
): string {
  const sqrtPriceX96 = tickToSqrtRatioX96(tick);
  return formatSqrtPriceX96(sqrtPriceX96, decimals0, decimals1, quoteIsToken0);
}

/**
 * Format a bigint amount with token decimals
 */
function formatAmount(amount: bigint, decimals: number): string {
  return formatCompactValue(amount, decimals);
}

/**
 * Serialize a position for webhook payload (convert bigints to strings)
 */
function serializePositionForWebhook(position: UniswapV3Position): Record<string, unknown> {
  const pool = position.pool as UniswapV3Pool;
  const quoteToken = getQuoteToken(position);
  const baseToken = getBaseToken(position);

  return {
    id: position.id,
    positionHash: position.positionHash,
    protocol: position.protocol,
    positionType: position.positionType,
    isActive: position.isActive,
    currentValue: position.currentValue.toString(),
    currentCostBasis: position.currentCostBasis.toString(),
    realizedPnl: position.realizedPnl.toString(),
    unrealizedPnl: position.unrealizedPnl.toString(),
    unClaimedFees: position.unClaimedFees.toString(),
    collectedFees: position.collectedFees.toString(),
    totalApr: position.totalApr,
    positionOpenedAt: position.positionOpenedAt?.toISOString() ?? null,
    lastFeesCollectedAt: position.lastFeesCollectedAt?.toISOString() ?? null,
    pool: {
      id: pool.id,
      poolType: pool.poolType,
      token0: {
        id: pool.token0.id,
        symbol: pool.token0.symbol,
        name: pool.token0.name,
        decimals: pool.token0.decimals,
      },
      token1: {
        id: pool.token1.id,
        symbol: pool.token1.symbol,
        name: pool.token1.name,
        decimals: pool.token1.decimals,
      },
      quoteToken: {
        id: quoteToken.id,
        symbol: quoteToken.symbol,
        name: quoteToken.name,
        decimals: quoteToken.decimals,
      },
      baseToken: {
        id: baseToken.id,
        symbol: baseToken.symbol,
        name: baseToken.name,
        decimals: baseToken.decimals,
      },
      isToken0Quote: position.isToken0Quote,
      config: pool.config,
    },
    config: {
      chainId: position.config.chainId,
      nftId: position.config.nftId.toString(),
      tickLower: position.config.tickLower,
      tickUpper: position.config.tickUpper,
    },
    state: {
      ownerAddress: position.state.ownerAddress,
      liquidity: position.state.liquidity.toString(),
      feeGrowthInside0LastX128: position.state.feeGrowthInside0LastX128.toString(),
      feeGrowthInside1LastX128: position.state.feeGrowthInside1LastX128.toString(),
      tokensOwed0: position.state.tokensOwed0.toString(),
      tokensOwed1: position.state.tokensOwed1.toString(),
    },
    createdAt: position.createdAt.toISOString(),
    updatedAt: position.updatedAt.toISOString(),
  };
}

/**
 * Serialize a close order for webhook payload
 */
function serializeCloseOrderForWebhook(closeOrder: CloseOrderInterface): Record<string, unknown> {
  return {
    id: closeOrder.id,
    closeOrderType: closeOrder.closeOrderType,
    status: closeOrder.status,
    positionId: closeOrder.positionId,
    automationContractConfig: closeOrder.automationContractConfig,
    config: closeOrder.config,
    state: closeOrder.state,
    createdAt: closeOrder.createdAt.toISOString(),
    updatedAt: closeOrder.updatedAt.toISOString(),
  };
}

// =============================================================================
// Types
// =============================================================================

export interface NotificationWorkerStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  consumerCount: number;
  processedTotal: number;
  failedTotal: number;
  webhooksSentTotal: number;
  lastProcessedAt: string | null;
}

/** Union type for all notification messages */
type NotificationMessage = RangeChangeNotificationMessage | ExecutionResultNotificationMessage;

// =============================================================================
// Worker
// =============================================================================

export class NotificationWorker {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private consumerCount = 2; // Default competing consumers
  private consumerTags: string[] = [];
  private processedTotal = 0;
  private failedTotal = 0;
  private webhooksSentTotal = 0;
  private lastProcessedAt: Date | null = null;

  /**
   * Start the notification worker consumers
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'NotificationWorker already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'NotificationWorker', 'starting');
    this.status = 'running';

    const mq = getRabbitMQConnection();

    // Start competing consumers
    for (let i = 0; i < this.consumerCount; i++) {
      const tag = await mq.consume(
        QUEUES.NOTIFICATIONS_PENDING,
        async (msg) => this.handleMessage(msg),
        { prefetch: 1 }
      );
      this.consumerTags.push(tag);
    }

    autoLog.workerLifecycle(log, 'NotificationWorker', 'started', {
      consumerCount: this.consumerCount,
    });
  }

  /**
   * Stop the notification worker
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'NotificationWorker', 'stopping');
    this.status = 'stopping';

    const mq = getRabbitMQConnection();

    // Cancel all consumers
    for (const tag of this.consumerTags) {
      try {
        await mq.cancelConsumer(tag);
      } catch (err) {
        autoLog.methodError(log, 'stop.cancelConsumer', err, { tag });
      }
    }

    this.consumerTags = [];
    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'NotificationWorker', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): NotificationWorkerStatus {
    return {
      status: this.status,
      consumerCount: this.consumerCount,
      processedTotal: this.processedTotal,
      failedTotal: this.failedTotal,
      webhooksSentTotal: this.webhooksSentTotal,
      lastProcessedAt: this.lastProcessedAt?.toISOString() || null,
    };
  }

  /**
   * Handle incoming notification message
   */
  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    // Null message means consumer was cancelled
    if (!msg) {
      return;
    }

    const startTime = Date.now();
    const mq = getRabbitMQConnection();

    try {
      const message = deserializeMessage<NotificationMessage>(msg.content);

      log.info(
        {
          eventType: message.eventType,
          userId: message.userId,
          positionId: message.positionId,
        },
        'Processing notification message'
      );

      // Create notification in database and send webhook
      await this.createNotificationAndSendWebhook(message);

      this.processedTotal++;
      this.lastProcessedAt = new Date();

      const durationMs = Date.now() - startTime;
      log.info(
        {
          eventType: message.eventType,
          userId: message.userId,
          positionId: message.positionId,
          durationMs,
        },
        'Notification processed successfully'
      );

      // Acknowledge the message
      await mq.ack(msg);
    } catch (err) {
      this.failedTotal++;
      autoLog.methodError(log, 'handleMessage', err);

      // Nack without requeue to avoid infinite loops
      // In production, consider dead-letter queue
      await mq.nack(msg, false);
    }
  }

  /**
   * Create notification record in database and trigger webhook delivery
   */
  private async createNotificationAndSendWebhook(message: NotificationMessage): Promise<void> {
    const notificationService = getNotificationService();

    // Determine notification content based on event type (async to fetch enrichment data)
    const { title, notificationMessage, payload } = await this.buildNotificationContent(message);

    // Create notification in database
    const notification = await notificationService.create({
      userId: message.userId,
      eventType: message.eventType as NotificationEventType,
      positionId: message.positionId,
      title,
      message: notificationMessage,
      payload: payload as unknown as NotificationPayload,
    });

    log.info(
      {
        userId: message.userId,
        eventType: message.eventType,
        positionId: message.positionId,
        notificationId: notification.id,
      },
      'Notification record created'
    );

    // Send webhook (fire-and-forget, don't block on this)
    this.sendWebhookAsync(notification);
  }

  /**
   * Build notification content based on event type
   */
  private async buildNotificationContent(message: NotificationMessage): Promise<{
    title: string;
    notificationMessage: string;
    payload: Record<string, unknown>;
  }> {
    if (this.isRangeChangeMessage(message)) {
      return this.buildRangeChangeContent(message);
    } else {
      return this.buildExecutionResultContent(message);
    }
  }

  /**
   * Type guard for range change messages
   */
  private isRangeChangeMessage(
    message: NotificationMessage
  ): message is RangeChangeNotificationMessage {
    return (
      message.eventType === 'POSITION_OUT_OF_RANGE' ||
      message.eventType === 'POSITION_IN_RANGE'
    );
  }

  /**
   * Build content for range change notifications
   */
  private async buildRangeChangeContent(message: RangeChangeNotificationMessage): Promise<{
    title: string;
    notificationMessage: string;
    payload: Record<string, unknown>;
  }> {
    const isOutOfRange = message.eventType === 'POSITION_OUT_OF_RANGE';
    const title = isOutOfRange ? 'Position Out of Range' : 'Position Back in Range';

    // Fetch position with pool/token data for enrichment
    const positionService = getPositionService();
    let position: UniswapV3Position | null = null;

    try {
      position = await positionService.findById(message.positionId);
    } catch (err) {
      log.warn({ positionId: message.positionId, error: err }, 'Failed to fetch position for notification enrichment');
    }

    // Build base payload with raw data (always included)
    const payload: Record<string, unknown> = {
      poolId: message.poolId,
      poolAddress: message.poolAddress,
      chainId: message.chainId,
      currentTick: message.currentTick,
      currentSqrtPriceX96: message.currentSqrtPriceX96,
      tickLower: message.tickLower,
      tickUpper: message.tickUpper,
      detectedAt: message.detectedAt,
    };

    // If position found, add enriched data
    if (position) {
      const pool = position.pool as UniswapV3Pool;
      const quoteToken = getQuoteToken(position);
      const baseToken = getBaseToken(position);
      const quoteIsToken0 = position.isToken0Quote;
      const decimals0 = pool.token0.decimals;
      const decimals1 = pool.token1.decimals;

      // Human-readable message with token symbols
      const notificationMessage = isOutOfRange
        ? `Your ${baseToken.symbol}/${quoteToken.symbol} position is now out of range`
        : `Your ${baseToken.symbol}/${quoteToken.symbol} position is now back in range`;

      // Add human-readable data
      payload.quoteCurrency = quoteToken.symbol;
      payload.baseCurrency = baseToken.symbol;
      payload.currentPrice = formatSqrtPriceX96(message.currentSqrtPriceX96, decimals0, decimals1, quoteIsToken0);
      payload.priceLower = formatTickAsPrice(message.tickLower, decimals0, decimals1, quoteIsToken0);
      payload.priceUpper = formatTickAsPrice(message.tickUpper, decimals0, decimals1, quoteIsToken0);
      payload.currentPnl = formatAmount(position.unrealizedPnl, quoteToken.decimals);

      // Add full position object
      payload.position = serializePositionForWebhook(position);

      return { title, notificationMessage, payload };
    }

    // Fallback message without token symbols
    const notificationMessage = isOutOfRange
      ? `Your position is now out of range. Current tick: ${message.currentTick}, Range: [${message.tickLower}, ${message.tickUpper}]`
      : `Your position is now back in range. Current tick: ${message.currentTick}, Range: [${message.tickLower}, ${message.tickUpper}]`;

    return { title, notificationMessage, payload };
  }

  /**
   * Build content for execution result notifications
   */
  private async buildExecutionResultContent(message: ExecutionResultNotificationMessage): Promise<{
    title: string;
    notificationMessage: string;
    payload: Record<string, unknown>;
  }> {
    const isStopLoss = message.triggerSide === 'lower';
    const orderType = isStopLoss ? 'Stop Loss' : 'Take Profit';

    // Fetch position and close order for enrichment
    const positionService = getPositionService();
    const closeOrderService = getCloseOrderService();

    let position: UniswapV3Position | null = null;
    let closeOrder: CloseOrderInterface | null = null;

    try {
      [position, closeOrder] = await Promise.all([
        positionService.findById(message.positionId),
        closeOrderService.findById(message.orderId),
      ]);
    } catch (err) {
      log.warn({
        positionId: message.positionId,
        orderId: message.orderId,
        error: err,
      }, 'Failed to fetch position/closeOrder for notification enrichment');
    }

    const pool = position?.pool as UniswapV3Pool | undefined;
    const quoteToken = position ? getQuoteToken(position) : undefined;
    const baseToken = position ? getBaseToken(position) : undefined;

    // Build title and message based on event type
    let title: string;
    let notificationMessage: string;

    switch (message.eventType) {
      case 'STOP_LOSS_EXECUTED':
      case 'TAKE_PROFIT_EXECUTED':
        title = `${orderType} Executed`;
        notificationMessage = quoteToken && baseToken
          ? `${orderType} executed for your ${baseToken.symbol}/${quoteToken.symbol} position`
          : `Your ${orderType.toLowerCase()} order has been successfully executed`;
        if (message.txHash && !quoteToken) {
          notificationMessage += `. Transaction: ${message.txHash.slice(0, 10)}...`;
        }
        break;

      case 'STOP_LOSS_FAILED':
      case 'TAKE_PROFIT_FAILED':
        title = `${orderType} Failed`;
        notificationMessage = quoteToken && baseToken
          ? `${orderType} failed for your ${baseToken.symbol}/${quoteToken.symbol} position`
          : `Your ${orderType.toLowerCase()} order failed to execute`;
        if (message.error) {
          notificationMessage += `. Error: ${message.error}`;
        }
        break;
    }

    // Build base payload with raw data
    const payload: Record<string, unknown> = {
      orderId: message.orderId,
      chainId: message.chainId,
      triggerSide: message.triggerSide,
      triggerSqrtPriceX96: message.triggerSqrtPriceX96,
      timestamp: message.timestamp,
    };

    // Add success-specific fields
    if (message.txHash) payload.txHash = message.txHash;
    if (message.amount0Out) payload.amount0Out = message.amount0Out;
    if (message.amount1Out) payload.amount1Out = message.amount1Out;
    if (message.executionSqrtPriceX96) payload.executionSqrtPriceX96 = message.executionSqrtPriceX96;

    // Add failure-specific fields
    if (message.error) payload.error = message.error;
    if (message.retryCount !== undefined) payload.retryCount = message.retryCount;

    // Add enriched data if position found
    if (position && pool && quoteToken && baseToken) {
      const quoteIsToken0 = position.isToken0Quote;
      const decimals0 = pool.token0.decimals;
      const decimals1 = pool.token1.decimals;

      payload.quoteCurrency = quoteToken.symbol;
      payload.baseCurrency = baseToken.symbol;
      payload.triggerPrice = formatSqrtPriceX96(message.triggerSqrtPriceX96, decimals0, decimals1, quoteIsToken0);

      if (message.executionSqrtPriceX96) {
        payload.executionPrice = formatSqrtPriceX96(message.executionSqrtPriceX96, decimals0, decimals1, quoteIsToken0);
      }

      // Calculate amount out in quote token
      const amount0 = BigInt(message.amount0Out || '0');
      const amount1 = BigInt(message.amount1Out || '0');
      const quoteAmount = quoteIsToken0 ? amount0 : amount1;
      payload.amountOut = formatAmount(quoteAmount, quoteToken.decimals);
      payload.currentPnl = formatAmount(position.unrealizedPnl, quoteToken.decimals);

      // Add full position object
      payload.position = serializePositionForWebhook(position);
    }

    // Add close order if found
    if (closeOrder) {
      payload.closeOrder = serializeCloseOrderForWebhook(closeOrder);
    }

    return { title, notificationMessage, payload };
  }

  /**
   * Send webhook asynchronously (fire-and-forget)
   */
  private sendWebhookAsync(notification: UserNotification): void {
    // Run async without awaiting
    this.deliverWebhook(notification).catch((err) => {
      // Just log, don't fail the notification
      autoLog.methodError(log, 'sendWebhookAsync', err, {
        userId: notification.userId,
        eventType: notification.eventType,
      });
    });
  }

  /**
   * Deliver webhook to user's configured endpoint
   */
  private async deliverWebhook(notification: UserNotification): Promise<void> {
    const webhookService = getWebhookDeliveryService();

    const result = await webhookService.deliverWebhook(notification.userId, notification);

    if (result.success) {
      this.webhooksSentTotal++;
      log.info(
        {
          userId: notification.userId,
          eventType: notification.eventType,
          statusCode: result.statusCode,
          durationMs: result.durationMs,
        },
        'Webhook delivered successfully'
      );
    } else {
      log.warn(
        {
          userId: notification.userId,
          eventType: notification.eventType,
          error: result.error,
          statusCode: result.statusCode,
        },
        'Webhook delivery failed or skipped'
      );
    }
  }
}
