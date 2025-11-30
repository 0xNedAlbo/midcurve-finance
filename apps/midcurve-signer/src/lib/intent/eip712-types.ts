/**
 * EIP-712 Type Definitions for Intents
 *
 * Defines the structured data types for signing intents according to EIP-712.
 * These types must match what the frontend uses for signing.
 */

import type { TypedDataDomain } from 'viem';
import type { Address } from 'viem';
import {
  INTENT_EIP712_DOMAIN_NAME,
  INTENT_EIP712_DOMAIN_VERSION,
} from '@midcurve/api-shared';

/**
 * Contract address used as verifyingContract in the EIP-712 domain.
 * In our case, this is a sentinel value since we're not using a contract.
 */
export const INTENT_VERIFYING_CONTRACT: Address = '0x0000000000000000000000000000000000000001';

/**
 * Create the EIP-712 domain for intent signing
 */
export function createIntentDomain(chainId: number): TypedDataDomain {
  return {
    name: INTENT_EIP712_DOMAIN_NAME,
    version: INTENT_EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: INTENT_VERIFYING_CONTRACT,
  };
}

/**
 * EIP-712 types for the base intent structure
 * Note: Each intent type extends these base fields
 */
export const BaseIntentTypes = {
  BaseIntent: [
    { name: 'intentType', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'string' },
    { name: 'signedAt', type: 'string' },
  ],
} as const;

/**
 * EIP-712 types for ClosePositionIntent
 */
export const ClosePositionIntentTypes = {
  ClosePositionIntent: [
    { name: 'intentType', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'string' },
    { name: 'signedAt', type: 'string' },
    { name: 'positionNftId', type: 'string' },
  ],
} as const;

/**
 * EIP-712 types for HedgePositionIntent
 */
export const HedgePositionIntentTypes = {
  HedgePositionIntent: [
    { name: 'intentType', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'string' },
    { name: 'signedAt', type: 'string' },
    { name: 'positionNftId', type: 'string' },
    { name: 'hedgePlatform', type: 'string' },
    { name: 'hedgeRatio', type: 'string' },
    { name: 'maxDeviation', type: 'string' },
  ],
} as const;

/**
 * EIP-712 types for CollectFeesIntent
 */
export const CollectFeesIntentTypes = {
  CollectFeesIntent: [
    { name: 'intentType', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'string' },
    { name: 'signedAt', type: 'string' },
    { name: 'positionNftId', type: 'string' },
    { name: 'recipient', type: 'address' },
  ],
} as const;

/**
 * EIP-712 types for RebalancePositionIntent
 */
export const RebalancePositionIntentTypes = {
  RebalancePositionIntent: [
    { name: 'intentType', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'string' },
    { name: 'signedAt', type: 'string' },
    { name: 'positionNftId', type: 'string' },
  ],
} as const;

/**
 * EIP-712 types for TestWalletIntent
 */
export const TestWalletIntentTypes = {
  TestWalletIntent: [
    { name: 'intentType', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'string' },
    { name: 'signedAt', type: 'string' },
    { name: 'message', type: 'string' },
  ],
} as const;

/**
 * Map intent type to its EIP-712 type definition
 */
export const INTENT_TYPE_DEFINITIONS = {
  'close-position': ClosePositionIntentTypes,
  'hedge-position': HedgePositionIntentTypes,
  'collect-fees': CollectFeesIntentTypes,
  'rebalance-position': RebalancePositionIntentTypes,
  'test-wallet': TestWalletIntentTypes,
} as const;

/**
 * Map intent type to its primary type name
 */
export const INTENT_PRIMARY_TYPES = {
  'close-position': 'ClosePositionIntent',
  'hedge-position': 'HedgePositionIntent',
  'collect-fees': 'CollectFeesIntent',
  'rebalance-position': 'RebalancePositionIntent',
  'test-wallet': 'TestWalletIntent',
} as const;
