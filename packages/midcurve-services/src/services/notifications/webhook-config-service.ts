/**
 * Webhook Configuration Service
 *
 * Manages user webhook delivery preferences including
 * URL configuration, event filtering, and secret management.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { Prisma, UserWebhookConfig } from '@midcurve/database';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { UpdateWebhookConfigInput } from '../types/notifications/index.js';
import type { NotificationEventType } from '@midcurve/api-shared';

// =============================================================================
// SERVICE
// =============================================================================

/**
 * Dependencies for WebhookConfigService
 */
export interface WebhookConfigServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Webhook Configuration Service
 *
 * Handles webhook configuration operations including:
 * - Getting/updating user webhook settings
 * - Checking if specific events are enabled
 * - Managing webhook secrets
 */
export class WebhookConfigService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new WebhookConfigService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: WebhookConfigServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('WebhookConfigService');
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  /**
   * Gets webhook configuration for a user
   *
   * @param userId - User ID
   * @returns The webhook config or null if not configured
   */
  async getByUserId(userId: string): Promise<UserWebhookConfig | null> {
    log.methodEntry(this.logger, 'getByUserId', { userId });

    try {
      const result = await this.prisma.userWebhookConfig.findUnique({
        where: { userId },
      });

      log.methodExit(this.logger, 'getByUserId', { found: !!result });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'getByUserId', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Creates or updates webhook configuration for a user
   *
   * @param userId - User ID
   * @param input - Configuration update input
   * @returns The updated webhook config
   */
  async upsert(
    userId: string,
    input: UpdateWebhookConfigInput
  ): Promise<UserWebhookConfig> {
    log.methodEntry(this.logger, 'upsert', {
      userId,
      hasUrl: !!input.webhookUrl,
      isActive: input.isActive,
      eventCount: input.enabledEvents?.length,
    });

    try {
      // Build the data object for upsert
      const data: Prisma.UserWebhookConfigUpdateInput = {};

      if (input.webhookUrl !== undefined) {
        data.webhookUrl = input.webhookUrl;
      }

      if (input.isActive !== undefined) {
        data.isActive = input.isActive;
      }

      if (input.enabledEvents !== undefined) {
        data.enabledEvents = input.enabledEvents as unknown as Prisma.InputJsonValue;
      }

      if (input.webhookSecret !== undefined) {
        data.webhookSecret = input.webhookSecret;
      }

      const result = await this.prisma.userWebhookConfig.upsert({
        where: { userId },
        create: {
          userId,
          webhookUrl: input.webhookUrl ?? null,
          isActive: input.isActive ?? false,
          enabledEvents: (input.enabledEvents ?? []) as unknown as Prisma.InputJsonValue,
          webhookSecret: input.webhookSecret ?? null,
        },
        update: data,
      });

      this.logger.debug(
        {
          userId: result.userId,
          isActive: result.isActive,
          hasUrl: !!result.webhookUrl,
        },
        'Webhook config updated'
      );

      log.methodExit(this.logger, 'upsert', { userId: result.userId });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'upsert', error as Error, { userId, input });
      throw error;
    }
  }

  /**
   * Deletes webhook configuration for a user
   *
   * @param userId - User ID
   */
  async delete(userId: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { userId });

    try {
      await this.prisma.userWebhookConfig.delete({
        where: { userId },
      });

      log.methodExit(this.logger, 'delete', { userId });
    } catch (error) {
      // Ignore "Record not found" errors
      if (
        error instanceof Error &&
        error.message.includes('Record to delete does not exist')
      ) {
        log.methodExit(this.logger, 'delete', { userId, notFound: true });
        return;
      }
      log.methodError(this.logger, 'delete', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Checks if a specific event type is enabled for a user's webhook
   *
   * @param userId - User ID
   * @param eventType - Event type to check
   * @returns True if the event is enabled and webhook is active
   */
  async isEventEnabled(
    userId: string,
    eventType: NotificationEventType
  ): Promise<boolean> {
    log.methodEntry(this.logger, 'isEventEnabled', { userId, eventType });

    try {
      const config = await this.prisma.userWebhookConfig.findUnique({
        where: { userId },
        select: {
          isActive: true,
          webhookUrl: true,
          enabledEvents: true,
        },
      });

      if (!config || !config.isActive || !config.webhookUrl) {
        log.methodExit(this.logger, 'isEventEnabled', { enabled: false, reason: 'not configured' });
        return false;
      }

      const enabledEvents = config.enabledEvents as NotificationEventType[];
      const enabled = enabledEvents.includes(eventType);

      log.methodExit(this.logger, 'isEventEnabled', { enabled });
      return enabled;
    } catch (error) {
      log.methodError(this.logger, 'isEventEnabled', error as Error, { userId, eventType });
      throw error;
    }
  }

  /**
   * Updates the last delivery status for a webhook
   *
   * @param userId - User ID
   * @param status - Delivery status ('success' | 'failed')
   * @param error - Error message if failed
   */
  async updateDeliveryStatus(
    userId: string,
    status: 'success' | 'failed',
    error?: string
  ): Promise<void> {
    log.methodEntry(this.logger, 'updateDeliveryStatus', { userId, status });

    try {
      await this.prisma.userWebhookConfig.update({
        where: { userId },
        data: {
          lastDeliveryAt: new Date(),
          lastDeliveryStatus: status,
          lastDeliveryError: error ?? null,
        },
      });

      log.methodExit(this.logger, 'updateDeliveryStatus', { userId, status });
    } catch (error) {
      log.methodError(this.logger, 'updateDeliveryStatus', error as Error, { userId, status });
      throw error;
    }
  }
}
