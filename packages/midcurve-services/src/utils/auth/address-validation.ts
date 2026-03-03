/**
 * Address Validation Utilities
 *
 * Helper functions for validating and normalizing Ethereum addresses
 * and checking supported chain IDs.
 */

import {
  normalizeAddress,
  isValidAddress,
  PRODUCTION_CHAIN_IDS as REGISTRY_PRODUCTION_CHAIN_IDS,
  ALL_CHAIN_IDS,
  getChainShortName,
  getWsRpcEnvVarName,
} from '@midcurve/shared';

/**
 * Supported EVM chain IDs
 *
 * Local chain (31337) is only available in non-production environments.
 * Derived from centralized chain registry in @midcurve/shared.
 */
export const SUPPORTED_CHAIN_IDS =
  process.env.NODE_ENV === 'production'
    ? REGISTRY_PRODUCTION_CHAIN_IDS
    : ALL_CHAIN_IDS;

export type SupportedChainId = 1 | 42161 | 8453 | 31337;

/**
 * Validate and normalize Ethereum address
 *
 * @param address - Address to validate and normalize
 * @returns Normalized address (EIP-55 checksum format)
 * @throws Error if address is invalid
 *
 * @example
 * ```typescript
 * const normalized = validateAndNormalizeAddress('0xa0b8...');
 * // Returns: '0xA0b8...' (EIP-55 format)
 * ```
 */
export function validateAndNormalizeAddress(address: string): string {
  if (!isValidAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }

  return normalizeAddress(address);
}

/**
 * Validate chainId is a supported EVM chain
 *
 * @param chainId - Chain ID to validate
 * @throws Error if chain ID is not supported
 *
 * @example
 * ```typescript
 * validateChainId(1); // OK
 * validateChainId(999); // Throws error
 * ```
 */
export function validateChainId(chainId: number): asserts chainId is SupportedChainId {
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
    throw new Error(
      `Unsupported chain ID: ${chainId}. Supported chains: ${SUPPORTED_CHAIN_IDS.map((id) => `${id} (${getChainShortName(id)})`).join(', ')}`
    );
  }
}

/**
 * Check if chainId is supported (non-throwing)
 *
 * @param chainId - Chain ID to check
 * @returns true if supported, false otherwise
 */
export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return SUPPORTED_CHAIN_IDS.includes(chainId);
}

/**
 * Check if a chain has WebSocket RPC configured via environment variable.
 * Required for onchain event subscriptions (balance watching, price feeds, etc.).
 *
 * @param chainId - Supported chain ID to check
 * @returns true if WS_RPC_URL_* env var is set for this chain
 */
export function isChainWssConfigured(chainId: SupportedChainId): boolean {
  const envVar = getWsRpcEnvVarName(chainId);
  return !!process.env[envVar];
}
