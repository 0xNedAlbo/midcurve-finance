import { z } from 'zod';
import { computeExpectedSwapOutput, formatTokenAmount } from '@midcurve/shared';
import type { ApiClient } from '../api-client.js';
import {
  hasPositionLookupArgs,
  positionLookupInputSchema,
  resolvePositionContext,
} from '../lib/position-context.js';

const inputSchema = {
  ...positionLookupInputSchema,
  amountIn: z
    .string()
    .describe('Raw input amount (bigint string in the input token\'s smallest unit).'),
  direction: z
    .enum(['TOKEN0_TO_1', 'TOKEN1_TO_0'])
    .describe(
      'Swap direction relative to the pool\'s token0/token1 ordering. ' +
        '"TOKEN0_TO_1" means swapping token0 for token1.',
    ),
  sqrtPriceX96: z
    .string()
    .optional()
    .describe('Pool sqrtPriceX96 (raw bigint string). Falls back to the resolved pool\'s current sqrtPriceX96.'),
  feeBps: z
    .number()
    .int()
    .optional()
    .describe(
      'Pool fee tier in millionths (100 = 0.01%, 500 = 0.05%, 3000 = 0.3%, 10000 = 1%). ' +
        'Falls back to the resolved pool\'s feeBps.',
    ),
};

type Args = { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> };

export function buildSimulateSwapOutputTool(client: ApiClient) {
  return {
    name: 'simulate_swap_output',
    config: {
      title: 'Estimate swap output (zero-impact)',
      description:
        'Estimates the output amount for an exact-input swap through a UniswapV3 pool using the ' +
        'pool\'s current spot price and fee tier. ' +
        'IMPORTANT CAVEAT: this is a zero-price-impact approximation that assumes infinite liquidity ' +
        'at spot. It is suitable for "rough fair-value" estimates and path comparisons but is NOT ' +
        'accurate for exact on-chain quoting and MUST NOT be used to set slippage protection. Real ' +
        'execution should use the on-chain Quoter v2 or an external oracle. ' +
        'Either pass sqrtPriceX96 + feeBps directly, or supply the position-lookup fields to ' +
        'auto-fill them from the position\'s pool.',
      inputSchema,
    },
    handler: async (args: Args) => {
      const ctx = hasPositionLookupArgs(args)
        ? await resolvePositionContext(client, args)
        : null;

      const sqrtPriceRaw = args.sqrtPriceX96 ?? ctx?.pool.sqrtPriceX96;
      const fee = args.feeBps ?? ctx?.feeBps;

      if (sqrtPriceRaw === undefined) throw new Error('sqrtPriceX96 is required');
      if (fee === undefined) throw new Error('feeBps is required');

      const amountIn = BigInt(args.amountIn);
      const sqrtPriceX96 = BigInt(sqrtPriceRaw);

      const amountOut = computeExpectedSwapOutput(amountIn, sqrtPriceX96, fee, args.direction);

      const tokenIn = ctx
        ? args.direction === 'TOKEN0_TO_1'
          ? ctx.token0
          : ctx.token1
        : null;
      const tokenOut = ctx
        ? args.direction === 'TOKEN0_TO_1'
          ? ctx.token1
          : ctx.token0
        : null;

      const formatted =
        tokenIn && tokenOut
          ? {
              amountIn: formatTokenAmount(amountIn.toString(), tokenIn.symbol, tokenIn.decimals),
              amountOut: formatTokenAmount(amountOut.toString(), tokenOut.symbol, tokenOut.decimals),
            }
          : null;

      const result = {
        formatted,
        raw: {
          amountIn: amountIn.toString(),
          amountOut: amountOut.toString(),
        },
        inputsUsed: {
          direction: args.direction,
          sqrtPriceX96: sqrtPriceX96.toString(),
          feeBps: fee,
          resolvedFromPosition: ctx?.positionHash ?? null,
        },
        caveat:
          'Zero price-impact estimate — assumes infinite liquidity at spot. Do NOT use this value ' +
          'for slippage protection or trade execution.',
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  };
}
