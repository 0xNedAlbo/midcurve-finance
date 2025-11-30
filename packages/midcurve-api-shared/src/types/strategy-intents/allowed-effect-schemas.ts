/**
 * Allowed Effect Zod Schemas
 *
 * Validation schemas for strategy intent effect permissions.
 */

import { z } from 'zod';
import {
  EvmAddressSchema,
  ChainIdSchema,
  FunctionSelectorSchema,
} from './common-schemas.js';

/**
 * EVM contract call effect schema
 */
export const EvmContractCallEffectSchema = z.object({
  effectType: z.literal('evmContractCall'),
  chainId: ChainIdSchema,
  address: EvmAddressSchema,
  selector: FunctionSelectorSchema,
  contractName: z.string().min(1).optional(),
});

/**
 * Allowed effect schema (discriminated union)
 *
 * Currently only supports evmContractCall.
 * When adding more effect types, convert to z.discriminatedUnion:
 *
 * export const AllowedEffectSchema = z.discriminatedUnion('effectType', [
 *   EvmContractCallEffectSchema,
 *   EvmSendEthEffectSchema,
 * ]);
 */
export const AllowedEffectSchema = EvmContractCallEffectSchema;

/**
 * Array of allowed effects
 */
export const AllowedEffectsSchema = z.array(AllowedEffectSchema);

// Type exports
export type ValidatedEvmContractCallEffect = z.infer<
  typeof EvmContractCallEffectSchema
>;
export type ValidatedAllowedEffect = z.infer<typeof AllowedEffectSchema>;
export type ValidatedAllowedEffects = z.infer<typeof AllowedEffectsSchema>;
