/**
 * EVM Utilities
 *
 * Helper functions for working with Ethereum addresses and blockchain explorers.
 */

import type { EvmChainSlug } from '@/config/chains';
import { CHAIN_METADATA } from '@/config/chains';

/**
 * Truncate an Ethereum address to a shortened format
 * @param address - Full Ethereum address (0x...)
 * @param startChars - Number of characters to show at start (default: 6)
 * @param endChars - Number of characters to show at end (default: 4)
 * @returns Truncated address (e.g., "0xC02a...56Cc2")
 */
export function truncateAddress(
  address: string,
  startChars = 6,
  endChars = 4
): string {
  if (!address || address.length < startChars + endChars) {
    return address;
  }

  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Truncate any text to a maximum length
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: 20)
 * @returns Truncated text with ellipsis if needed
 */
export function truncateText(text: string, maxLength = 20): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Get block explorer URL for a specific address
 * @param address - Ethereum address
 * @param chain - Chain slug (ethereum, arbitrum, etc.)
 * @returns Full URL to the address page on the block explorer
 */
export function getExplorerAddressUrl(
  address: string,
  chain: EvmChainSlug
): string {
  const chainMetadata = CHAIN_METADATA[chain];

  if (!chainMetadata) {
    // Fallback to Etherscan if chain not found
    return `https://etherscan.io/address/${address}`;
  }

  return `${chainMetadata.explorer}/address/${address}`;
}

/**
 * Get block explorer URL for a specific transaction
 * @param txHash - Transaction hash
 * @param chain - Chain slug (ethereum, arbitrum, etc.)
 * @returns Full URL to the transaction page on the block explorer
 */
export function getExplorerTxUrl(txHash: string, chain: EvmChainSlug): string {
  const chainMetadata = CHAIN_METADATA[chain];

  if (!chainMetadata) {
    // Fallback to Etherscan if chain not found
    return `https://etherscan.io/tx/${txHash}`;
  }

  return `${chainMetadata.explorer}/tx/${txHash}`;
}

/**
 * Check if a string is a valid Ethereum address format
 * @param address - String to validate
 * @returns true if valid address format (0x followed by 40 hex characters)
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Compare two Ethereum addresses (case-insensitive)
 * @param address1 - First address
 * @param address2 - Second address
 * @returns true if addresses are equal (case-insensitive)
 */
export function areAddressesEqual(
  address1: string,
  address2: string
): boolean {
  return address1.toLowerCase() === address2.toLowerCase();
}
