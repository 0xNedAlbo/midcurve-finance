/**
 * Allowed Currency Zod Schemas
 *
 * Validation schemas for strategy intent currency permissions.
 */

import { z } from 'zod';
import { EvmAddressSchema, ChainIdSchema } from './common-schemas.js';

/**
 * ERC-20 allowed currency schema
 */
export const Erc20AllowedCurrencySchema = z.object({
  currencyType: z.literal('erc20'),
  chainId: ChainIdSchema,
  address: EvmAddressSchema,
  symbol: z.string().min(1),
});

/**
 * Native EVM currency schema
 */
export const EvmNativeAllowedCurrencySchema = z.object({
  currencyType: z.literal('evmNative'),
  chainId: ChainIdSchema,
  symbol: z.string().min(1),
});

/**
 * Discriminated union of allowed currency types
 */
export const AllowedCurrencySchema = z.discriminatedUnion('currencyType', [
  Erc20AllowedCurrencySchema,
  EvmNativeAllowedCurrencySchema,
]);

/**
 * Array of allowed currencies with duplicate check
 */
export const AllowedCurrenciesSchema = z
  .array(AllowedCurrencySchema)
  .superRefine((currencies, ctx) => {
    const seen = new Set<string>();

    currencies.forEach((c, i) => {
      const key =
        c.currencyType === 'erc20'
          ? `erc20:${c.chainId}:${c.address.toLowerCase()}`
          : `evmNative:${c.chainId}:${c.symbol.toUpperCase()}`;

      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate currency in allowedCurrencies',
          path: [i],
        });
      } else {
        seen.add(key);
      }
    });
  });

// Type exports
export type ValidatedErc20AllowedCurrency = z.infer<
  typeof Erc20AllowedCurrencySchema
>;
export type ValidatedEvmNativeAllowedCurrency = z.infer<
  typeof EvmNativeAllowedCurrencySchema
>;
export type ValidatedAllowedCurrency = z.infer<typeof AllowedCurrencySchema>;
export type ValidatedAllowedCurrencies = z.infer<
  typeof AllowedCurrenciesSchema
>;
