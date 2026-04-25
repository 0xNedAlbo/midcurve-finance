import { z } from 'zod';
import type {
  ExecutionFailedPayload,
  ExecutionSuccessPayload,
  NotificationData,
  NotificationEventType,
  NotificationPayload,
  RangeEventPayload,
} from '@midcurve/api-shared';
import type { ApiClient } from '../api-client.js';
import { timestamp } from '../formatters.js';

const inputSchema = {
  limit: z.number().int().min(1).max(50).optional().default(20).describe('Max notifications to return.'),
  cursor: z.string().optional().describe('Pagination cursor from a previous response.'),
  isRead: z
    .enum(['true', 'false'])
    .optional()
    .describe('Filter by read status. Omit for both.'),
  eventType: z
    .enum([
      'POSITION_OUT_OF_RANGE',
      'POSITION_IN_RANGE',
      'STOP_LOSS_EXECUTED',
      'STOP_LOSS_FAILED',
      'TAKE_PROFIT_EXECUTED',
      'TAKE_PROFIT_FAILED',
    ])
    .optional()
    .describe('Filter by notification event type.'),
};

function isRangeEventType(t: NotificationEventType): boolean {
  return t === 'POSITION_OUT_OF_RANGE' || t === 'POSITION_IN_RANGE';
}

function isExecutionSuccessType(t: NotificationEventType): boolean {
  return t === 'STOP_LOSS_EXECUTED' || t === 'TAKE_PROFIT_EXECUTED';
}

function isExecutionFailedType(t: NotificationEventType): boolean {
  return t === 'STOP_LOSS_FAILED' || t === 'TAKE_PROFIT_FAILED';
}

/**
 * Reshape a notification payload to dual-emit conventions.
 *
 * Range events: pool reference + canonical sqrtPriceX96/tick fields, plus
 * a humanized currentPrice (single-emit because canonical lives next to it
 * as currentSqrtPriceX96 — no precision loss).
 *
 * Execution-success events: amount0Out / amount1Out are raw scaled bigints
 * scaled to the *individual* token's decimals (token0/token1, not base/quote).
 * Upstream provides humanAmount0Out / humanAmount1Out alongside; we surface
 * them as the display half of the dual-emit pair without resolving the
 * position context (avoids a second API call per notification).
 */
function formatPayload(
  eventType: NotificationEventType,
  payload: NotificationPayload | undefined,
): Record<string, unknown> | null {
  if (!payload) return null;

  if (isRangeEventType(eventType)) {
    const p = payload as RangeEventPayload;
    return {
      poolAddress: p.poolAddress,
      chainId: p.chainId,
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      currentTick: p.currentTick,
      currentSqrtPriceX96: p.currentSqrtPriceX96,
      currentPrice: p.humanCurrentPrice ?? null,
      lowerPrice: p.humanLowerPrice ?? null,
      upperPrice: p.humanUpperPrice ?? null,
    };
  }

  if (isExecutionSuccessType(eventType)) {
    const p = payload as ExecutionSuccessPayload;
    return {
      txHash: p.txHash,
      chainId: p.chainId,
      triggerSide: p.triggerSide,
      amount0Out: p.humanAmount0Out ?? null,
      amount0OutRaw: p.amount0Out,
      amount1Out: p.humanAmount1Out ?? null,
      amount1OutRaw: p.amount1Out,
      triggerSqrtPriceX96: p.triggerSqrtPriceX96,
      executionSqrtPriceX96: p.executionSqrtPriceX96,
      triggerPrice: p.humanTriggerPrice ?? null,
      executionPrice: p.humanExecutionPrice ?? null,
    };
  }

  if (isExecutionFailedType(eventType)) {
    const p = payload as ExecutionFailedPayload;
    return {
      error: p.error,
      chainId: p.chainId,
      retryCount: p.retryCount,
      triggerSide: p.triggerSide,
      triggerSqrtPriceX96: p.triggerSqrtPriceX96,
      triggerPrice: p.humanTriggerPrice ?? null,
    };
  }

  return payload as unknown as Record<string, unknown>;
}

export function buildListNotificationsTool(client: ApiClient) {
  return {
    name: 'list_notifications',
    config: {
      title: 'List notifications',
      description:
        'Paginated list of notifications: range alerts (POSITION_OUT_OF_RANGE / POSITION_IN_RANGE) and ' +
        'order outcomes (STOP_LOSS_EXECUTED, TAKE_PROFIT_FAILED, etc.). Use this to answer ' +
        '"anything happen with my positions recently?" questions. Cursor-based pagination — ' +
        'pass the returned nextCursor to fetch the next page.\n\n' +
        'Money and price fields in the payload are dual-emitted: `<field>` is a humanized display ' +
        'string; `<field>Raw` is the bigint as decimal string. Raw is canonical — use it for ' +
        'further computation; display is for narration/rendering.\n\n' +
        'Per-event-type payload shape:\n' +
        '- Range events (POSITION_*): poolAddress, chainId, tickLower, tickUpper, currentTick, ' +
        'currentSqrtPriceX96 (canonical), currentPrice/lowerPrice/upperPrice (display strings)\n' +
        '- Execution success (STOP_LOSS_EXECUTED, TAKE_PROFIT_EXECUTED): txHash, chainId, ' +
        'triggerSide, amount0Out/amount0OutRaw, amount1Out/amount1OutRaw (raw scaled to each ' +
        'token\'s decimals), triggerSqrtPriceX96/executionSqrtPriceX96 (canonical), ' +
        'triggerPrice/executionPrice (display)\n' +
        '- Execution failure (STOP_LOSS_FAILED, TAKE_PROFIT_FAILED): error, chainId, retryCount, ' +
        'triggerSide, triggerSqrtPriceX96, triggerPrice (display)',
      inputSchema,
    },
    handler: async (args: { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> }) => {
      const data = await client.get<{
        notifications: NotificationData[];
        nextCursor: string | null;
        hasMore: boolean;
      }>('/api/v1/notifications', {
        limit: args.limit,
        cursor: args.cursor,
        isRead: args.isRead,
        eventType: args.eventType,
      });

      const formatted = {
        notifications: data.notifications.map((n) => ({
          id: n.id,
          eventType: n.eventType,
          positionId: n.positionId,
          title: n.title,
          message: n.message,
          isRead: n.isRead,
          createdAt: timestamp(n.createdAt),
          readAt: n.readAt ? timestamp(n.readAt) : null,
          payload: formatPayload(n.eventType, n.payload),
        })),
        nextCursor: data.nextCursor,
        hasMore: data.hasMore,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
      };
    },
  };
}
