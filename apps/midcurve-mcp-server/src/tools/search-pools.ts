import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import { formatPoolSearchResult } from '../formatters.js';

const inputSchema = {
  base: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe(
      'Base side of the pair. Accepts exact token symbols (case-insensitive — must match a ' +
        'CoinGecko symbol exactly) or EIP-55 addresses. Fuzzy/prefix resolution is the ' +
        "consumer's responsibility — passing 'eth' will not match WETH/stETH/rETH."
    ),
  quote: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe(
      "Quote side of the pair. Same input contract as `base`. Determines each result's " +
        '`userProvidedInfo.isToken0Quote` (set to true when the pool\'s token0 resolves ' +
        'to a member of this set on that chain).'
    ),
  chainIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(5)
    .describe('EVM chain IDs to search. Supported: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base), 10 (Optimism), 137 (Polygon).'),
  sortBy: z
    .enum(['tvlUSD', 'volume24hUSD', 'fees24hUSD', 'volume7dAvgUSD', 'fees7dAvgUSD', 'apr7d'])
    .optional()
    .describe('Field to sort results by. Defaults to tvlUSD on the server.'),
  sortDirection: z
    .enum(['asc', 'desc'])
    .optional()
    .describe('Sort direction. Defaults to desc on the server.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum results to return (1-100, default 20).'),
};

export function buildSearchPoolsTool(client: ApiClient) {
  return {
    name: 'search_pools',
    config: {
      title: 'Search Uniswap V3 pools by base/quote token sets',
      description:
        'Search the cartesian product `base × quote` across one or more chains and return ' +
        'matching pools sorted by the chosen metric. Each result is annotated with ' +
        '`userProvidedInfo.isToken0Quote` (derived from the request\'s quote-side input — ' +
        'true if the pool\'s `token0` is a member of `quote` on that chain) so consumers ' +
        'can render pairs in user-intended orientation regardless of pool-native token order.\n\n' +
        '**Input contract (important):** `base` and `quote` accept *exact* token symbols ' +
        '(case-insensitive — must match a CoinGecko symbol exactly) or EIP-55 addresses. ' +
        'Fuzzy/prefix resolution is the consumer\'s responsibility. Passing `"eth"` will ' +
        'not match `WETH`/`stETH`/`rETH`.\n\n' +
        '**Validation:** the trivial case `|base| = |quote| = 1 ∧ base[0] === quote[0]` is ' +
        'rejected as 400. Richer queries like `base=["WETH","stETH"], quote=["WETH","stETH"]` ' +
        'are valid (per-chain self-exclusion handles `(b, q)` pairs with `b === q`).\n\n' +
        '**Output:** each item carries the same `metrics` block shape as `get_pool` ' +
        '(dual-emitted USD fields, humanized fee-APR percentages, optional `volatility` ' +
        'and `sigmaFilter` σ-filter blocks per PRD-pool-sigma-filter), plus `isFavorite` ' +
        'and `userProvidedInfo`. The pool itself is in canonical pool ordering ' +
        '(`token0`/`token1`); use `userProvidedInfo.isToken0Quote` to pivot to the ' +
        'user-intended base/quote orientation.',
      inputSchema,
    },
    handler: async (args: { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> }) => {
      const payload: Record<string, unknown> = {
        base: args.base,
        quote: args.quote,
        chainIds: args.chainIds,
      };
      if (args.sortBy) payload.sortBy = args.sortBy;
      if (args.sortDirection) payload.sortDirection = args.sortDirection;
      if (typeof args.limit === 'number') payload.limit = args.limit;

      const results = await client.post<Parameters<typeof formatPoolSearchResult>[0][]>(
        '/api/v1/pools/uniswapv3/search',
        payload
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(results.map(formatPoolSearchResult), null, 2),
          },
        ],
      };
    },
  };
}
