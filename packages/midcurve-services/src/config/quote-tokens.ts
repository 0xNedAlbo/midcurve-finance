/**
 * Default Quote Token Configuration
 *
 * Defines default quote token preferences per chain for Uniswap V3.
 * These defaults follow the priority: Stablecoins > Wrapped Native > Token0 (fallback)
 *
 * All addresses are in EIP-55 checksum format.
 */

import { SupportedChainId } from './evm.js';

/**
 * Default quote token addresses by chain ID
 * Ordered by priority (first match wins)
 *
 * Priority levels:
 * 1. Stablecoins (USDC, USDT, DAI, etc.)
 * 2. Wrapped native token (WETH, WBNB, WMATIC, etc.)
 */
export const DEFAULT_QUOTE_TOKENS_BY_CHAIN: Record<number, string[]> = {
  // Ethereum Mainnet (Chain ID: 1)
  [SupportedChainId.ETHEREUM]: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    '0x853d955aCEf822Db058eb8505911ED77F175b99e', // FRAX
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  ],

  // Arbitrum One (Chain ID: 42161)
  [SupportedChainId.ARBITRUM]: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC (native)
    '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC.e (bridged)
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
    '0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F', // FRAX
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  ],

  // Base (Chain ID: 8453)
  [SupportedChainId.BASE]: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', // DAI
    '0x4200000000000000000000000000000000000006', // WETH
  ],

  // Sepolia Testnet (Chain ID: 11155111) — mock tokens
  [SupportedChainId.SEPOLIA]: [
    '0xDf5f0577Bd56a67fd0844F7EA08649d63a5D5f3C', // mcUSD
    '0x5BB47f45Cd7b7611d4D54992Cf05e2cF2529e031', // mcWETH
  ],

};

/**
 * Get default quote tokens for a specific chain
 *
 * @param chainId - EVM chain ID
 * @returns Array of default quote token addresses (EIP-55 checksum format)
 */
export function getDefaultQuoteTokens(chainId: number): string[] {
  return DEFAULT_QUOTE_TOKENS_BY_CHAIN[chainId] ?? [];
}

/**
 * Check if a chain has default quote tokens configured
 *
 * @param chainId - EVM chain ID
 * @returns true if chain has defaults, false otherwise
 */
export function hasDefaultQuoteTokens(chainId: number): boolean {
  return chainId in DEFAULT_QUOTE_TOKENS_BY_CHAIN;
}
