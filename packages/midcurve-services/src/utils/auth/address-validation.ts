/**
 * Address Validation Utilities
 *
 * Helper functions for validating and normalizing Ethereum addresses
 * and checking supported chain IDs.
 */

import { normalizeAddress, isValidAddress } from '@midcurve/shared';

/**
 * Supported EVM chain IDs
 */
export const SUPPORTED_CHAIN_IDS = [
  1, // Ethereum
  42161, // Arbitrum
  8453, // Base
  56, // BSC
  137, // Polygon
  10, // Optimism
] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/**
 * Chain names for error messages
 */
export const CHAIN_NAMES: Record<SupportedChainId, string> = {
  1: 'Ethereum',
  42161: 'Arbitrum',
  8453: 'Base',
  56: 'BSC',
  137: 'Polygon',
  10: 'Optimism',
};

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
  if (!SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId)) {
    throw new Error(
      `Unsupported chain ID: ${chainId}. Supported chains: ${SUPPORTED_CHAIN_IDS.map((id) => `${id} (${CHAIN_NAMES[id]})`).join(', ')}`
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
  return SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId);
}

/**
 * Environment variable names for WebSocket RPC URLs per chain.
 * Used to check if a chain has WebSocket monitoring configured.
 */
const WS_RPC_URL_ENV_VARS: Record<SupportedChainId, string> = {
  1: 'WS_RPC_URL_ETHEREUM',
  42161: 'WS_RPC_URL_ARBITRUM',
  8453: 'WS_RPC_URL_BASE',
  56: 'WS_RPC_URL_BSC',
  137: 'WS_RPC_URL_POLYGON',
  10: 'WS_RPC_URL_OPTIMISM',
};

/**
 * Check if a chain has WebSocket RPC configured via environment variable.
 * Required for onchain event subscriptions (balance watching, price feeds, etc.).
 *
 * @param chainId - Supported chain ID to check
 * @returns true if WS_RPC_URL_* env var is set for this chain
 */
export function isChainWssConfigured(chainId: SupportedChainId): boolean {
  const envVar = WS_RPC_URL_ENV_VARS[chainId];
  return !!process.env[envVar];
}
