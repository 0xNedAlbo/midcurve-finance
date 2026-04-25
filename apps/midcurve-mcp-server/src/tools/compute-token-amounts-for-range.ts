import { z } from 'zod';
import { formatTokenAmount, getTokenAmountsFromLiquidity } from '@midcurve/shared';
import type { ApiClient } from '../api-client.js';
import {
  hasPositionLookupArgs,
  positionLookupInputSchema,
  resolvePositionContext,
} from '../lib/position-context.js';

const inputSchema = {
  ...positionLookupInputSchema,
  liquidity: z
    .string()
    .optional()
    .describe('Position liquidity (raw bigint string). Falls back to the resolved position\'s liquidity.'),
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
    .describe('Pool sqrtPriceX96 (Q96.96 raw bigint string). Falls back to the resolved pool\'s current sqrtPriceX96.'),
};

type Args = { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> };

export function buildComputeTokenAmountsForRangeTool(client: ApiClient) {
  return {
    name: 'compute_token_amounts_for_range',
    config: {
      title: 'Compute token amounts from liquidity in a tick range',
      description:
        'Given a liquidity amount L sitting in [tickLower, tickUpper] at a given pool sqrtPriceX96, ' +
        'returns the exact token0 and token1 amounts the position would hold. Pure math, no on-chain ' +
        'state read. ' +
        'Either pass all four primitives directly, or supply the position-lookup fields ' +
        '(protocol + chainId + nftId for NFTs, or protocol + chainId + vaultAddress + ownerAddress ' +
        'for vaults) to auto-fill them from the live position; any explicit primitive overrides ' +
        'wins over the resolved value, which lets you simulate hypotheticals (e.g. "what if my ' +
        'liquidity were 2× larger?", "what would the split look like if price dropped to X?").\n\n' +
        'Token amounts are dual-emitted: `token0Amount` / `token1Amount` are humanized display ' +
        'strings (only present when a position context was resolved); `token0AmountRaw` / ' +
        '`token1AmountRaw` are the bigint decimal strings in each token\'s smallest unit. ' +
        'Raw is canonical — use it for further computation; display is for narration/rendering. ' +
        'When a position context is resolved, a `pool` block is also emitted with chainId, ' +
        'poolAddress, pair, feeBps, feeTier, token0, token1.',
      inputSchema,
    },
    handler: async (args: Args) => {
      const ctx = hasPositionLookupArgs(args)
        ? await resolvePositionContext(client, args)
        : null;

      const liquidityRaw = args.liquidity ?? ctx?.position.liquidity;
      const tickLower = args.tickLower ?? ctx?.position.tickLower;
      const tickUpper = args.tickUpper ?? ctx?.position.tickUpper;
      const sqrtPriceRaw = args.sqrtPriceX96 ?? ctx?.pool.sqrtPriceX96;

      if (liquidityRaw === undefined)
        throw new Error('liquidity is required (pass directly or via positionHash lookup)');
      if (tickLower === undefined) throw new Error('tickLower is required');
      if (tickUpper === undefined) throw new Error('tickUpper is required');
      if (sqrtPriceRaw === undefined) throw new Error('sqrtPriceX96 is required');

      const liquidity = BigInt(liquidityRaw);
      const sqrtPriceX96 = BigInt(sqrtPriceRaw);

      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      const token0Raw = token0Amount.toString();
      const token1Raw = token1Amount.toString();

      const result = {
        pool: ctx
          ? {
              chainId: ctx.pool.chainId,
              poolAddress: ctx.pool.address,
              pair: `${ctx.baseToken.symbol}/${ctx.quoteToken.symbol}`,
              feeBps: ctx.feeBps,
              feeTier: `${(ctx.feeBps / 10_000).toFixed(2)}%`,
              token0: ctx.token0,
              token1: ctx.token1,
            }
          : null,
        token0Amount: ctx
          ? formatTokenAmount(token0Raw, ctx.token0.symbol, ctx.token0.decimals)
          : null,
        token0AmountRaw: token0Raw,
        token1Amount: ctx
          ? formatTokenAmount(token1Raw, ctx.token1.symbol, ctx.token1.decimals)
          : null,
        token1AmountRaw: token1Raw,
        inputsUsed: {
          liquidity: liquidity.toString(),
          tickLower,
          tickUpper,
          sqrtPriceX96: sqrtPriceX96.toString(),
          resolvedFromPosition: ctx?.positionHash ?? null,
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  };
}
