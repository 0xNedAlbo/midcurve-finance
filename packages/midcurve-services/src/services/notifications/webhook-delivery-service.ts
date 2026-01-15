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
   * @returns Delivery result
   */
  async sendTestWebhook(userId: string): Promise<WebhookDeliveryResult> {
    const startTime = Date.now();
    log.methodEntry(this.logger, 'sendTestWebhook', { userId });

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

      // Build test payload
      const payload: WebhookDeliveryPayload = {
        eventId: `test-${Date.now()}`,
        eventType: 'POSITION_OUT_OF_RANGE',
        timestamp: new Date().toISOString(),
        title: 'Test Webhook',
        message: 'This is a test webhook from Midcurve Finance',
        positionId: null,
        data: {
          test: true,
        },
      };

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
    return {
      eventId: notification.id,
      eventType: notification.eventType as NotificationEventType,
      timestamp: notification.createdAt.toISOString(),
      title: notification.title,
      message: notification.message,
      positionId: notification.positionId,
      data: notification.payload as Record<string, unknown>,
    };
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
