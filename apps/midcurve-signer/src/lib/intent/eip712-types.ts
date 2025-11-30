/**
 * EIP-712 Type Definitions for StrategyIntentV1
 *
 * Defines the structured data types for signing strategy intents according to EIP-712.
 * These types must match what the frontend uses for signing.
 */

import type { TypedDataDomain } from 'viem';
import type { Address } from 'viem';

/**
 * EIP-712 domain name for strategy intents
 */
export const STRATEGY_INTENT_EIP712_DOMAIN_NAME = 'Midcurve Strategy Intent';

/**
 * EIP-712 domain version
 */
export const STRATEGY_INTENT_EIP712_DOMAIN_VERSION = '1';

/**
 * Contract address used as verifyingContract in the EIP-712 domain.
 * This is a sentinel value since we're not using a contract.
 */
export const STRATEGY_INTENT_VERIFYING_CONTRACT: Address =
  '0x0000000000000000000000000000000000000001';

/**
 * Create the EIP-712 domain for strategy intent signing
 */
export function createStrategyIntentDomain(chainId: number): TypedDataDomain {
  return {
    name: STRATEGY_INTENT_EIP712_DOMAIN_NAME,
    version: STRATEGY_INTENT_EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: STRATEGY_INTENT_VERIFYING_CONTRACT,
  };
}

/**
 * EIP-712 type definitions for StrategyIntentV1
 *
 * Uses native EIP-712 arrays for allowedCurrencies and allowedEffects.
 * Discriminated unions are flattened (all possible fields present).
 * Strategy config is hashed because it varies by strategyType.
 */
export const StrategyIntentV1Types = {
  AllowedCurrency: [
    { name: 'currencyType', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'address', type: 'address' },
    { name: 'symbol', type: 'string' },
  ],
  AllowedEffect: [
    { name: 'effectType', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'contractAddress', type: 'address' },
    { name: 'functionSelector', type: 'bytes4' },
  ],
  StrategyEnvelope: [
    { name: 'strategyType', type: 'string' },
    { name: 'configHash', type: 'bytes32' },
  ],
  StrategyIntentV1: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'allowedCurrencies', type: 'AllowedCurrency[]' },
    { name: 'allowedEffects', type: 'AllowedEffect[]' },
    { name: 'strategy', type: 'StrategyEnvelope' },
  ],
} as const;

/**
 * Primary type name for StrategyIntentV1
 */
export const STRATEGY_INTENT_PRIMARY_TYPE = 'StrategyIntentV1';
