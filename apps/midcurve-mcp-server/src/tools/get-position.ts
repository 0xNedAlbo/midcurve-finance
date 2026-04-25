import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import { formatPosition } from '../formatters.js';

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
    return `/api/v1/positions/uniswapv3/${args.chainId}/${args.nftId}`;
  }
  if (!args.vaultAddress || !args.ownerAddress) {
    throw new Error('vaultAddress and ownerAddress are required when protocol="uniswapv3-vault"');
  }
  return `/api/v1/positions/uniswapv3-vault/${args.chainId}/${args.vaultAddress}/${args.ownerAddress}`;
}

export function buildGetPositionTool(client: ApiClient) {
  return {
    name: 'get_position',
    config: {
      title: 'Get position detail',
      description:
        'Fetch full detail of a single position. ' +
        'Two protocols are supported: "uniswapv3" for classic NFT positions (pass chainId + nftId), and ' +
        '"uniswapv3-vault" for tokenized vault positions (pass chainId + vaultAddress + ownerAddress). ' +
        'The positionHash returned by list_positions tells you which form to use: ' +
        '"uniswapv3/<chain>/<nft>" → uniswapv3 form, "uniswapv3-vault/<chain>/<vault>/<owner>" → vault form.\n\n' +
        'Output shape (humanized in the position\'s quote token):\n' +
        '- pool: { chainId, poolAddress, pair, feeBps, feeTier, ' +
        'baseToken: { address, symbol, decimals }, quoteToken: { address, symbol, decimals } }\n' +
        '- currentValue, costBasis, realizedPnl, unrealizedPnl, collectedYield, unclaimedYield — ' +
        'humanized strings (e.g. "1,234.56 USDC") or null\n' +
        '- priceRange: { lower, upper, current, inRange } — lower/upper humanized; ' +
        'current is currently always null (not populated by the upstream API); inRange is a boolean\n' +
        '- apr: { total, base, reward } — percentage strings or null\n' +
        '- ownerWallet, openedAt, isArchived, archivedAt\n' +
        '- rawConfig, rawState — protocol-specific objects with raw bigint strings for advanced use\n\n' +
        'Note: the priceRange shape differs from list_positions, which returns only { lower, upper }.',
      inputSchema,
    },
    handler: async (args: Args) => {
      const path = buildPath(args);
      const position = await client.get<Parameters<typeof formatPosition>[0]>(path);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatPosition(position), null, 2) }],
      };
    },
  };
}
