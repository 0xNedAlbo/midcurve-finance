import { z } from 'zod';
import type { PositionAccountingResponse } from '@midcurve/api-shared';
import type { ApiClient } from '../api-client.js';
import { formatPositionAccounting } from '../formatters.js';

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
    return `/api/v1/positions/uniswapv3/${args.chainId}/${args.nftId}/accounting`;
  }
  if (!args.vaultAddress || !args.ownerAddress) {
    throw new Error('vaultAddress and ownerAddress are required when protocol="uniswapv3-vault"');
  }
  return `/api/v1/positions/uniswapv3-vault/${args.chainId}/${args.vaultAddress}/${args.ownerAddress}/accounting`;
}

export function buildGetPositionAccountingTool(client: ApiClient) {
  return {
    name: 'get_position_accounting',
    config: {
      title: 'Get position accounting report',
      description:
        'Lifetime-to-date, realized-only accounting report for a single position: balance sheet ' +
        '(assets at cost, contributed capital, capital returned, retained earnings split by source), ' +
        'realized P&L breakdown (withdrawals / collected fees / FX effect), and the full journal-entry ' +
        'audit trail with debits and credits per account. All amounts are in the user\'s reporting ' +
        'currency. Use this when the user asks "show me the books for this position", "how much have ' +
        'I actually realized", or wants to audit individual entries. ' +
        'Two protocols are supported: "uniswapv3" (chainId + nftId) and "uniswapv3-vault" ' +
        '(chainId + vaultAddress + ownerAddress).',
      inputSchema,
    },
    handler: async (args: Args) => {
      const path = buildPath(args);
      const report = await client.get<PositionAccountingResponse>(path);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(formatPositionAccounting(report), null, 2),
          },
        ],
      };
    },
  };
}
