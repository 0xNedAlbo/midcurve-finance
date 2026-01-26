/**
 * Webhook Delivery Service
 *
 * Handles sending webhook notifications to user-configured endpoints.
 * Implements fire-and-forget delivery with secret header authentication.
 */

import { PrismaClient } from '@midcurve/database';
import type { UserNotification, UserWebhookConfig } from '@midcurve/database';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type {
  NotificationEventType,
  WebhookDeliveryPayload,
} from '@midcurve/api-shared';
import { WebhookConfigService } from './webhook-config-service.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of a webhook delivery attempt
 */
export interface WebhookDeliveryResult {
  success: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
}

/**
 * Dependencies for WebhookDeliveryService
 */
export interface WebhookDeliveryServiceDependencies {
  /**
   * Prisma client for database operations
   */
  prisma?: PrismaClient;

  /**
   * Webhook config service instance
   */
  webhookConfigService?: WebhookConfigService;

  /**
   * Timeout for webhook requests in milliseconds
   * @default 10000 (10 seconds)
   */
  timeoutMs?: number;
}

// =============================================================================
// SERVICE
// =============================================================================

/**
 * Webhook Delivery Service
 *
 * Handles webhook delivery including:
 * - Building standardized payloads
 * - Sending HTTP POST requests with secret header
 * - Tracking delivery status
 */
export class WebhookDeliveryService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;
  private readonly webhookConfigService: WebhookConfigService;
  private readonly timeoutMs: number;

  /**
   * Creates a new WebhookDeliveryService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: WebhookDeliveryServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('WebhookDeliveryService');
    this.webhookConfigService =
      dependencies.webhookConfigService ?? new WebhookConfigService({ prisma: this.prisma });
    this.timeoutMs = dependencies.timeoutMs ?? 10000;
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  /**
   * Delivers a webhook notification to the user's configured endpoint
   *
   * This is a fire-and-forget operation - it will not throw errors
   * but will log failures and update delivery status.
   *
   * @param userId - User ID
   * @param notification - The notification to deliver
   * @returns Delivery result
   */
  async deliverWebhook(
    userId: string,
    notification: UserNotification
  ): Promise<WebhookDeliveryResult> {
    const startTime = Date.now();
    log.methodEntry(this.logger, 'deliverWebhook', {
      userId,
      notificationId: notification.id,
      eventType: notification.eventType,
    });

    try {
      // Get webhook config
      const config = await this.webhookConfigService.getByUserId(userId);

      if (!config || !config.isActive || !config.webhookUrl) {
        const result: WebhookDeliveryResult = {
          success: false,
          statusCode: null,
          error: 'Webhook not configured or not active',
          durationMs: Date.now() - startTime,
        };
        log.methodExit(this.logger, 'deliverWebhook', { ...result });
        return result;
      }

      // Check if event type is enabled
      const enabledEvents = config.enabledEvents as NotificationEventType[];
      if (!enabledEvents.includes(notification.eventType as NotificationEventType)) {
        const result: WebhookDeliveryResult = {
          success: false,
          statusCode: null,
          error: `Event type ${notification.eventType} not enabled`,
          durationMs: Date.now() - startTime,
        };
        log.methodExit(this.logger, 'deliverWebhook', { ...result });
        return result;
      }

      // Build payload
      const payload = this.buildPayload(notification);

      // Send webhook
      const result = await this.sendWebhook(config, payload);

      // Update delivery status
      await this.webhookConfigService.updateDeliveryStatus(
        userId,
        result.success ? 'success' : 'failed',
        result.error ?? undefined
      );

      log.methodExit(this.logger, 'deliverWebhook', { ...result });
      return result;
    } catch (error) {
      const result: WebhookDeliveryResult = {
        success: false,
        statusCode: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };

      // Try to update delivery status (don't throw if this fails)
      try {
        await this.webhookConfigService.updateDeliveryStatus(userId, 'failed', result.error ?? undefined);
      } catch {
        this.logger.warn({ userId }, 'Failed to update delivery status after error');
      }

      log.methodError(this.logger, 'deliverWebhook', error as Error, {
        userId,
        notificationId: notification.id,
      });
      return result;
    }
  }

  /**
   * Sends a test webhook to verify configuration
   *
   * @param userId - User ID
   * @param eventType - Event type to test (defaults to POSITION_OUT_OF_RANGE)
   * @returns Delivery result
   */
  async sendTestWebhook(
    userId: string,
    eventType: NotificationEventType = 'POSITION_OUT_OF_RANGE'
  ): Promise<WebhookDeliveryResult> {
    const startTime = Date.now();
    log.methodEntry(this.logger, 'sendTestWebhook', { userId, eventType });

    try {
      const config = await this.webhookConfigService.getByUserId(userId);

      if (!config || !config.webhookUrl) {
        const result: WebhookDeliveryResult = {
          success: false,
          statusCode: null,
          error: 'Webhook URL not configured',
          durationMs: Date.now() - startTime,
        };
        log.methodExit(this.logger, 'sendTestWebhook', { ...result });
        return result;
      }

      // Build full test payload matching documentation
      const payload = this.buildTestPayload(eventType);

      const result = await this.sendWebhook(config, payload);

      // Update delivery status
      await this.webhookConfigService.updateDeliveryStatus(
        userId,
        result.success ? 'success' : 'failed',
        result.error ?? undefined
      );

      log.methodExit(this.logger, 'sendTestWebhook', { ...result });
      return result;
    } catch (error) {
      const result: WebhookDeliveryResult = {
        success: false,
        statusCode: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };
      log.methodError(this.logger, 'sendTestWebhook', error as Error, { userId });
      return result;
    }
  }

  // ============================================================================
  // INTERNAL METHODS
  // ============================================================================

  /**
   * Builds a webhook payload from a notification
   */
  private buildPayload(notification: UserNotification): WebhookDeliveryPayload {
    // Spread event-specific payload fields at root level (not nested in data)
    const payload = notification.payload as Record<string, unknown>;
    return {
      eventId: notification.id,
      eventType: notification.eventType as NotificationEventType,
      timestamp: notification.createdAt.toISOString(),
      title: notification.title,
      message: notification.message,
      positionId: notification.positionId,
      ...payload,
    };
  }

  /**
   * Builds a full test payload matching documentation for a given event type
   */
  private buildTestPayload(eventType: NotificationEventType): WebhookDeliveryPayload {
    const timestamp = new Date().toISOString();
    const eventId = `test-${Date.now()}`;
    const positionId = 'pos_12345';

    // Example position data matching documentation
    const examplePosition = {
      id: positionId,
      createdAt: '2024-01-10T08:00:00.000Z',
      updatedAt: timestamp,
      positionHash: 'uniswapv3/1/123456',
      protocol: 'uniswapv3',
      positionType: 'CL_TICKS',
      userId: 'user_abc123',
      currentValue: '15030440000',
      currentCostBasis: '10000000000',
      realizedPnl: '0',
      unrealizedPnl: '5030440000',
      realizedCashflow: '0',
      unrealizedCashflow: '0',
      collectedFees: '500000000',
      unClaimedFees: '150000000',
      lastFeesCollectedAt: '2024-01-14T12:00:00.000Z',
      totalApr: 45.23,
      priceRangeLower: '2600450000',
      priceRangeUpper: '3000450000',
      isToken0Quote: true,
      positionOpenedAt: '2024-01-10T08:00:00.000Z',
      positionClosedAt: null,
      isActive: true,
      pool: {
        id: 'pool_xyz789',
        protocol: 'uniswapv3',
        token0: {
          id: 'token_usdc',
          tokenType: 'evm-erc20',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          config: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1 },
        },
        token1: {
          id: 'token_weth',
          tokenType: 'evm-erc20',
          symbol: 'WETH',
          name: 'Wrapped Ether',
          decimals: 18,
          config: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chainId: 1 },
        },
        config: {
          chainId: 1,
          poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
          feeTier: 3000,
          tickSpacing: 60,
        },
        state: {
          sqrtPriceX96: '1234567890123456789012345678',
          liquidity: '12345678901234567890',
          currentTick: -201234,
        },
      },
      config: {
        chainId: 1,
        nftId: '123456',
        poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        tickLower: -202000,
        tickUpper: -200000,
      },
      state: {
        ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
        liquidity: '9876543210987654321',
        feeGrowthInside0LastX128: '12345678901234567890',
        feeGrowthInside1LastX128: '98765432109876543210',
        tokensOwed0: '500000',
        tokensOwed1: '100000000000000000',
      },
    };

    // Example close order data for SL/TP events
    const exampleCloseOrder = (status: 'executed' | 'failed', triggerMode: 'LOWER' | 'UPPER', error?: string) => ({
      id: 'clord_abc123def456',
      closeOrderType: 'uniswapv3',
      status,
      positionId,
      automationContractConfig: {
        chainId: 1,
        contractAddress: '0xAutomation1234567890abcdef1234567890abcdef',
        positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
      },
      config: {
        closeId: 42,
        nftId: '123456',
        poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        triggerMode,
        sqrtPriceX96Lower: '1234567890123456789012345678',
        sqrtPriceX96Upper: '9876543210987654321098765432',
        payoutAddress: '0x1234567890abcdef1234567890abcdef12345678',
        operatorAddress: '0xOperator1234567890abcdef1234567890abcdef',
        validUntil: '2024-02-15T00:00:00.000Z',
        slippageBps: 50,
        swapConfig: {
          enabled: true,
          direction: 'TOKEN0_TO_1',
          slippageBps: 100,
        },
      },
      state: {
        registrationTxHash: '0xreg1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        registeredAt: '2024-01-10T09:00:00.000Z',
        triggeredAt: timestamp,
        triggerSqrtPriceX96: '1234567890123456789012345678',
        executionTxHash: status === 'executed' ? '0xexec1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' : null,
        executedAt: status === 'executed' ? timestamp : null,
        executionFeeBps: status === 'executed' ? 10 : null,
        executionError: error ?? null,
        retryCount: status === 'failed' ? 3 : 0,
        amount0Out: status === 'executed' ? '15030440000' : null,
        amount1Out: status === 'executed' ? '0' : null,
        swapExecution: status === 'executed' ? {
          swapExecuted: true,
          swapDirection: 'TOKEN0_TO_1',
          srcToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          destToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          srcAmount: '5000000000000000000',
          destAmount: '15030440000',
          minDestAmount: '14880000000',
          augustusAddress: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
          swapSlippageBps: 100,
        } : undefined,
      },
      createdAt: '2024-01-10T08:00:00.000Z',
      updatedAt: timestamp,
    });

    // Build event-specific payload with fields at root level (not nested in data)
    const payloads: Record<NotificationEventType, WebhookDeliveryPayload> = {
      POSITION_OUT_OF_RANGE: {
        eventId,
        eventType: 'POSITION_OUT_OF_RANGE',
        timestamp,
        title: 'Position Out of Range',
        message: 'Your ETH/USDC position #12345 is now out of range',
        positionId,
        quoteCurrency: 'USDC',
        baseCurrency: 'WETH',
        priceUpper: '3,000.45',
        priceLower: '2,600.45',
        currentPrice: '3,100.45',
        currentPnl: '5,680.44',
        position: examplePosition,
      },
      POSITION_IN_RANGE: {
        eventId,
        eventType: 'POSITION_IN_RANGE',
        timestamp,
        title: 'Position In Range',
        message: 'Your ETH/USDC position #12345 is back in range',
        positionId,
        quoteCurrency: 'USDC',
        baseCurrency: 'WETH',
        priceUpper: '3,000.45',
        priceLower: '2,600.45',
        currentPrice: '2,850.00',
        currentPnl: '5,680.44',
        position: examplePosition,
      },
      STOP_LOSS_EXECUTED: {
        eventId,
        eventType: 'STOP_LOSS_EXECUTED',
        timestamp,
        title: 'Stop Loss Executed',
        message: 'Stop loss executed for your ETH/USDC position #12345',
        positionId,
        quoteCurrency: 'USDC',
        baseCurrency: 'WETH',
        triggerPrice: '2,600.45',
        executionPrice: '2,598.20',
        amountOut: '15,030.44',
        currentPnl: '5,680.44',
        txHash: '0xexec1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        position: examplePosition,
        closeOrder: exampleCloseOrder('executed', 'LOWER'),
      },
      STOP_LOSS_FAILED: {
        eventId,
        eventType: 'STOP_LOSS_FAILED',
        timestamp,
        title: 'Stop Loss Failed',
        message: 'Stop loss failed for your ETH/USDC position #12345',
        positionId,
        quoteCurrency: 'USDC',
        baseCurrency: 'WETH',
        triggerPrice: '2,600.45',
        error: 'Slippage tolerance exceeded',
        retryCount: 3,
        position: examplePosition,
        closeOrder: exampleCloseOrder('failed', 'LOWER', 'Slippage tolerance exceeded'),
      },
      TAKE_PROFIT_EXECUTED: {
        eventId,
        eventType: 'TAKE_PROFIT_EXECUTED',
        timestamp,
        title: 'Take Profit Executed',
        message: 'Take profit executed for your ETH/USDC position #12345',
        positionId,
        quoteCurrency: 'USDC',
        baseCurrency: 'WETH',
        triggerPrice: '3,000.45',
        executionPrice: '3,002.10',
        amountOut: '18,250.00',
        currentPnl: '8,250.00',
        txHash: '0xexec1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        position: examplePosition,
        closeOrder: exampleCloseOrder('executed', 'UPPER'),
      },
      TAKE_PROFIT_FAILED: {
        eventId,
        eventType: 'TAKE_PROFIT_FAILED',
        timestamp,
        title: 'Take Profit Failed',
        message: 'Take profit failed for your ETH/USDC position #12345',
        positionId,
        quoteCurrency: 'USDC',
        baseCurrency: 'WETH',
        triggerPrice: '3,000.45',
        error: 'Insufficient gas',
        retryCount: 2,
        position: examplePosition,
        closeOrder: exampleCloseOrder('failed', 'UPPER', 'Insufficient gas'),
      },
    };

    return payloads[eventType];
  }

  /**
   * Sends a webhook HTTP POST request
   */
  private async sendWebhook(
    config: UserWebhookConfig,
    payload: WebhookDeliveryPayload
  ): Promise<WebhookDeliveryResult> {
    const startTime = Date.now();

    if (!config.webhookUrl) {
      return {
        success: false,
        statusCode: null,
        error: 'No webhook URL configured',
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Midcurve-Webhook/1.0',
      };

      // Add secret header if configured
      if (config.webhookSecret) {
        headers['X-Webhook-Secret'] = config.webhookSecret;
      }

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(config.webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const success = response.ok;
        const result: WebhookDeliveryResult = {
          success,
          statusCode: response.status,
          error: success ? null : `HTTP ${response.status}: ${response.statusText}`,
          durationMs: Date.now() - startTime,
        };

        this.logger.debug(
          {
            url: config.webhookUrl,
            statusCode: response.status,
            success,
            durationMs: result.durationMs,
          },
          'Webhook sent'
        );

        return result;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      let errorMessage: string;

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = `Request timeout (${this.timeoutMs}ms)`;
        } else {
          errorMessage = error.message;
        }
      } else {
        errorMessage = 'Unknown error';
      }

      return {
        success: false,
        statusCode: null,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
