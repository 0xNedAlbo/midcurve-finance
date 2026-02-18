/**
 * UI Notification Adapter
 *
 * Persists notifications to the UserNotification table for the UI inbox.
 * Handles enrichment by fetching position data for token symbols,
 * and generates human-readable title/message via the notification formatter.
 *
 * Best-effort: all errors are caught and logged, never thrown.
 */

import { prisma, type Prisma } from '@midcurve/database';
import { getQuoteToken, getBaseToken } from '@midcurve/shared';
import type { NotificationPayload } from '@midcurve/api-shared';
import { createServiceLogger, log } from '../../../logging/index.js';
import type { ServiceLogger } from '../../../logging/index.js';
import type { NotificationAdapter } from './notification-adapter.js';
import type { NotificationEvent } from '../events/index.js';
import { isRangeEvent, isExecutionSuccessEvent } from '../events/index.js';
import { formatNotification, type TokenSymbols } from '../formatters/index.js';
import type { UniswapV3PositionService } from '../../position/uniswapv3-position-service.js';

// =============================================================================
// TYPES
// =============================================================================

export interface UiNotificationAdapterDependencies {
  positionService: UniswapV3PositionService;
}

// =============================================================================
// ADAPTER
// =============================================================================

export class UiNotificationAdapter implements NotificationAdapter {
  readonly name = 'UiNotificationAdapter';
  private readonly logger: ServiceLogger;
  private readonly positionService: UniswapV3PositionService;

  constructor(deps: UiNotificationAdapterDependencies) {
    this.logger = createServiceLogger('UiNotificationAdapter');
    this.positionService = deps.positionService;
  }

  async deliver(event: NotificationEvent): Promise<void> {
    try {
      // Best-effort: fetch position for token symbols
      let tokenSymbols: TokenSymbols | null = null;
      try {
        const position = await this.positionService.findById(event.positionId);
        if (position) {
          tokenSymbols = {
            base: getBaseToken(position).symbol,
            quote: getQuoteToken(position).symbol,
          };
        }
      } catch {
        // Enrichment failure is not critical
      }

      const { title, message } = formatNotification(event, tokenSymbols);
      const payload = buildDbPayload(event);

      await prisma.userNotification.create({
        data: {
          userId: event.userId,
          eventType: event.type,
          positionId: event.positionId ?? null,
          title,
          message,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.debug(
        { eventType: event.type, userId: event.userId, positionId: event.positionId },
        'Notification persisted'
      );
    } catch (err) {
      log.methodError(this.logger, 'deliver', err as Error, {
        eventType: event.type,
        userId: event.userId,
      });
    }
  }
}

// =============================================================================
// PAYLOAD BUILDERS
// =============================================================================

/**
 * Build a payload object from the slim event for DB storage.
 * Matches the existing NotificationPayload structure from @midcurve/api-shared.
 */
function buildDbPayload(event: NotificationEvent): NotificationPayload {
  if (isRangeEvent(event)) {
    return {
      poolAddress: event.poolAddress,
      chainId: event.chainId,
      currentSqrtPriceX96: event.currentSqrtPriceX96,
      currentTick: event.currentTick,
      tickLower: event.tickLower,
      tickUpper: event.tickUpper,
    };
  }

  if (isExecutionSuccessEvent(event)) {
    return {
      txHash: event.txHash,
      chainId: event.chainId,
      amount0Out: event.amount0Out,
      amount1Out: event.amount1Out,
      triggerSide: event.type === 'STOP_LOSS_EXECUTED' ? 'lower' : 'upper',
      triggerSqrtPriceX96: event.triggerSqrtPriceX96,
      executionSqrtPriceX96: event.executionSqrtPriceX96,
    };
  }

  // isExecutionFailedEvent — the only remaining case
  return {
    error: event.error,
    chainId: event.chainId,
    retryCount: event.retryCount,
    triggerSide: event.type === 'STOP_LOSS_FAILED' ? 'lower' as const : 'upper' as const,
    triggerSqrtPriceX96: event.triggerSqrtPriceX96,
  };
}
