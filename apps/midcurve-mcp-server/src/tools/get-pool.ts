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
        'e.g. comparing fee tiers or checking liquidity depth.',
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
