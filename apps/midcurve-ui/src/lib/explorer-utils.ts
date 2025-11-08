/**
 * Block Explorer Utilities
 *
 * Provides functions for building block explorer URLs for different chains
 * and formatting transaction/block identifiers for display.
 */

/**
 * Mapping of chain IDs to their block explorer base URLs
 */
export const CHAIN_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io',
  42161: 'https://arbiscan.io',
  8453: 'https://basescan.org',
  56: 'https://bscscan.com',
  137: 'https://polygonscan.com',
  10: 'https://optimistic.etherscan.io',
};

/**
 * Get the block explorer base URL for a given chain ID
 *
 * @param chainId - The EVM chain ID
 * @returns The explorer base URL or undefined if chain is not supported
 */
export function getExplorerUrl(chainId: number): string | undefined {
  return CHAIN_EXPLORERS[chainId];
}

/**
 * Build a transaction URL for a given chain and transaction hash
 *
 * @param chainId - The EVM chain ID
 * @param txHash - The transaction hash (0x...)
 * @returns The full URL to the transaction on the block explorer, or '#' if chain is unsupported
 */
export function buildTxUrl(chainId: number, txHash: string): string {
  const explorer = getExplorerUrl(chainId);
  if (!explorer) return '#';
  return `${explorer}/tx/${txHash}`;
}

/**
 * Build a block URL for a given chain and block number
 *
 * @param chainId - The EVM chain ID
 * @param blockNumber - The block number (can be string or number)
 * @returns The full URL to the block on the block explorer, or '#' if chain is unsupported
 */
export function buildBlockUrl(chainId: number, blockNumber: string | number): string {
  const explorer = getExplorerUrl(chainId);
  if (!explorer) return '#';
  return `${explorer}/block/${blockNumber}`;
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
