/**
 * Block Explorer Utilities
 *
 * Provides functions for building block explorer URLs for different chains
 * and formatting transaction/block identifiers for display.
 *
 * Explorer URLs and URL builders are delegated to the centralized chain registry
 * in @midcurve/shared. This file re-exports them and adds display formatting.
 */

import {
  getExplorerBaseUrl,
  buildTxUrl as registryBuildTxUrl,
  buildBlockUrl as registryBuildBlockUrl,
  buildAddressUrl as registryBuildAddressUrl,
} from '@midcurve/shared';

/**
 * Get the block explorer base URL for a given chain ID
 * Delegates to centralized chain registry.
 */
export function getExplorerUrl(chainId: number): string | undefined {
  return getExplorerBaseUrl(chainId);
}

/**
 * Build a transaction URL for a given chain and transaction hash
 * Delegates to centralized chain registry.
 */
export function buildTxUrl(chainId: number, txHash: string): string {
  return registryBuildTxUrl(chainId, txHash);
}

/**
 * Build a block URL for a given chain and block number
 * Delegates to centralized chain registry.
 */
export function buildBlockUrl(chainId: number, blockNumber: string | number): string {
  return registryBuildBlockUrl(chainId, blockNumber);
}

/**
 * Build an address URL for a given chain and address
 * Delegates to centralized chain registry.
 */
export function buildAddressUrl(chainId: number, address: string): string {
  return registryBuildAddressUrl(chainId, address);
}

/**
 * Truncate a transaction hash for display
 * Format: 0x142dc6...5d25eb (first 6 chars + last 6 chars after 0x)
 *
 * @param hash - The full transaction hash
 * @returns Truncated hash or original if too short
 */
export function truncateTxHash(hash: string): string {
  if (!hash || hash.length < 14) return hash;

  // Handle 0x prefix
  const withoutPrefix = hash.startsWith('0x') ? hash.slice(2) : hash;

  if (withoutPrefix.length <= 12) return hash;

  const start = withoutPrefix.slice(0, 6);
  const end = withoutPrefix.slice(-6);

  return `0x${start}...${end}`;
}

/**
 * Format a block number with thousands separators
 * Example: 395346632 → "395,346,632"
 *
 * @param blockNumber - The block number as string or number
 * @returns Formatted string with thousands separators
 */
export function formatBlockNumber(blockNumber: string | number): string {
  const num = typeof blockNumber === 'string' ? parseInt(blockNumber, 10) : blockNumber;

  if (isNaN(num)) return String(blockNumber);

  return num.toLocaleString('en-US');
}
