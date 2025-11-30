/**
 * Intent Zod Schemas
 *
 * Runtime validation schemas for intent types.
 */

import { z } from 'zod';

/**
 * Ethereum address schema
 */
const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

/**
 * Hex string schema
 */
const HexSchema = z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid hex string');

/**
 * Intent type enum schema
 */
export const IntentTypeSchema = z.enum([
  'close-position',
  'hedge-position',
  'collect-fees',
  'rebalance-position',
  'test-wallet',
]);

/**
 * Base intent schema
 */
export const BaseIntentSchema = z.object({
  intentType: IntentTypeSchema,
  signer: AddressSchema,
  chainId: z.number().int().positive(),
  nonce: z.string().min(1),
  signedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * Close position intent schema
 */
export const ClosePositionIntentSchema = BaseIntentSchema.extend({
  intentType: z.literal('close-position'),
  positionNftId: z.string().min(1),
  priceTrigger: z
    .object({
      direction: z.enum(['below', 'above']),
      price: z.string(),
      quoteToken: z.string(),
    })
    .optional(),
});

/**
 * Hedge position intent schema
 */
export const HedgePositionIntentSchema = BaseIntentSchema.extend({
  intentType: z.literal('hedge-position'),
  positionNftId: z.string().min(1),
  hedgePlatform: z.string().min(1),
  hedgeRatio: z.string(),
  maxDeviation: z.string(),
});

/**
 * Collect fees intent schema
 */
export const CollectFeesIntentSchema = BaseIntentSchema.extend({
  intentType: z.literal('collect-fees'),
  positionNftId: z.string().min(1),
  minFeesUsd: z.string().optional(),
  recipient: AddressSchema,
});

/**
 * Rebalance position intent schema
 */
export const RebalancePositionIntentSchema = BaseIntentSchema.extend({
  intentType: z.literal('rebalance-position'),
  positionNftId: z.string().min(1),
  newTickLower: z.number().int().optional(),
  newTickUpper: z.number().int().optional(),
  trigger: z
    .object({
      priceDeviationPercent: z.string().optional(),
      outOfRangeDuration: z.number().int().positive().optional(),
    })
    .optional(),
});

/**
 * Test wallet intent schema
 */
export const TestWalletIntentSchema = BaseIntentSchema.extend({
  intentType: z.literal('test-wallet'),
  message: z.string().min(1),
});

/**
 * Union of all intent schemas (discriminated by intentType)
 */
export const IntentSchema = z.discriminatedUnion('intentType', [
  ClosePositionIntentSchema,
  HedgePositionIntentSchema,
  CollectFeesIntentSchema,
  RebalancePositionIntentSchema,
  TestWalletIntentSchema,
]);

/**
 * Signed intent schema
 */
export const SignedIntentSchema = z.object({
  intent: IntentSchema,
  signature: HexSchema,
});

/**
 * Type exports inferred from schemas
 */
export type IntentTypeEnum = z.infer<typeof IntentTypeSchema>;
export type ValidatedIntent = z.infer<typeof IntentSchema>;
export type ValidatedSignedIntent = z.infer<typeof SignedIntentSchema>;
