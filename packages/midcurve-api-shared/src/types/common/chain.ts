/**
 * Chain-related Types and Schemas
 *
 * Common validation schemas for blockchain chain identifiers.
 */

import { z } from 'zod';

/**
 * Zod schema for validating chain IDs
 *
 * Accepts:
 * - Numbers directly (e.g., 1, 137, 42161)
 * - Strings that parse to positive integers (e.g., "1", "137")
 *
 * Validates:
 * - Must be a positive integer
 * - Must be within valid range (1 to MAX_SAFE_INTEGER)
 *
 * @example
 * ```typescript
 * // In a request schema
 * const schema = z.object({
 *   chainId: ChainIdSchema,
 * });
 *
 * schema.parse({ chainId: 1 });       // ✅ { chainId: 1 }
 * schema.parse({ chainId: "137" });   // ✅ { chainId: 137 }
 * schema.parse({ chainId: -1 });      // ❌ throws
 * schema.parse({ chainId: "abc" });   // ❌ throws
 * ```
 */
export const ChainIdSchema = z.coerce
  .number()
  .int('chainId must be an integer')
  .positive('chainId must be a positive integer')
  .max(Number.MAX_SAFE_INTEGER, 'chainId exceeds maximum value');

/**
 * Type for a validated chain ID
 */
export type ChainId = z.infer<typeof ChainIdSchema>;

/**
 * Commonly supported EVM chain IDs
 *
 * Note: This is informational only, not used for validation.
 * The actual supported chains are determined by the backend configuration.
 */
export const COMMON_CHAIN_IDS = {
  ETHEREUM: 1,
  OPTIMISM: 10,
  BSC: 56,
  POLYGON: 137,
  ARBITRUM: 42161,
  BASE: 8453,
} as const;

/**
 * Type for common chain ID values
 */
export type CommonChainId = (typeof COMMON_CHAIN_IDS)[keyof typeof COMMON_CHAIN_IDS];
