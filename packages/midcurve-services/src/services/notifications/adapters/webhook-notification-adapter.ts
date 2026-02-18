/**
 * Webhook Notification Adapter
 *
 * Delivers notifications to user-configured webhook endpoints.
 * Handles its own enrichment (fetching position/pool/order data),
 * preference checking (enabled events), and delivery.
 *
 * Best-effort: all errors are caught and logged, never thrown.
 */

import type { UniswapV3Position, UniswapV3Pool } from '@midcurve/shared';
import { getQuoteToken, getBaseToken } from '@midcurve/shared';
import type { WebhookDeliveryPayload } from '@midcurve/api-shared';
import { createServiceLogger, log } from '../../../logging/index.js';
import type { ServiceLogger } from '../../../logging/index.js';
import type { NotificationAdapter } from './notification-adapter.js';
import type { NotificationEvent } from '../events/index.js';
import {
  isRangeEvent,
  isExecutionSuccessEvent,
  isExecutionFailedEvent,
} from '../events/index.js';
import {
  formatSqrtPriceX96,
  formatTickAsPrice,
  formatAmount,
  serializePositionForWebhook,
  serializeCloseOrderForWebhook,
} from '../formatters/index.js';
import type { WebhookConfigService } from '../webhook-config-service.js';
import type { WebhookDeliveryService } from '../webhook-delivery-service.js';
import type { UniswapV3PositionService } from '../../position/uniswapv3-position-service.js';
import type { OnChainCloseOrderService } from '../../automation/on-chain-close-order-service.js';

// =============================================================================
// TYPES
// =============================================================================

export interface WebhookNotificationAdapterDependencies {
  webhookConfigService: WebhookConfigService;
  webhookDeliveryService: WebhookDeliveryService;
  positionService: UniswapV3PositionService;
  onChainCloseOrderService: OnChainCloseOrderService;
}

// =============================================================================
// ADAPTER
// =============================================================================

export class WebhookNotificationAdapter implements NotificationAdapter {
  readonly name = 'WebhookNotificationAdapter';
  private readonly logger: ServiceLogger;
  private readonly webhookConfigService: WebhookConfigService;
  private readonly webhookDeliveryService: WebhookDeliveryService;
  private readonly positionService: UniswapV3PositionService;
  private readonly onChainCloseOrderService: OnChainCloseOrderService;

  constructor(deps: WebhookNotificationAdapterDependencies) {
    this.logger = createServiceLogger('WebhookNotificationAdapter');
    this.webhookConfigService = deps.webhookConfigService;
    this.webhookDeliveryService = deps.webhookDeliveryService;
    this.positionService = deps.positionService;
    this.onChainCloseOrderService = deps.onChainCloseOrderService;
  }

  async deliver(event: NotificationEvent): Promise<void> {
    try {
      // 1. Check if user has webhooks enabled for this event type
      const config = await this.webhookConfigService.getByUserId(event.userId);
      if (!config || !config.isActive || !config.webhookUrl) {
        return;
      }

      const enabledEvents = config.enabledEvents as string[];
      if (!enabledEvents.includes(event.type)) {
        return;
      }

      // 2. Enrich and build payload
      const payload = await this.buildEnrichedPayload(event);

      // 3. Send webhook
      const result = await this.webhookDeliveryService.sendWebhook(config, payload);

      // 4. Update delivery status
      await this.webhookConfigService.updateDeliveryStatus(
        event.userId,
        result.success ? 'success' : 'failed',
        result.error ?? undefined
      );

      this.logger.debug(
        {
          eventType: event.type,
          userId: event.userId,
          success: result.success,
          durationMs: result.durationMs,
        },
        'Webhook delivered'
      );
    } catch (err) {
      // Try to update delivery status even on unexpected errors
      try {
        await this.webhookConfigService.updateDeliveryStatus(
          event.userId,
          'failed',
          err instanceof Error ? err.message : 'Unknown error'
        );
      } catch {
        // Ignore status update failure
      }

      log.methodError(this.logger, 'deliver', err as Error, {
        eventType: event.type,
        userId: event.userId,
      });
    }
  }

  // =============================================================================
  // PAYLOAD BUILDING
  // =============================================================================

  private async buildEnrichedPayload(event: NotificationEvent): Promise<WebhookDeliveryPayload> {
    // Fetch position for enrichment (best-effort)
    let position: UniswapV3Position | null = null;
    try {
      position = await this.positionService.findById(event.positionId);
    } catch {
      this.logger.warn({ positionId: event.positionId }, 'Failed to fetch position for webhook enrichment');
    }

    if (isRangeEvent(event)) {
      return this.buildRangePayload(event, position);
    }

    if (isExecutionSuccessEvent(event)) {
      return this.buildExecutionSuccessPayload(event, position);
    }

    if (isExecutionFailedEvent(event)) {
      return this.buildExecutionFailedPayload(event, position);
    }

    // Fallback (should never reach with current union type)
    return this.buildBasePayload(event, 'Notification', 'You have a new notification');
  }

  private buildBasePayload(
    event: NotificationEvent,
    title: string,
    message: string,
    extra: Record<string, unknown> = {}
  ): WebhookDeliveryPayload {
    return {
      eventId: `notif-${Date.now()}`,
      eventType: event.type,
      timestamp: event.timestamp.toISOString(),
      title,
      message,
      positionId: event.positionId,
      ...extra,
    };
  }

  private async buildRangePayload(
    event: NotificationEvent & { poolAddress: string; chainId: number; currentTick: number; currentSqrtPriceX96: string; tickLower: number; tickUpper: number },
    position: UniswapV3Position | null
  ): Promise<WebhookDeliveryPayload> {
    const isOutOfRange = event.type === 'POSITION_OUT_OF_RANGE';
    const extra: Record<string, unknown> = {
      poolAddress: event.poolAddress,
      chainId: event.chainId,
      currentTick: event.currentTick,
      currentSqrtPriceX96: event.currentSqrtPriceX96,
      tickLower: event.tickLower,
      tickUpper: event.tickUpper,
    };

    if (position) {
      const pool = position.pool as UniswapV3Pool;
      const quoteToken = getQuoteToken(position);
      const baseToken = getBaseToken(position);
      const quoteIsToken0 = position.isToken0Quote;
      const decimals0 = pool.token0.decimals;
      const decimals1 = pool.token1.decimals;

      const title = isOutOfRange ? 'Position Out of Range' : 'Position Back in Range';
      const message = isOutOfRange
        ? `Your ${baseToken.symbol}/${quoteToken.symbol} position is now out of range`
        : `Your ${baseToken.symbol}/${quoteToken.symbol} position is now back in range`;

      extra.quoteCurrency = quoteToken.symbol;
      extra.baseCurrency = baseToken.symbol;
      extra.currentPrice = formatSqrtPriceX96(event.currentSqrtPriceX96, decimals0, decimals1, quoteIsToken0);
      extra.priceLower = formatTickAsPrice(event.tickLower, decimals0, decimals1, quoteIsToken0);
      extra.priceUpper = formatTickAsPrice(event.tickUpper, decimals0, decimals1, quoteIsToken0);
      extra.currentPnl = formatAmount(position.unrealizedPnl, quoteToken.decimals);
      extra.position = serializePositionForWebhook(position);

      return this.buildBasePayload(event, title, message, extra);
    }

    const title = isOutOfRange ? 'Position Out of Range' : 'Position Back in Range';
    const message = isOutOfRange
      ? `Your position is now out of range. Current tick: ${event.currentTick}`
      : `Your position is now back in range. Current tick: ${event.currentTick}`;

    return this.buildBasePayload(event, title, message, extra);
  }

  private async buildExecutionSuccessPayload(
    event: NotificationEvent & { orderId: string; chainId: number; txHash: string; amount0Out: string; amount1Out: string; triggerSqrtPriceX96: string; executionSqrtPriceX96: string },
    position: UniswapV3Position | null
  ): Promise<WebhookDeliveryPayload> {
    const isStopLoss = event.type === 'STOP_LOSS_EXECUTED';
    const orderType = isStopLoss ? 'Stop Loss' : 'Take Profit';

    const extra: Record<string, unknown> = {
      orderId: event.orderId,
      chainId: event.chainId,
      txHash: event.txHash,
      amount0Out: event.amount0Out,
      amount1Out: event.amount1Out,
      triggerSide: isStopLoss ? 'lower' : 'upper',
      triggerSqrtPriceX96: event.triggerSqrtPriceX96,
      executionSqrtPriceX96: event.executionSqrtPriceX96,
    };

    // Fetch close order for enrichment
    let closeOrder = null;
    try {
      closeOrder = await this.onChainCloseOrderService.findById(event.orderId);
    } catch {
      // Enrichment failure is not critical
    }

    if (position) {
      const pool = position.pool as UniswapV3Pool;
      const quoteToken = getQuoteToken(position);
      const baseToken = getBaseToken(position);
      const quoteIsToken0 = position.isToken0Quote;
      const decimals0 = pool.token0.decimals;
      const decimals1 = pool.token1.decimals;

      const title = `${orderType} Executed`;
      const message = `${orderType} executed for your ${baseToken.symbol}/${quoteToken.symbol} position`;

      extra.quoteCurrency = quoteToken.symbol;
      extra.baseCurrency = baseToken.symbol;
      extra.triggerPrice = formatSqrtPriceX96(event.triggerSqrtPriceX96, decimals0, decimals1, quoteIsToken0);
      extra.executionPrice = formatSqrtPriceX96(event.executionSqrtPriceX96, decimals0, decimals1, quoteIsToken0);

      const amount0 = BigInt(event.amount0Out || '0');
      const amount1 = BigInt(event.amount1Out || '0');
      const quoteAmount = quoteIsToken0 ? amount0 : amount1;
      extra.amountOut = formatAmount(quoteAmount, quoteToken.decimals);
      extra.currentPnl = formatAmount(position.unrealizedPnl, quoteToken.decimals);
      extra.position = serializePositionForWebhook(position);

      if (closeOrder) {
        extra.closeOrder = serializeCloseOrderForWebhook(closeOrder);
      }

      return this.buildBasePayload(event, title, message, extra);
    }

    const title = `${orderType} Executed`;
    const message = `Your ${orderType.toLowerCase()} order was executed. Tx: ${event.txHash.slice(0, 10)}...`;

    if (closeOrder) {
      extra.closeOrder = serializeCloseOrderForWebhook(closeOrder);
    }

    return this.buildBasePayload(event, title, message, extra);
  }

  private async buildExecutionFailedPayload(
    event: NotificationEvent & { orderId: string; chainId: number; triggerSqrtPriceX96: string; error: string; retryCount: number },
    position: UniswapV3Position | null
  ): Promise<WebhookDeliveryPayload> {
    const isStopLoss = event.type === 'STOP_LOSS_FAILED';
    const orderType = isStopLoss ? 'Stop Loss' : 'Take Profit';

    const extra: Record<string, unknown> = {
      orderId: event.orderId,
      chainId: event.chainId,
      triggerSide: isStopLoss ? 'lower' : 'upper',
      triggerSqrtPriceX96: event.triggerSqrtPriceX96,
      error: event.error,
      retryCount: event.retryCount,
    };

    // Fetch close order for enrichment
    let closeOrder = null;
    try {
      closeOrder = await this.onChainCloseOrderService.findById(event.orderId);
    } catch {
      // Enrichment failure is not critical
    }

    if (position) {
      const pool = position.pool as UniswapV3Pool;
      const quoteToken = getQuoteToken(position);
      const baseToken = getBaseToken(position);
      const quoteIsToken0 = position.isToken0Quote;
      const decimals0 = pool.token0.decimals;
      const decimals1 = pool.token1.decimals;

      const title = `${orderType} Failed`;
      const message = `${orderType} failed for your ${baseToken.symbol}/${quoteToken.symbol} position: ${event.error}`;

      extra.quoteCurrency = quoteToken.symbol;
      extra.baseCurrency = baseToken.symbol;
      extra.triggerPrice = formatSqrtPriceX96(event.triggerSqrtPriceX96, decimals0, decimals1, quoteIsToken0);
      extra.position = serializePositionForWebhook(position);

      if (closeOrder) {
        extra.closeOrder = serializeCloseOrderForWebhook(closeOrder);
      }

      return this.buildBasePayload(event, title, message, extra);
    }

    const title = `${orderType} Failed`;
    const message = `Your ${orderType.toLowerCase()} order failed after ${event.retryCount} attempts: ${event.error}`;

    if (closeOrder) {
      extra.closeOrder = serializeCloseOrderForWebhook(closeOrder);
    }

    return this.buildBasePayload(event, title, message, extra);
  }
}
