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
        'List the user\'s concentrated-liquidity positions across all protocols. ' +
        'Use this as the starting point for portfolio queries — each item carries a positionHash ' +
        '(e.g. "uniswapv3/42161/12345" or "uniswapv3-vault/8453/<vault>/<owner>") to pass to ' +
        'get_position for full detail.\n\n' +
        'Money and price fields are dual-emitted: `<field>` is a humanized display string in the ' +
        'position\'s quote token (e.g. "49,771.65 USDC"); `<field>Raw` is the bigint as decimal ' +
        'string in quote-token base units. Raw is canonical — use it for further computation; ' +
        'display is for narration/rendering.\n\n' +
        'Per-item shape:\n' +
        '- pool: { chainId, poolAddress, pair (e.g. "WETH/USDC"), feeBps, feeTier (e.g. "0.05%"), ' +
        'baseToken: { address, symbol, decimals }, quoteToken: { address, symbol, decimals } }\n' +
        '- money pairs: currentValue/Raw, costBasis/Raw, realizedPnl/Raw, unrealizedPnl/Raw, ' +
        'collectedYield/Raw, unclaimedYield/Raw\n' +
        '- priceRange: { lower, lowerRaw, upper, upperRaw }\n' +
        '- apr: { total, base, reward } — percentage strings or null\n' +
        '- openedAt, isArchived, archivedAt\n\n' +
        'For current spot price and in-range status, use get_position.',
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
