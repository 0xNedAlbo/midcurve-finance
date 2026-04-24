import { z } from 'zod';
import type { ApiClient } from '../api-client.js';

const inputSchema = {
  protocol: z
    .enum(['uniswapv3', 'uniswapv3-vault'])
    .describe('Position protocol — same semantics as in get_position.'),
  chainId: z.number().int().describe('EVM chain ID.'),
  nftId: z.string().optional().describe('Required for protocol="uniswapv3".'),
  vaultAddress: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3-vault".'),
  ownerAddress: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3-vault".'),
};

type Args = { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> };

function buildPath(args: Args): string {
  if (args.protocol === 'uniswapv3') {
    if (!args.nftId) throw new Error('nftId is required when protocol="uniswapv3"');
    return `/api/v1/positions/uniswapv3/${args.chainId}/${args.nftId}/close-orders`;
  }
  if (!args.vaultAddress || !args.ownerAddress) {
    throw new Error('vaultAddress and ownerAddress are required when protocol="uniswapv3-vault"');
  }
  return `/api/v1/positions/uniswapv3-vault/${args.chainId}/${args.vaultAddress}/${args.ownerAddress}/close-orders`;
}

export function buildListCloseOrdersTool(client: ApiClient) {
  return {
    name: 'list_close_orders',
    config: {
      title: 'List close orders for a position',
      description:
        'List stop-loss and take-profit orders attached to a position, with their automation state ' +
        '("monitoring", "executing", "retrying", "failed", "executed", "inactive") and trigger conditions. ' +
        'Same args shape as get_position.',
      inputSchema,
    },
    handler: async (args: Args) => {
      const path = buildPath(args);
      const orders = await client.get<unknown>(path);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(orders, null, 2) }],
      };
    },
  };
}
