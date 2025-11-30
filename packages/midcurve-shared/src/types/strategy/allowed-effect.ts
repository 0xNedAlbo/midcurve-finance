/**
 * Allowed Effect Types for Strategy Intents
 *
 * Defines which contract interactions a strategy is permitted to perform.
 * Uses discriminated union pattern for extensibility.
 */

/**
 * Discriminator for allowed effect types
 */
export type AllowedEffectType = 'evmContractCall';

/**
 * EVM Contract Call Permission
 *
 * Grants permission to call a specific function on a specific contract.
 */
export interface EvmContractCallEffect {
  effectType: 'evmContractCall';
  /** Chain ID where the contract exists */
  chainId: number;
  /** Contract address (EIP-55 checksummed) */
  address: string;
  /** 4-byte function selector (0x prefixed, e.g., '0xa9059cbb' for ERC-20 transfer) */
  selector: string;
  /** Optional human-readable contract name for display purposes */
  contractName?: string;
}

/**
 * Union of all allowed effect types
 *
 * Extensible for future effect types (e.g., 'evmSendEth', 'hyperliquidOrder')
 */
export type AllowedEffect = EvmContractCallEffect;

// ============================================================
// Type Guards
// ============================================================

/**
 * Type guard for EVM contract call effect
 */
export function isEvmContractCallEffect(
  effect: AllowedEffect
): effect is EvmContractCallEffect {
  return effect.effectType === 'evmContractCall';
}
