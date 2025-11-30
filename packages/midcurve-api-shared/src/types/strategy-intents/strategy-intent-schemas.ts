/**
 * Strategy Intent V1 Zod Schemas
 *
 * Main validation schemas for strategy intent documents.
 */

import { z } from 'zod';
import { EvmAddressSchema, HexSchema } from './common-schemas.js';
import { AllowedCurrenciesSchema } from './allowed-currency-schemas.js';
import { AllowedEffectsSchema } from './allowed-effect-schemas.js';
import { validateStrategyConfig } from './strategy-config-registry.js';

/**
 * Strategy envelope schema (base)
 */
export const StrategyEnvelopeSchema = z.object({
  strategyType: z.string().min(1),
  config: z.unknown(),
});

/**
 * Strategy Intent V1 schema
 *
 * Validates the complete strategy intent document including
 * dynamic validation of strategy-specific config based on strategyType.
 */
export const StrategyIntentV1Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    allowedCurrencies: AllowedCurrenciesSchema,
    allowedEffects: AllowedEffectsSchema,
    strategy: StrategyEnvelopeSchema,
  })
  .superRefine((intent, ctx) => {
    // Validate strategy config using the registry
    const result = validateStrategyConfig(
      intent.strategy.strategyType,
      intent.strategy.config
    );

    if (!result.success) {
      result.error.issues.forEach((issue) => {
        ctx.addIssue({
          ...issue,
          path: ['strategy', 'config', ...issue.path],
        });
      });
    }
  });

/**
 * Signed Strategy Intent V1 schema
 *
 * Validates a strategy intent with EIP-712 signature.
 */
export const SignedStrategyIntentV1Schema = z.object({
  intent: StrategyIntentV1Schema,
  signature: HexSchema,
  signer: EvmAddressSchema,
});

// Type exports
export type ValidatedStrategyEnvelope = z.infer<typeof StrategyEnvelopeSchema>;
export type ValidatedStrategyIntentV1 = z.infer<typeof StrategyIntentV1Schema>;
export type ValidatedSignedStrategyIntentV1 = z.infer<
  typeof SignedStrategyIntentV1Schema
>;
