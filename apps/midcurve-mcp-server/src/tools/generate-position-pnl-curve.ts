import { z } from 'zod';
import type { PositionPnlCurveData } from '@midcurve/api-shared';
import { formatPercentage, formatTokenAmount } from '@midcurve/shared';
import type { ApiClient } from '../api-client.js';

const inputSchema = {
  protocol: z
    .enum(['uniswapv3', 'uniswapv3-vault'])
    .describe(
      'Position protocol. Use "uniswapv3" for classic NFT positions (then provide nftId), ' +
        'or "uniswapv3-vault" for tokenized vault positions (then provide vaultAddress + ownerAddress).'
    ),
  chainId: z.number().int().describe('EVM chain ID, e.g. 42161 (Arbitrum).'),
  nftId: z.string().optional().describe('Required for protocol="uniswapv3".'),
  vaultAddress: z.string().optional().describe('Required for protocol="uniswapv3-vault".'),
  ownerAddress: z.string().optional().describe('Required for protocol="uniswapv3-vault".'),
  priceMin: z
    .string()
    .optional()
    .describe(
      'Lower price bound for the curve (raw bigint string scaled to baseTokenDecimals). ' +
        'Defaults to 50% of the position\'s current price.',
    ),
  priceMax: z
    .string()
    .optional()
    .describe(
      'Upper price bound for the curve. Defaults to 150% of the position\'s current price.',
    ),
  numPoints: z
    .number()
    .int()
    .min(2)
    .max(200)
    .optional()
    .describe('Number of curve points (default 100, max 200).'),
};

type Args = { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> };

function buildPath(args: Args): string {
  if (args.protocol === 'uniswapv3') {
    if (!args.nftId) throw new Error('nftId is required when protocol="uniswapv3"');
    return `/api/v1/positions/uniswapv3/${args.chainId}/${args.nftId}/pnl-curve`;
  }
  if (!args.vaultAddress || !args.ownerAddress) {
    throw new Error('vaultAddress and ownerAddress are required when protocol="uniswapv3-vault"');
  }
  return `/api/v1/positions/uniswapv3-vault/${args.chainId}/${args.vaultAddress}/${args.ownerAddress}/pnl-curve`;
}

export function buildGeneratePositionPnlCurveTool(client: ApiClient) {
  return {
    name: 'generate_position_pnl_curve',
    config: {
      title: 'Generate a position PnL curve over a price range',
      description:
        'Returns a list of (price, positionValue, pnl, pnlPercent, phase) points across a price range. ' +
        'Use to find break-even prices, see how PnL behaves outside the active range, or compare ' +
        'two positions\' PnL profiles. Defaults to ±50% around the current pool price with 100 points; ' +
        'override priceMin/priceMax/numPoints for finer control. ' +
        'For vault positions the values are scaled by the user\'s share of total supply. ' +
        'Two protocols are supported: "uniswapv3" (chainId + nftId) and "uniswapv3-vault" ' +
        '(chainId + vaultAddress + ownerAddress).',
      inputSchema,
    },
    handler: async (args: Args) => {
      const path = buildPath(args);
      const query: Record<string, unknown> = {};
      if (args.priceMin !== undefined) query.priceMin = args.priceMin;
      if (args.priceMax !== undefined) query.priceMax = args.priceMax;
      if (args.numPoints !== undefined) query.numPoints = args.numPoints;

      const data = await client.get<PositionPnlCurveData>(path, query);

      const formatted = {
        currentPrice: formatTokenAmount(data.currentPrice, data.quoteTokenSymbol, data.quoteTokenDecimals),
        priceMin: formatTokenAmount(data.priceMin, data.quoteTokenSymbol, data.quoteTokenDecimals),
        priceMax: formatTokenAmount(data.priceMax, data.quoteTokenSymbol, data.quoteTokenDecimals),
        costBasis: formatTokenAmount(data.costBasis, data.quoteTokenSymbol, data.quoteTokenDecimals),
        numPoints: data.numPoints,
        curve: data.curve.map((p) => ({
          price: formatTokenAmount(p.price, data.quoteTokenSymbol, data.quoteTokenDecimals),
          positionValue: formatTokenAmount(p.positionValue, data.quoteTokenSymbol, data.quoteTokenDecimals),
          pnl: formatTokenAmount(p.pnl, data.quoteTokenSymbol, data.quoteTokenDecimals),
          pnlPercent: formatPercentage(p.pnlPercent, 2),
          phase: p.phase,
        })),
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ formatted, raw: data }, null, 2),
          },
        ],
      };
    },
  };
}
