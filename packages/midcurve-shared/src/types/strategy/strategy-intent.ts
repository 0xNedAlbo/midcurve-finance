/**
 * Strategy Intent V1 Types
 *
 * Permission grant documents that define what automated strategies
 * can do on behalf of a user.
 */

import type { AllowedCurrency } from './allowed-currency.js';
import type { AllowedEffect } from './allowed-effect.js';
import type { StrategyEnvelope, StrategyType } from './strategy-envelope.js';

/**
 * Strategy Intent V1
 *
 * A permission grant document that authorizes an automated strategy
 * to perform specific operations on behalf of the user.
 *
 * @template T - Strategy type identifier for type-safe config access
 */
export interface StrategyIntentV1<T extends StrategyType = StrategyType> {
  /** Unique intent identifier (e.g., UUID or cuid) */
  id: string;
  /** Optional human-readable name */
  name?: string;
  /** Optional description of what this intent authorizes */
  description?: string;
  /** Tokens the strategy is allowed to interact with */
  allowedCurrencies: AllowedCurrency[];
  /** Contract calls the strategy is allowed to make */
  allowedEffects: AllowedEffect[];
  /** Strategy configuration */
  strategy: StrategyEnvelope<T>;
}

/**
 * Type alias for any strategy intent
 */
export type AnyStrategyIntent = StrategyIntentV1<StrategyType>;

/**
 * Signed Strategy Intent V1
 *
 * A strategy intent with EIP-712 signature for verification.
 */
export interface SignedStrategyIntentV1 {
  /** The strategy intent document */
  intent: StrategyIntentV1;
  /** EIP-712 signature (hex string) */
  signature: string;
  /** Signer's wallet address (EIP-55 checksummed) */
  signer: string;
}
