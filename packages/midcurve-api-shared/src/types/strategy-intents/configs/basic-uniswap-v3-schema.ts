/**
 * BasicUniswapV3 Strategy Config Schema
 *
 * Zod validation schema for basicUniswapV3 strategy configuration.
 */

import { z } from 'zod';
import { ChainIdSchema, EvmAddressSchema } from '../common-schemas.js';

/**
 * BasicUniswapV3 strategy config schema
 */
export const BasicUniswapV3StrategyConfigSchema = z.object({
  chainId: ChainIdSchema,
  poolAddress: EvmAddressSchema,
  tickLower: z.number().int(),
  tickUpper: z.number().int(),
  isToken0Quote: z.boolean(),
  quoteTokenAmount: z.string().min(1),
});

export type ValidatedBasicUniswapV3StrategyConfig = z.infer<
  typeof BasicUniswapV3StrategyConfigSchema
>;
