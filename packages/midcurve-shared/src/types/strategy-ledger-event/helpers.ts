/**
 * Token Hash Helpers
 *
 * Utilities for creating and parsing token hash strings.
 * Token hashes provide a human-readable identifier for tokens.
 */

/**
 * Token hash components
 */
export interface TokenHashComponents {
  tokenType: string;
  chainId: number;
  address: string;
}

/**
 * Create a token hash from components
 *
 * Format: "{tokenType}:{chainId}:{address}"
 *
 * @example
 * makeTokenHash('erc20', 1, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
 * // Returns: "erc20:1:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
 */
export function makeTokenHash(tokenType: string, chainId: number, address: string): string {
  return `${tokenType}:${chainId}:${address}`;
}

/**
 * Parse a token hash into components
 *
 * @throws Error if hash format is invalid
 *
 * @example
 * parseTokenHash('erc20:1:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
 * // Returns: { tokenType: 'erc20', chainId: 1, address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }
 */
export function parseTokenHash(hash: string): TokenHashComponents {
  const parts = hash.split(':');
  if (parts.length !== 3) {
    throw new Error(`Invalid token hash format: ${hash}. Expected "tokenType:chainId:address"`);
  }

  const tokenType = parts[0]!;
  const chainIdStr = parts[1]!;
  const address = parts[2]!;
  const chainId = parseInt(chainIdStr, 10);

  if (isNaN(chainId)) {
    throw new Error(`Invalid chain ID in token hash: ${chainIdStr}`);
  }

  return { tokenType, chainId, address };
}

/**
 * Check if a string is a valid token hash format
 */
export function isValidTokenHash(hash: string): boolean {
  try {
    parseTokenHash(hash);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract the chain ID from a token hash
 */
export function getChainIdFromTokenHash(hash: string): number {
  return parseTokenHash(hash).chainId;
}

/**
 * Extract the address from a token hash
 */
export function getAddressFromTokenHash(hash: string): string {
  return parseTokenHash(hash).address;
}

/**
 * Extract the token type from a token hash
 */
export function getTokenTypeFromTokenHash(hash: string): string {
  return parseTokenHash(hash).tokenType;
}
