import { z } from 'zod';
import type { SerializedConversionSummary } from '@midcurve/shared';
import type { ApiClient } from '../api-client.js';
import { formatConversionSummary } from '../formatters.js';

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
    return `/api/v1/positions/uniswapv3/${args.chainId}/${args.nftId}/conversion`;
  }
  if (!args.vaultAddress || !args.ownerAddress) {
    throw new Error('vaultAddress and ownerAddress are required when protocol="uniswapv3-vault"');
  }
  return `/api/v1/positions/uniswapv3-vault/${args.chainId}/${args.vaultAddress}/${args.ownerAddress}/conversion`;
}

export function buildGetPositionConversionTool(client: ApiClient) {
  return {
    name: 'get_position_conversion',
    config: {
      title: 'Get position conversion summary',
      description:
        'Return the conversion summary for a single concentrated-liquidity position: ' +
        'how much of each token the position net-deposited, withdrew, currently holds, and ' +
        'net-rebalanced into (direction + average execution price), plus fee premium earned ' +
        'and the per-segment rebalancing history. ' +
        'Two protocols are supported: "uniswapv3" for classic NFT positions (pass chainId + nftId), and ' +
        '"uniswapv3-vault" for tokenized vault positions (pass chainId + vaultAddress + ownerAddress). ' +
        'All numeric fields are returned both formatted (with token symbols) and as raw bigint strings ' +
        'so they can be re-parsed without precision loss.',
      inputSchema,
    },
    handler: async (args: Args) => {
      const path = buildPath(args);
      const summary = await client.get<SerializedConversionSummary>(path);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(formatConversionSummary(summary), null, 2),
          },
        ],
      };
    },
  };
}
