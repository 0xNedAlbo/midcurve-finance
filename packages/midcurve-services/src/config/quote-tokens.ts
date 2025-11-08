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

  // Optimism (Chain ID: 10)
  [SupportedChainId.OPTIMISM]: [
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC (native)
    '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', // USDC.e (bridged)
    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
    '0x2E3D870790dC77A83DD1d18184Acc7439A53f475', // FRAX
    '0x4200000000000000000000000000000000000006', // WETH
  ],

  // Polygon (Chain ID: 137)
  [SupportedChainId.POLYGON]: [
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC (native)
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC.e (bridged)
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // DAI
    '0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89', // FRAX
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
  ],

  // BNB Smart Chain (Chain ID: 56)
  [SupportedChainId.BSC]: [
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
    '0x55d398326f99059fF775485246999027B3197955', // USDT
    '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', // DAI
    '0x90C97F71E18723b0Cf0dfa30ee176Ab653E89F40', // FRAX
    '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // ETH (wrapped)
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
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
