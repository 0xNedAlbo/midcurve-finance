import { z } from 'zod';
import type { AprPeriodsResponse } from '@midcurve/api-shared';
import type { ApiClient } from '../api-client.js';
import { formatPositionApr } from '../formatters.js';

const inputSchema = {
  protocol: z
    .enum(['uniswapv3', 'uniswapv3-vault'])
    .describe(
      'Position protocol. Use "uniswapv3" for classic NFT positions (then provide nftId), ' +
        'or "uniswapv3-vault" for tokenized vault positions (then provide vaultAddress + ownerAddress).'
    ),
  chainId: z
    .number()
    .int()
    .describe('EVM chain ID, e.g. 1 (Ethereum), 42161 (Arbitrum), 8453 (Base).'),
  nftId: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3". Numeric NFT token ID as a string.'),
  vaultAddress: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3-vault". EIP-55 vault contract address.'),
  ownerAddress: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3-vault". EIP-55 wallet address that owns the vault shares.'),
};

type Args = { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> };

function buildPath(args: Args): string {
  if (args.protocol === 'uniswapv3') {
    if (!args.nftId) throw new Error('nftId is required when protocol="uniswapv3"');
    return `/api/v1/positions/uniswapv3/${args.chainId}/${args.nftId}/apr`;
  }
  if (!args.vaultAddress || !args.ownerAddress) {
    throw new Error('vaultAddress and ownerAddress are required when protocol="uniswapv3-vault"');
  }
  return `/api/v1/positions/uniswapv3-vault/${args.chainId}/${args.vaultAddress}/${args.ownerAddress}/apr`;
}

export function buildGetPositionAprTool(client: ApiClient) {
  return {
    name: 'get_position_apr',
    config: {
      title: 'Get position APR breakdown',
      description:
        'Per-period APR (Annual Percentage Rate) breakdown for a single position, plus a ' +
        'pre-calculated summary combining realized (completed fee-collection windows) and ' +
        'unrealized (current unclaimed fees) performance. Each period is bounded by two fee ' +
        'collection events and reports its own APR; the summary is time-weighted across all ' +
        'periods. Use for "what APR is this position generating", "how does my fee income ' +
        'compare across windows", or "is this position outperforming". ' +
        'Two protocols are supported: "uniswapv3" (chainId + nftId) and "uniswapv3-vault" ' +
        '(chainId + vaultAddress + ownerAddress).',
      inputSchema,
    },
    handler: async (args: Args) => {
      const path = buildPath(args);
      // The APR endpoint returns the standard envelope with an extra top-level
      // `summary` sibling, so we use getRaw to keep it.
      const response = await client.getRaw<AprPeriodsResponse>(path);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(formatPositionApr(response), null, 2),
          },
        ],
      };
    },
  };
}
