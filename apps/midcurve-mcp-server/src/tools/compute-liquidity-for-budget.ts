import { z } from 'zod';
import {
  formatTokenAmount,
  getLiquidityFromInvestmentAmounts_withTick,
} from '@midcurve/shared';
import type { ApiClient } from '../api-client.js';
import {
  hasPositionLookupArgs,
  positionLookupInputSchema,
  resolvePositionContext,
} from '../lib/position-context.js';

const inputSchema = {
  ...positionLookupInputSchema,
  baseAmount: z
    .string()
    .describe('Amount of the base (non-quote) token to invest, as a raw bigint string in the token\'s smallest unit.'),
  quoteAmount: z
    .string()
    .describe('Amount of the quote token to invest, as a raw bigint string in the token\'s smallest unit.'),
  tickLower: z
    .number()
    .int()
    .optional()
    .describe('Lower tick bound. Falls back to the resolved position\'s tickLower.'),
  tickUpper: z
    .number()
    .int()
    .optional()
    .describe('Upper tick bound. Falls back to the resolved position\'s tickUpper.'),
  sqrtPriceX96: z
    .string()
    .optional()
    .describe('Pool sqrtPriceX96 (raw bigint string). Falls back to the resolved pool\'s current sqrtPriceX96.'),
  baseDecimals: z
    .number()
    .int()
    .optional()
    .describe('Decimals of the base token. Falls back to the resolved position\'s base token decimals.'),
  quoteDecimals: z
    .number()
    .int()
    .optional()
    .describe('Decimals of the quote token. Falls back to the resolved position\'s quote token decimals.'),
  isQuoteToken0: z
    .boolean()
    .optional()
    .describe('Whether the quote token is token0 in the pool. Falls back to the resolved position\'s isToken0Quote.'),
};

type Args = { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> };

export function buildComputeLiquidityForBudgetTool(client: ApiClient) {
  return {
    name: 'compute_liquidity_for_budget',
    config: {
      title: 'Compute liquidity for an investment budget',
      description:
        'Given a budget split between base and quote tokens, the price range, and the current pool ' +
        'price, returns the maximum Uniswap V3 liquidity (L) you could mint into a position with ' +
        'those bounds. Pure math, no on-chain reads. The function handles all three regimes ' +
        '(price below / inside / above the range) — when out of range, the budget is internally ' +
        'converted to the single token that\'s required. ' +
        'Pass everything explicitly, OR supply the position-lookup fields to inherit ticks, sqrtPrice, ' +
        'decimals and isQuoteToken0 from a live position; you typically only need to provide ' +
        'baseAmount + quoteAmount in that case.',
      inputSchema,
    },
    handler: async (args: Args) => {
      const ctx = hasPositionLookupArgs(args)
        ? await resolvePositionContext(client, args)
        : null;

      const tickLower = args.tickLower ?? ctx?.position.tickLower;
      const tickUpper = args.tickUpper ?? ctx?.position.tickUpper;
      const sqrtPriceRaw = args.sqrtPriceX96 ?? ctx?.pool.sqrtPriceX96;
      const baseDecimals = args.baseDecimals ?? ctx?.baseToken.decimals;
      const quoteDecimals = args.quoteDecimals ?? ctx?.quoteToken.decimals;
      const isQuoteToken0 = args.isQuoteToken0 ?? ctx?.isToken0Quote;

      if (tickLower === undefined) throw new Error('tickLower is required');
      if (tickUpper === undefined) throw new Error('tickUpper is required');
      if (sqrtPriceRaw === undefined) throw new Error('sqrtPriceX96 is required');
      if (baseDecimals === undefined) throw new Error('baseDecimals is required');
      if (quoteDecimals === undefined) throw new Error('quoteDecimals is required');
      if (isQuoteToken0 === undefined) throw new Error('isQuoteToken0 is required');

      const baseAmount = BigInt(args.baseAmount);
      const quoteAmount = BigInt(args.quoteAmount);
      const sqrtPriceCurrentX96 = BigInt(sqrtPriceRaw);

      const liquidity = getLiquidityFromInvestmentAmounts_withTick(
        baseAmount,
        baseDecimals,
        quoteAmount,
        quoteDecimals,
        isQuoteToken0,
        tickUpper,
        tickLower,
        sqrtPriceCurrentX96,
      );

      const formatted = ctx
        ? {
            baseAmount: formatTokenAmount(
              baseAmount.toString(),
              ctx.baseToken.symbol,
              ctx.baseToken.decimals,
            ),
            quoteAmount: formatTokenAmount(
              quoteAmount.toString(),
              ctx.quoteToken.symbol,
              ctx.quoteToken.decimals,
            ),
          }
        : null;

      const result = {
        liquidity: liquidity.toString(),
        formattedInputs: formatted,
        inputsUsed: {
          tickLower,
          tickUpper,
          sqrtPriceX96: sqrtPriceCurrentX96.toString(),
          baseDecimals,
          quoteDecimals,
          isQuoteToken0,
          resolvedFromPosition: ctx?.positionHash ?? null,
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  };
}
