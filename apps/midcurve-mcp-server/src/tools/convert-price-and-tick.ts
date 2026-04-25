import { z } from 'zod';
import {
  formatTokenAmount,
  priceToClosestUsableTick,
  tickToPrice,
} from '@midcurve/shared';
import type { ApiClient } from '../api-client.js';
import {
  hasPositionLookupArgs,
  positionLookupInputSchema,
  resolvePositionContext,
} from '../lib/position-context.js';

const inputSchema = {
  ...positionLookupInputSchema,
  mode: z
    .enum(['price-to-tick', 'tick-to-price'])
    .describe('Direction of conversion.'),
  price: z
    .string()
    .optional()
    .describe(
      'Required when mode="price-to-tick". Price denominated as quote-per-base, scaled to ' +
        'baseTokenDecimals (raw bigint string).',
    ),
  tick: z
    .number()
    .int()
    .optional()
    .describe('Required when mode="tick-to-price". Tick value (signed integer).'),
  baseTokenAddress: z
    .string()
    .optional()
    .describe('Base token address. Falls back to the resolved position\'s base token address.'),
  quoteTokenAddress: z
    .string()
    .optional()
    .describe('Quote token address. Falls back to the resolved position\'s quote token address.'),
  baseTokenDecimals: z
    .number()
    .int()
    .optional()
    .describe('Base token decimals. Falls back to the resolved position\'s base token decimals.'),
  tickSpacing: z
    .number()
    .int()
    .optional()
    .describe(
      'Pool tick spacing (e.g. 10 for 0.05%, 60 for 0.3%, 200 for 1%). ' +
        'Required for mode="price-to-tick" — the result is always snapped to a usable tick. ' +
        'Falls back to the resolved pool\'s tickSpacing.',
    ),
};

type Args = { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> };

export function buildConvertPriceAndTickTool(client: ApiClient) {
  return {
    name: 'convert_price_and_tick',
    config: {
      title: 'Convert between prices and Uniswap V3 ticks',
      description:
        'Bidirectional converter between a quote-per-base price (scaled to baseTokenDecimals) and a ' +
        'Uniswap V3 tick. Use mode="price-to-tick" with snap=true to snap to a usable position-bound ' +
        'tick (multiple of the pool\'s tickSpacing). ' +
        'Either pass the token metadata explicitly, or supply the position-lookup fields to inherit ' +
        'addresses, baseTokenDecimals, and tickSpacing from a live position\'s pool.\n\n' +
        'In `tick-to-price` mode, the result is dual-emitted: `price` is a humanized display string ' +
        '(only present when a position context was resolved); `priceRaw` is the bigint decimal ' +
        'string scaled to quote-token decimals. Raw is canonical. ' +
        '`price-to-tick` mode returns `tick` as a single-emit integer (ticks are canonical per the ' +
        '§2 decision table — there is no separate raw form).',
      inputSchema,
    },
    handler: async (args: Args) => {
      const ctx = hasPositionLookupArgs(args)
        ? await resolvePositionContext(client, args)
        : null;

      const baseAddr = args.baseTokenAddress ?? ctx?.baseToken.address;
      const quoteAddr = args.quoteTokenAddress ?? ctx?.quoteToken.address;
      const baseDecimals = args.baseTokenDecimals ?? ctx?.baseToken.decimals;
      const tickSpacing = args.tickSpacing ?? ctx?.tickSpacing;

      if (!baseAddr) throw new Error('baseTokenAddress is required');
      if (!quoteAddr) throw new Error('quoteTokenAddress is required');
      if (baseDecimals === undefined) throw new Error('baseTokenDecimals is required');

      if (args.mode === 'price-to-tick') {
        if (!args.price) throw new Error('price is required when mode="price-to-tick"');
        if (tickSpacing === undefined) {
          throw new Error('tickSpacing is required when mode="price-to-tick"');
        }

        const price = BigInt(args.price);
        const tick = priceToClosestUsableTick(
          price,
          tickSpacing,
          baseAddr,
          quoteAddr,
          baseDecimals,
        );

        const result = {
          mode: 'price-to-tick',
          tick,
          inputsUsed: {
            price: price.toString(),
            baseTokenAddress: baseAddr,
            quoteTokenAddress: quoteAddr,
            baseTokenDecimals: baseDecimals,
            tickSpacing,
            resolvedFromPosition: ctx?.positionHash ?? null,
          },
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }

      // mode === 'tick-to-price'
      if (args.tick === undefined) throw new Error('tick is required when mode="tick-to-price"');

      const price = tickToPrice(args.tick, baseAddr, quoteAddr, baseDecimals);
      const priceRaw = price.toString();
      const priceDisplay = ctx
        ? formatTokenAmount(priceRaw, ctx.quoteToken.symbol, ctx.quoteToken.decimals)
        : null;

      const result = {
        mode: 'tick-to-price',
        price: priceDisplay,
        priceRaw,
        inputsUsed: {
          tick: args.tick,
          baseTokenAddress: baseAddr,
          quoteTokenAddress: quoteAddr,
          baseTokenDecimals: baseDecimals,
          resolvedFromPosition: ctx?.positionHash ?? null,
        },
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  };
}
