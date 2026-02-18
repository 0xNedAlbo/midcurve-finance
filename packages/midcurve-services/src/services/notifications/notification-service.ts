/**
 * Notification Service
 *
 * Provides CRUD operations for user notifications.
 * Handles creation, listing, marking as read, and deletion of notifications.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { Prisma, UserNotification } from '@midcurve/database';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type {
  CreateNotificationInput,
  ListNotificationsOptions,
} from '../types/notifications/index.js';


// =============================================================================
// SERVICE
// =============================================================================

/**
 * Dependencies for NotificationService
 */
export interface NotificationServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Result type for list operations
 */
export interface ListNotificationsResult {
  notifications: UserNotification[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Notification Service
 *
 * Handles notification-related database operations including:
 * - Creating notifications for various event types
 * - Listing notifications with cursor-based pagination
 * - Marking notifications as read
 * - Deleting notifications
 */
export class NotificationService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new NotificationService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: NotificationServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('NotificationService');
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  /**
   * Creates a new notification
   *
   * @param input - Notification creation input
   * @returns The created notification
   */
  async create(input: CreateNotificationInput): Promise<UserNotification> {
    log.methodEntry(this.logger, 'create', {
      userId: input.userId,
      eventType: input.eventType,
      positionId: input.positionId,
    });

    try {
      const result = await this.prisma.userNotification.create({
        data: {
          userId: input.userId,
          eventType: input.eventType,
          positionId: input.positionId ?? null,
          title: input.title,
          message: input.message,
          payload: input.payload as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.debug(
        {
          id: result.id,
          userId: result.userId,
          eventType: result.eventType,
        },
        'Notification created'
      );

      log.methodExit(this.logger, 'create', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, { input });
      throw error;
    }
  }

  /**
   * Gets a notification by ID
   *
   * @param id - Notification ID
   * @returns The notification or null if not found
   */
  async findById(id: string): Promise<UserNotification | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      const result = await this.prisma.userNotification.findUnique({
        where: { id },
      });

      log.methodExit(this.logger, 'findById', { found: !!result });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Lists notifications for a user with cursor-based pagination
   *
   * @param userId - User ID to list notifications for
   * @param options - Query options
   * @returns Paginated notification results
   */
  async listByUser(
    userId: string,
    options: ListNotificationsOptions = {}
  ): Promise<ListNotificationsResult> {
    const { eventType, isRead, limit = 10, cursor } = options;

    log.methodEntry(this.logger, 'listByUser', {
      userId,
      eventType,
      isRead,
      limit,
      cursor,
    });

    try {
      // Build where clause
      const where: Prisma.UserNotificationWhereInput = {
        userId,
      };

      if (eventType !== undefined) {
        where.eventType = eventType;
      }

      if (isRead !== undefined) {
        where.isRead = isRead;
      }

      // For cursor-based pagination, filter by createdAt < cursor's createdAt
      if (cursor) {
        const cursorNotification = await this.prisma.userNotification.findUnique({
          where: { id: cursor },
          select: { createdAt: true },
        });
        if (cursorNotification) {
          where.createdAt = { lt: cursorNotification.createdAt };
        }
      }

      // Fetch limit + 1 to determine if there are more results
      const notifications = await this.prisma.userNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });

      // Determine if there are more results
      const hasMore = notifications.length > limit;
      if (hasMore) {
        notifications.pop(); // Remove the extra item
      }

      // Get next cursor
      const lastNotification = notifications[notifications.length - 1];
      const nextCursor = hasMore && lastNotification ? lastNotification.id : null;

      log.methodExit(this.logger, 'listByUser', {
        count: notifications.length,
        hasMore,
      });

      return {
        notifications,
        nextCursor,
        hasMore,
      };
    } catch (error) {
      log.methodError(this.logger, 'listByUser', error as Error, {
        userId,
        options,
      });
      throw error;
    }
  }

  /**
   * Gets the count of unread notifications for a user
   *
   * @param userId - User ID
   * @returns Number of unread notifications
   */
  async getUnreadCount(userId: string): Promise<number> {
    log.methodEntry(this.logger, 'getUnreadCount', { userId });

    try {
      const count = await this.prisma.userNotification.count({
        where: {
          userId,
          isRead: false,
        },
      });

      log.methodExit(this.logger, 'getUnreadCount', { count });
      return count;
    } catch (error) {
      log.methodError(this.logger, 'getUnreadCount', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Marks a notification as read
   *
   * @param id - Notification ID
   * @returns The updated notification
   */
  async markAsRead(id: string): Promise<UserNotification> {
    log.methodEntry(this.logger, 'markAsRead', { id });

    try {
      const result = await this.prisma.userNotification.update({
        where: { id },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      log.methodExit(this.logger, 'markAsRead', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markAsRead', error as Error, { id });
      throw error;
    }
  }

  /**
   * Marks all notifications as read for a user
   *
   * @param userId - User ID
   * @returns Number of notifications updated
   */
  async markAllAsRead(userId: string): Promise<number> {
    log.methodEntry(this.logger, 'markAllAsRead', { userId });

    try {
      const result = await this.prisma.userNotification.updateMany({
        where: {
          userId,
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      log.methodExit(this.logger, 'markAllAsRead', { count: result.count });
      return result.count;
    } catch (error) {
      log.methodError(this.logger, 'markAllAsRead', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Deletes a notification
   *
   * @param id - Notification ID
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      await this.prisma.userNotification.delete({
        where: { id },
      });

      log.methodExit(this.logger, 'delete', { id });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }

  /**
   * Bulk deletes notifications
   *
   * @param ids - Array of notification IDs
   * @returns Number of notifications deleted
   */
  async bulkDelete(ids: string[]): Promise<number> {
    log.methodEntry(this.logger, 'bulkDelete', { count: ids.length });

    try {
      const result = await this.prisma.userNotification.deleteMany({
        where: {
          id: { in: ids },
        },
      });

      log.methodExit(this.logger, 'bulkDelete', { deletedCount: result.count });
      return result.count;
    } catch (error) {
      log.methodError(this.logger, 'bulkDelete', error as Error, { ids });
      throw error;
    }
  }

}
