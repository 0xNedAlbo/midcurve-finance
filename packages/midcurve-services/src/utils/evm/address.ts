/**
 * EVM Address Utilities
 * Single source of truth for all EVM address operations
 */

import { getAddress } from 'viem';

/**
 * Validates if an address is a proper Ethereum address format
 *
 * @param address - The address to validate
 * @returns true if the address is valid (0x followed by 40 hex characters)
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/i.test(address);
}

/**
 * Normalize address to EIP-55 checksum format
 * Uses viem's getAddress() for proper checksumming
 *
 * @param address - The address to normalize
 * @returns The checksummed address in EIP-55 format
 * @throws Error if the address is invalid
 */
export function normalizeAddress(address: string): string {
  if (!isValidAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }
  return getAddress(address);
}

/**
 * Compare two addresses for deterministic ordering
 * Normalizes both addresses to ensure consistent comparison
 *
 * @param addressA - First address
 * @param addressB - Second address
 * @returns -1 if A < B, 0 if A === B, 1 if A > B
 */
export function compareAddresses(addressA: string, addressB: string): number {
  const normalizedA = normalizeAddress(addressA);
  const normalizedB = normalizeAddress(addressB);

  // Use BigInt comparison for deterministic numerical ordering
  const bigintA = BigInt(normalizedA);
  const bigintB = BigInt(normalizedB);

  if (bigintA < bigintB) return -1;
  if (bigintA > bigintB) return 1;
  return 0;
}
