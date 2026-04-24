import { z } from 'zod';
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

interface NotificationRaw {
  id: string;
  eventType: string;
  positionId: string | null;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  payload?: Record<string, unknown>;
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
        'pass the returned nextCursor to fetch the next page.',
      inputSchema,
    },
    handler: async (args: { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> }) => {
      const data = await client.get<{
        notifications: NotificationRaw[];
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
          payload: n.payload,
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
