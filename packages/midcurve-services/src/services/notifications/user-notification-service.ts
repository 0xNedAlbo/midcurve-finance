/**
 * User Notification Service
 *
 * Central service for dispatching user notifications. Provides one typed
 * method per event type. Routes events through registered adapters
 * (DB persistence, webhook delivery, etc.) using Promise.allSettled.
 *
 * All adapters are best-effort — failures are caught and logged,
 * never propagated to callers.
 */

import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { NotificationAdapter } from './adapters/notification-adapter.js';
import type {
  NotificationEvent,
  PositionOutOfRangeEvent,
  PositionInRangeEvent,
  StopLossExecutedEvent,
  StopLossFailedEvent,
  TakeProfitExecutedEvent,
  TakeProfitFailedEvent,
} from './events/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface UserNotificationServiceDependencies {
  adapters: NotificationAdapter[];
}

// =============================================================================
// PARAMETER TYPES
// =============================================================================

export interface NotifyRangeChangeParams {
  userId: string;
  positionId: string;
  poolId: string;
  poolAddress: string;
  chainId: number;
  currentTick: number;
  currentSqrtPriceX96: string;
  tickLower: number;
  tickUpper: number;
}

export interface NotifyExecutionSuccessParams {
  userId: string;
  positionId: string;
  orderId: string;
  chainId: number;
  txHash: string;
  amount0Out: string;
  amount1Out: string;
  triggerSqrtPriceX96: string;
  executionSqrtPriceX96: string;
}

export interface NotifyExecutionFailedParams {
  userId: string;
  positionId: string;
  orderId: string;
  chainId: number;
  triggerSqrtPriceX96: string;
  error: string;
  retryCount: number;
}

// =============================================================================
// SERVICE
// =============================================================================

export class UserNotificationService {
  private readonly adapters: NotificationAdapter[];
  private readonly logger: ServiceLogger;

  constructor(deps: UserNotificationServiceDependencies) {
    this.adapters = deps.adapters;
    this.logger = createServiceLogger('UserNotificationService');
  }

  // ===========================================================================
  // RANGE EVENTS
  // ===========================================================================

  async notifyPositionOutOfRange(params: NotifyRangeChangeParams): Promise<void> {
    const event: PositionOutOfRangeEvent = {
      type: 'POSITION_OUT_OF_RANGE',
      timestamp: new Date(),
      ...params,
    };
    await this.dispatch(event);
  }

  async notifyPositionInRange(params: NotifyRangeChangeParams): Promise<void> {
    const event: PositionInRangeEvent = {
      type: 'POSITION_IN_RANGE',
      timestamp: new Date(),
      ...params,
    };
    await this.dispatch(event);
  }

  // ===========================================================================
  // EXECUTION EVENTS
  // ===========================================================================

  async notifyStopLossExecuted(params: NotifyExecutionSuccessParams): Promise<void> {
    const event: StopLossExecutedEvent = {
      type: 'STOP_LOSS_EXECUTED',
      timestamp: new Date(),
      ...params,
    };
    await this.dispatch(event);
  }

  async notifyStopLossFailed(params: NotifyExecutionFailedParams): Promise<void> {
    const event: StopLossFailedEvent = {
      type: 'STOP_LOSS_FAILED',
      timestamp: new Date(),
      ...params,
    };
    await this.dispatch(event);
  }

  async notifyTakeProfitExecuted(params: NotifyExecutionSuccessParams): Promise<void> {
    const event: TakeProfitExecutedEvent = {
      type: 'TAKE_PROFIT_EXECUTED',
      timestamp: new Date(),
      ...params,
    };
    await this.dispatch(event);
  }

  async notifyTakeProfitFailed(params: NotifyExecutionFailedParams): Promise<void> {
    const event: TakeProfitFailedEvent = {
      type: 'TAKE_PROFIT_FAILED',
      timestamp: new Date(),
      ...params,
    };
    await this.dispatch(event);
  }

  // ===========================================================================
  // DISPATCH
  // ===========================================================================

  /**
   * Dispatch event to all registered adapters.
   * Uses Promise.allSettled so one failing adapter never blocks another.
   */
  private async dispatch(event: NotificationEvent): Promise<void> {
    this.logger.info(
      { eventType: event.type, userId: event.userId, positionId: event.positionId },
      'Dispatching notification'
    );

    const results = await Promise.allSettled(
      this.adapters.map(adapter => adapter.deliver(event))
    );

    // Defense-in-depth: adapters should never throw, but log if they do
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'rejected') {
        this.logger.error(
          {
            adapter: this.adapters[i]?.name,
            error: result.reason,
            eventType: event.type,
            userId: event.userId,
          },
          'Adapter threw despite best-effort contract'
        );
      }
    }
  }
}
