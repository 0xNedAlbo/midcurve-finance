/**
 * Intent Compliance Checker
 *
 * Verifies that a requested operation is allowed by the user's signed strategy intent.
 * This is a CRITICAL security check - operations not explicitly permitted must be rejected.
 */

import type { StrategyIntentV1 } from '@midcurve/shared';
import { isErc20Currency, isEvmContractCallEffect } from '@midcurve/shared';

/**
 * Operation to check against intent permissions
 */
export interface OperationToCheck {
  /** Chain ID where the operation will execute */
  chainId: number;
  /** Target contract address */
  contractAddress: string;
  /** 4-byte function selector (0x prefixed) */
  functionSelector: string;
}

/**
 * Result of compliance check
 */
export interface ComplianceCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for rejection (if not allowed) */
  reason?: string;
  /** Error code for API responses */
  errorCode?: string;
}

/**
 * Well-known ERC-20 function selectors
 */
export const ERC20_SELECTORS = {
  /** approve(address,uint256) */
  APPROVE: '0x095ea7b3',
  /** transfer(address,uint256) */
  TRANSFER: '0xa9059cbb',
  /** transferFrom(address,address,uint256) */
  TRANSFER_FROM: '0x23b872dd',
} as const;

/**
 * Check if an operation is allowed by the user's strategy intent
 *
 * This function verifies:
 * 1. The target token/contract is in allowedCurrencies (for token operations)
 * 2. The function selector is in allowedEffects for that contract
 *
 * @param intent - The user's verified strategy intent
 * @param operation - The operation to check
 * @returns Compliance check result
 */
export function checkIntentCompliance(
  intent: StrategyIntentV1,
  operation: OperationToCheck
): ComplianceCheckResult {
  const { chainId, contractAddress, functionSelector } = operation;
  const normalizedAddress = contractAddress.toLowerCase();
  const normalizedSelector = functionSelector.toLowerCase();

  // 1. Check if the contract is in allowedCurrencies (for ERC-20 operations)
  // This verifies the user intended to interact with this specific token
  const currencyAllowed = intent.allowedCurrencies.some((currency) => {
    if (!isErc20Currency(currency)) {
      return false;
    }
    return (
      currency.chainId === chainId &&
      currency.address.toLowerCase() === normalizedAddress
    );
  });

  if (!currencyAllowed) {
    return {
      allowed: false,
      reason: `Token ${contractAddress} on chain ${chainId} is not in allowedCurrencies`,
      errorCode: 'TOKEN_NOT_ALLOWED',
    };
  }

  // 2. Check if the function call is in allowedEffects
  // This verifies the user permitted this specific function on this contract
  const effectAllowed = intent.allowedEffects.some((effect) => {
    if (!isEvmContractCallEffect(effect)) {
      return false;
    }
    return (
      effect.chainId === chainId &&
      effect.address.toLowerCase() === normalizedAddress &&
      effect.selector.toLowerCase() === normalizedSelector
    );
  });

  if (!effectAllowed) {
    return {
      allowed: false,
      reason: `Function ${functionSelector} on ${contractAddress} is not in allowedEffects`,
      errorCode: 'EFFECT_NOT_ALLOWED',
    };
  }

  return { allowed: true };
}

/**
 * Check if an ERC-20 approve operation is allowed
 *
 * Convenience wrapper for approve operations.
 *
 * @param intent - The user's verified strategy intent
 * @param chainId - Chain ID
 * @param tokenAddress - ERC-20 token address
 * @returns Compliance check result
 */
export function checkErc20ApproveCompliance(
  intent: StrategyIntentV1,
  chainId: number,
  tokenAddress: string
): ComplianceCheckResult {
  return checkIntentCompliance(intent, {
    chainId,
    contractAddress: tokenAddress,
    functionSelector: ERC20_SELECTORS.APPROVE,
  });
}

/**
 * Check if an ERC-20 transfer operation is allowed
 *
 * @param intent - The user's verified strategy intent
 * @param chainId - Chain ID
 * @param tokenAddress - ERC-20 token address
 * @returns Compliance check result
 */
export function checkErc20TransferCompliance(
  intent: StrategyIntentV1,
  chainId: number,
  tokenAddress: string
): ComplianceCheckResult {
  return checkIntentCompliance(intent, {
    chainId,
    contractAddress: tokenAddress,
    functionSelector: ERC20_SELECTORS.TRANSFER,
  });
}
