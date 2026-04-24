import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import { formatPnl } from '../formatters.js';

const inputSchema = {
  period: z
    .enum(['day', 'week', 'month', 'quarter', 'year'])
    .describe('Reporting period to compute PnL for.'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('How many periods back from now. 0 = current period (e.g. this week), 1 = previous, etc.'),
};

export function buildGetPnlTool(client: ApiClient) {
  return {
    name: 'get_pnl',
    config: {
      title: 'Get realized P&L statement',
      description:
        'Returns hierarchical realized P&L (portfolio → instrument → position) for a given period in the user\'s ' +
        'reporting currency. Includes withdrawals, collected fees, and FX effects. ' +
        'For "how much did I make this month / last quarter" type questions.',
      inputSchema,
    },
    handler: async (args: { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> }) => {
      const pnl = await client.get<Parameters<typeof formatPnl>[0]>('/api/v1/accounting/pnl', {
        period: args.period,
        offset: args.offset,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatPnl(pnl), null, 2) }],
      };
    },
  };
}
