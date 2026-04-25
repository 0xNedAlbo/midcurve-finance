import { z } from 'zod';
import type { PositionPnlCurveData } from '@midcurve/api-shared';
import { formatPercentage, formatTokenAmount } from '@midcurve/shared';
import type { ApiClient } from '../api-client.js';
import { formatPoolSummary } from '../formatters.js';
import { resolvePositionContext } from '../lib/position-context.js';

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
        '(chainId + vaultAddress + ownerAddress).\n\n' +
        'Money and price fields are dual-emitted: `<field>` is a humanized display string in the ' +
        'position\'s quote token; `<field>Raw` is the bigint as decimal string. Raw is canonical — ' +
        'use it for further computation; display is for narration/rendering.\n\n' +
        'Output shape:\n' +
        '- pool: §3.1 pool summary\n' +
        '- currentPrice/currentPriceRaw, priceMin/priceMinRaw, priceMax/priceMaxRaw, ' +
        'costBasis/costBasisRaw\n' +
        '- numPoints, liquidity\n' +
        '- curve[]: { price/priceRaw, positionValue/positionValueRaw, pnl/pnlRaw, pnlPercent, phase }',
      inputSchema,
    },
    handler: async (args: Args) => {
      const path = buildPath(args);
      const query: Record<string, unknown> = {};
      if (args.priceMin !== undefined) query.priceMin = args.priceMin;
      if (args.priceMax !== undefined) query.priceMax = args.priceMax;
      if (args.numPoints !== undefined) query.numPoints = args.numPoints;

      const [data, ctx] = await Promise.all([
        client.get<PositionPnlCurveData>(path, query),
        resolvePositionContext(client, args),
      ]);

      const pool = formatPoolSummary({
        chainId: ctx.pool.chainId,
        poolAddress: ctx.pool.address,
        feeBps: ctx.feeBps,
        isToken0Quote: ctx.isToken0Quote,
        token0: ctx.token0,
        token1: ctx.token1,
      });

      const fmtQuote = (raw: string) =>
        formatTokenAmount(raw, data.quoteTokenSymbol, data.quoteTokenDecimals);

      const result = {
        pool,
        liquidity: data.liquidity,
        numPoints: data.numPoints,
        currentPrice: fmtQuote(data.currentPrice),
        currentPriceRaw: data.currentPrice,
        priceMin: fmtQuote(data.priceMin),
        priceMinRaw: data.priceMin,
        priceMax: fmtQuote(data.priceMax),
        priceMaxRaw: data.priceMax,
        costBasis: fmtQuote(data.costBasis),
        costBasisRaw: data.costBasis,
        curve: data.curve.map((p) => ({
          price: fmtQuote(p.price),
          priceRaw: p.price,
          positionValue: fmtQuote(p.positionValue),
          positionValueRaw: p.positionValue,
          pnl: fmtQuote(p.pnl),
          pnlRaw: p.pnl,
          pnlPercent: formatPercentage(p.pnlPercent, 2),
          phase: p.phase,
        })),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  };
}
