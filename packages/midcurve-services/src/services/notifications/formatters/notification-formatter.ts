/**
 * Notification Formatter
 *
 * Pure functions for generating notification title and message text.
 * Used by the UiNotificationAdapter to produce human-readable content
 * for storage and UI display.
 */

import type { NotificationEvent } from '../events/index.js';

/**
 * Token symbol pair for formatting
 */
export interface TokenSymbols {
  base: string;
  quote: string;
}

/**
 * Formatted notification content
 */
export interface FormattedNotification {
  title: string;
  message: string;
}

/**
 * Format a notification event into title and message text.
 *
 * @param event - The slim notification event
 * @param tokenSymbols - Optional token pair symbols (base/quote) for richer messages
 * @returns Title and message text suitable for DB storage and UI display
 */
export function formatNotification(
  event: NotificationEvent,
  tokenSymbols: TokenSymbols | null
): FormattedNotification {
  const pair = tokenSymbols ? `${tokenSymbols.base}/${tokenSymbols.quote}` : null;

  switch (event.type) {
    case 'POSITION_OUT_OF_RANGE':
      return {
        title: 'Position Out of Range',
        message: pair
          ? `Your ${pair} position is now out of range`
          : `Your position is now out of range. Current tick: ${event.currentTick}`,
      };

    case 'POSITION_IN_RANGE':
      return {
        title: 'Position Back in Range',
        message: pair
          ? `Your ${pair} position is now back in range`
          : `Your position is now back in range. Current tick: ${event.currentTick}`,
      };

    case 'STOP_LOSS_EXECUTED':
      return {
        title: 'Stop Loss Executed',
        message: pair
          ? `Stop loss executed for your ${pair} position`
          : `Your stop loss order was executed successfully. Tx: ${event.txHash.slice(0, 10)}...`,
      };

    case 'STOP_LOSS_FAILED':
      return {
        title: 'Stop Loss Failed',
        message: pair
          ? `Stop loss failed for your ${pair} position: ${event.error}`
          : `Your stop loss order failed after ${event.retryCount} attempts: ${event.error}`,
      };

    case 'TAKE_PROFIT_EXECUTED':
      return {
        title: 'Take Profit Executed',
        message: pair
          ? `Take profit executed for your ${pair} position`
          : `Your take profit order was executed successfully. Tx: ${event.txHash.slice(0, 10)}...`,
      };

    case 'TAKE_PROFIT_FAILED':
      return {
        title: 'Take Profit Failed',
        message: pair
          ? `Take profit failed for your ${pair} position: ${event.error}`
          : `Your take profit order failed after ${event.retryCount} attempts: ${event.error}`,
      };
  }
}
