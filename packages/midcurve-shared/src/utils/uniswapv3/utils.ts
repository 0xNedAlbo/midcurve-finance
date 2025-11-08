/**
 * Utility functions for Uniswap V3 calculations
 * Pure helper functions without dependencies on custom data structures
 */

import {
  compareAddresses,
  normalizeAddress,
} from '../evm/index.js';

/**
 * Check if two addresses are the same (case-insensitive)
 */
export function sameAddress(a: string, b: string): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

/**
 * Determine if addressA is token0 (lower address in Uniswap V3 ordering)
 * @param addressA First token address
 * @param addressB Second token address
 * @returns true if addressA < addressB
 */
export function isToken0(addressA: string, addressB: string): boolean {
  return compareAddresses(addressA, addressB) < 0;
}

/**
 * Sort two token addresses according to Uniswap V3 convention
 * @param tokenA First token data
 * @param tokenB Second token data
 * @returns Sorted tokens as {token0, token1}
 */
export function sortTokens<T extends { address: string }>(
  tokenA: T,
  tokenB: T
): { token0: T; token1: T } {
  if (isToken0(tokenA.address, tokenB.address)) {
    return { token0: tokenA, token1: tokenB };
  } else {
    return { token0: tokenB, token1: tokenA };
  }
}

/**
 * Determine which token is base and which is quote from token0/token1
 * @param token0Address Address of token0 (lower address)
 * @param token1Address Address of token1 (higher address)
 * @param baseTokenAddress Address of the base token
 * @param quoteTokenAddress Address of the quote token
 * @returns Object indicating which token is token0 and which is base
 */
export function getTokenMapping(
  token0Address: string,
  token1Address: string,
  baseTokenAddress: string,
  quoteTokenAddress: string
): {
  baseIsToken0: boolean;
  quoteIsToken0: boolean;
} {
  const baseIsToken0 = sameAddress(baseTokenAddress, token0Address);
  const quoteIsToken0 = sameAddress(quoteTokenAddress, token0Address);

  // Validation
  if (baseIsToken0 && quoteIsToken0) {
    throw new Error('Base and quote cannot be the same token');
  }
  if (!baseIsToken0 && !sameAddress(baseTokenAddress, token1Address)) {
    throw new Error('Base token must be token0 or token1');
  }
  if (!quoteIsToken0 && !sameAddress(quoteTokenAddress, token1Address)) {
    throw new Error('Quote token must be token0 or token1');
  }

  return { baseIsToken0, quoteIsToken0 };
}

/**
 * Get tick spacing for a given fee tier
 * @param fee Fee in basis points (100, 500, 3000, 10000)
 * @returns Tick spacing
 */
export function getTickSpacing(fee: number): number {
  switch (fee) {
    case 100:
      return 1; // 0.01%
    case 500:
      return 10; // 0.05%
    case 3000:
      return 60; // 0.3%
    case 10000:
      return 200; // 1%
    default:
      throw new Error(`Unsupported fee tier: ${fee}`);
  }
}
