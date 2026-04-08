/**
 * Owner Wallet Utility
 *
 * Creates and parses ownerWallet strings for the Position model.
 * The ownerWallet format is: "{platform}:{address}"
 *
 * Supported formats:
 * - EVM: "evm:{checksumAddress}" → { platform: 'evm', address }
 * - Future: "solana:{pubkey}", "bitcoin:{address}"
 *
 * @example
 * ```typescript
 * const wallet = createEvmOwnerWallet('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
 * // "evm:0xAF88d065e77c8cC2239327C5EDb3A432268e5831"
 *
 * const parsed = parseOwnerWallet(wallet);
 * // { platform: 'evm', address: '0xAF88d065e77c8cC2239327C5EDb3A432268e5831' }
 * ```
 */

import { normalizeAddress } from './evm/address.js';

// ============================================================================
// TYPES
// ============================================================================

export interface EvmOwnerWalletData {
    platform: 'evm';
    address: string;
}

export interface UnknownOwnerWalletData {
    platform: string;
    address: string;
}

export type OwnerWalletData = EvmOwnerWalletData | UnknownOwnerWalletData;

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create an ownerWallet string for an EVM address.
 * Normalizes the address to EIP-55 checksum format.
 *
 * @param address - EVM address (any case)
 * @returns ownerWallet string in format "evm:{checksumAddress}"
 */
export function createEvmOwnerWallet(address: string): string {
    if (!address) {
        throw new Error('address is required for EVM owner wallet creation');
    }
    return `evm:${normalizeAddress(address)}`;
}

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse an ownerWallet string into its components.
 *
 * @param ownerWallet - ownerWallet string (e.g., "evm:0x...")
 * @returns Parsed components with platform and address
 */
export function parseOwnerWallet(ownerWallet: string): OwnerWalletData {
    const colonIndex = ownerWallet.indexOf(':');
    if (colonIndex === -1) {
        throw new Error(`Invalid ownerWallet format: ${ownerWallet} (expected "platform:address")`);
    }

    const platform = ownerWallet.slice(0, colonIndex);
    const address = ownerWallet.slice(colonIndex + 1);

    if (!platform || !address) {
        throw new Error(`Invalid ownerWallet format: ${ownerWallet} (empty platform or address)`);
    }

    return { platform, address } as OwnerWalletData;
}
