/**
 * Notification Worker
 *
 * RabbitMQ consumer that processes notification events.
 * Creates notification records in database and sends webhooks.
 */

import type { UserNotification } from '@midcurve/database';
import type { NotificationEventType, NotificationPayload } from '@midcurve/api-shared';
import {
  getNotificationService,
  getWebhookDeliveryService,
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

    // Determine notification content based on event type
    const { title, notificationMessage, payload } = this.buildNotificationContent(message);

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
  private buildNotificationContent(message: NotificationMessage): {
    title: string;
    notificationMessage: string;
    payload: Record<string, unknown>;
  } {
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
  private buildRangeChangeContent(message: RangeChangeNotificationMessage): {
    title: string;
    notificationMessage: string;
    payload: Record<string, unknown>;
  } {
    const isOutOfRange = message.eventType === 'POSITION_OUT_OF_RANGE';

    const title = isOutOfRange ? 'Position Out of Range' : 'Position Back in Range';

    const notificationMessage = isOutOfRange
      ? `Your position is now out of range. Current tick: ${message.currentTick}, Range: [${message.tickLower}, ${message.tickUpper}]`
      : `Your position is now back in range. Current tick: ${message.currentTick}, Range: [${message.tickLower}, ${message.tickUpper}]`;

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

    return { title, notificationMessage, payload };
  }

  /**
   * Build content for execution result notifications
   */
  private buildExecutionResultContent(message: ExecutionResultNotificationMessage): {
    title: string;
    notificationMessage: string;
    payload: Record<string, unknown>;
  } {
    let title: string;
    let notificationMessage: string;

    const isStopLoss = message.triggerSide === 'lower';
    const orderType = isStopLoss ? 'Stop Loss' : 'Take Profit';

    switch (message.eventType) {
      case 'STOP_LOSS_EXECUTED':
      case 'TAKE_PROFIT_EXECUTED':
        title = `${orderType} Executed`;
        notificationMessage = `Your ${orderType.toLowerCase()} order has been successfully executed.`;
        if (message.txHash) {
          notificationMessage += ` Transaction: ${message.txHash.slice(0, 10)}...`;
        }
        break;

      case 'STOP_LOSS_FAILED':
      case 'TAKE_PROFIT_FAILED':
        title = `${orderType} Failed`;
        notificationMessage = `Your ${orderType.toLowerCase()} order failed to execute.`;
        if (message.error) {
          notificationMessage += ` Error: ${message.error}`;
        }
        break;
    }

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
