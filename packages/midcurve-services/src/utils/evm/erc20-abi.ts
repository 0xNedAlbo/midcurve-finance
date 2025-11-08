/**
 * ERC-20 Token ABI
 *
 * Minimal ABI definition for reading ERC-20 token metadata.
 * Includes only the functions needed for token discovery:
 * - name() - Token name
 * - symbol() - Token symbol
 * - decimals() - Token decimals
 */

/**
 * Minimal ERC-20 ABI for metadata functions
 * Type-safe with viem's ABI format
 */
export const erc20Abi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const;

/**
 * Type for ERC-20 token metadata
 */
export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}
