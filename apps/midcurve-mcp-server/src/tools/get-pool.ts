import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import { formatPool } from '../formatters.js';

const inputSchema = {
  chainId: z.number().int().describe('EVM chain ID, e.g. 42161 (Arbitrum).'),
  address: z.string().describe('EIP-55 checksummed Uniswap V3 pool contract address.'),
  metrics: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include subgraph metrics (TVL, 24h/7d volume).'),
  fees: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include fee data for APR calculations.'),
};

export function buildGetPoolTool(client: ApiClient) {
  return {
    name: 'get_pool',
    config: {
      title: 'Get Uniswap V3 pool detail',
      description:
        'Returns pool state (tokens, fee tier, current tick / sqrtPrice) and optional subgraph metrics ' +
        '(TVL in USD, recent volume). Use this when you need pool-level context (not user-specific) — ' +
        'e.g. comparing fee tiers or checking liquidity depth.\n\n' +
        'Standalone pool detail uses the canonical Uniswap pool ordering (`token0`/`token1`) ' +
        'rather than the position-context base/quote pivot — outside a user\'s position there ' +
        'is no canonical base/quote preference (see convention §3.1). USD metrics are dual-emitted: ' +
        '`tvl`/`tvlRaw`, `volume24h`/`volume24hRaw`, `fees24h`/`fees24hRaw`. Display is the compact ' +
        'subgraph value (e.g. "$123.5M"); Raw is the float string the subgraph returned. The ' +
        'pool\'s `state` (sqrtPriceX96, currentTick, liquidity, feeGrowthGlobal0/1) and optional ' +
        '`feeData` block are passed through as canonical bigint strings — single-emit per §2.',
      inputSchema,
    },
    handler: async (args: { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> }) => {
      const pool = await client.get<Parameters<typeof formatPool>[0]>(
        `/api/v1/pools/uniswapv3/${args.chainId}/${args.address}`,
        { metrics: args.metrics, fees: args.fees }
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatPool(pool), null, 2) }],
      };
    },
  };
}
