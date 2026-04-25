import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import { formatPositionListItem } from '../formatters.js';

const inputSchema = {
  protocol: z
    .enum(['uniswapv3', 'uniswapv3-vault'])
    .optional()
    .describe('Filter by a single protocol. Omit to include all protocols.'),
  status: z
    .enum(['active', 'archived', 'all'])
    .optional()
    .default('active')
    .describe('Filter by lifecycle status. Default "active" excludes archived positions.'),
  sortBy: z
    .enum(['createdAt', 'positionOpenedAt', 'currentValue', 'totalApr'])
    .optional()
    .default('currentValue')
    .describe('Sort field.'),
  sortDirection: z
    .enum(['asc', 'desc'])
    .optional()
    .default('desc')
    .describe('Sort direction.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Page size, max 100.'),
  offset: z.number().int().min(0).optional().default(0).describe('Page offset.'),
};

export function buildListPositionsTool(client: ApiClient) {
  return {
    name: 'list_positions',
    config: {
      title: 'List positions',
      description:
        'List the user\'s concentrated-liquidity positions across all protocols, with PnL, APR, price-range fields, ' +
        'and a pool summary (chain, pair, fee tier, base/quote token addresses + decimals). ' +
        'Use this as the starting point for portfolio queries — it returns positionHash identifiers ' +
        '(e.g. "uniswapv3/42161/12345") that can be passed to get_position for detail. ' +
        'Bigint amounts are returned as raw decimal strings; use the position detail tool for human-formatted values.',
      inputSchema,
    },
    handler: async (args: { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> }) => {
      const protocols = args.protocol ? args.protocol : undefined;
      const body = await client.getRaw<{
        data: Parameters<typeof formatPositionListItem>[0][];
        pagination: { total: number; limit: number; offset: number; hasMore: boolean };
      }>('/api/v1/positions/list', {
        protocols,
        status: args.status,
        sortBy: args.sortBy,
        sortDirection: args.sortDirection,
        limit: args.limit,
        offset: args.offset,
        include: 'pool',
      });

      const result = {
        positions: body.data.map(formatPositionListItem),
        pagination: body.pagination,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  };
}
