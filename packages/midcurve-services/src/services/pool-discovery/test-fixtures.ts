/**
 * Test Fixtures for Pool Discovery
 *
 * Reusable test data for pool discovery service tests.
 * Includes known token pairs with expected pool configurations.
 */

import type { UniswapV3PoolDiscoveryInput } from '../types/pool-discovery/pool-discovery-input.js';

/**
 * Known token pairs with expected pools
 *
 * These are real token pairs on Ethereum mainnet with known pool deployments.
 * Useful for integration tests and mocking expected results.
 */
export const KNOWN_TOKEN_PAIRS = {
  /**
   * WETH/USDC on Ethereum
   *
   * One of the most liquid pairs on Uniswap V3.
   * Has pools at 0.05%, 0.3%, and 1% fee tiers.
   */
  WETH_USDC_ETHEREUM: {
    chainId: 1,
    tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    // Expected pools (addresses from Uniswap V3 deployments)
    expectedPools: [
      {
        fee: 500, // 0.05%
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        tickSpacing: 10,
        poolName: 'CL10-USDC/WETH',
      },
      {
        fee: 3000, // 0.3%
        poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        tickSpacing: 60,
        poolName: 'CL60-USDC/WETH',
      },
      {
        fee: 10000, // 1%
        poolAddress: '0x7BeA39867e4169DBe237d55C8242a8f2fcDcc387',
        tickSpacing: 200,
        poolName: 'CL200-USDC/WETH',
      },
    ],
  },

  /**
   * WETH/DAI on Ethereum
   *
   * Another highly liquid pair.
   * Has pools at 0.05% and 0.3% fee tiers.
   */
  WETH_DAI_ETHEREUM: {
    chainId: 1,
    tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    tokenB: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    expectedPools: [
      {
        fee: 500, // 0.05%
        poolAddress: '0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8',
        tickSpacing: 10,
        poolName: 'CL10-DAI/WETH',
      },
      {
        fee: 3000, // 0.3%
        poolAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
        tickSpacing: 60,
        poolName: 'CL60-DAI/WETH',
      },
    ],
  },

  /**
   * USDC/USDT on Ethereum
   *
   * Stablecoin pair with very tight spreads.
   * Primarily uses 0.01% fee tier.
   */
  USDC_USDT_ETHEREUM: {
    chainId: 1,
    tokenA: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    tokenB: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    expectedPools: [
      {
        fee: 100, // 0.01%
        poolAddress: '0x3416cF6C708Da44DB2624D63ea0AAef7113527C6',
        tickSpacing: 1,
        poolName: 'CL1-USDC/USDT',
      },
      {
        fee: 500, // 0.05%
        poolAddress: '0x7858E59e0C01EA06Df3aF3D20aC7B0003275D4Bf',
        tickSpacing: 10,
        poolName: 'CL10-USDC/USDT',
      },
    ],
  },

  /**
   * WETH/USDC on Arbitrum
   *
   * Testing multi-chain support.
   */
  WETH_USDC_ARBITRUM: {
    chainId: 42161,
    tokenA: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH on Arbitrum
    tokenB: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
    expectedPools: [
      {
        fee: 500, // 0.05%
        poolAddress: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443',
        tickSpacing: 10,
        poolName: 'CL10-USDC/WETH',
      },
    ],
  },
} as const;

/**
 * Test input for WETH/USDC on Ethereum
 */
export const WETH_USDC_INPUT: UniswapV3PoolDiscoveryInput =
  KNOWN_TOKEN_PAIRS.WETH_USDC_ETHEREUM;

/**
 * Test input for WETH/DAI on Ethereum
 */
export const WETH_DAI_INPUT: UniswapV3PoolDiscoveryInput =
  KNOWN_TOKEN_PAIRS.WETH_DAI_ETHEREUM;

/**
 * Test input for USDC/USDT on Ethereum
 */
export const USDC_USDT_INPUT: UniswapV3PoolDiscoveryInput =
  KNOWN_TOKEN_PAIRS.USDC_USDT_ETHEREUM;

/**
 * Test input for WETH/USDC on Arbitrum
 */
export const WETH_USDC_ARBITRUM_INPUT: UniswapV3PoolDiscoveryInput =
  KNOWN_TOKEN_PAIRS.WETH_USDC_ARBITRUM;

/**
 * Test input with lowercase addresses (should be normalized)
 */
export const LOWERCASE_ADDRESSES_INPUT: UniswapV3PoolDiscoveryInput = {
  chainId: 1,
  tokenA: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH (lowercase)
  tokenB: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC (lowercase)
};

/**
 * Test input with reversed token order (should be sorted)
 */
export const REVERSED_TOKEN_ORDER_INPUT: UniswapV3PoolDiscoveryInput = {
  chainId: 1,
  tokenA: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC (higher address)
  tokenB: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH (lower address)
};

/**
 * Test input with invalid tokenA address
 */
export const INVALID_TOKEN_A_INPUT: UniswapV3PoolDiscoveryInput = {
  chainId: 1,
  tokenA: 'invalid-address',
  tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
};

/**
 * Test input with invalid tokenB address
 */
export const INVALID_TOKEN_B_INPUT: UniswapV3PoolDiscoveryInput = {
  chainId: 1,
  tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  tokenB: '0x123', // Too short
};

/**
 * Test input with unsupported chain
 */
export const UNSUPPORTED_CHAIN_INPUT: UniswapV3PoolDiscoveryInput = {
  chainId: 999999,
  tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
};

/**
 * Mock pool metrics for testing subgraph enrichment
 */
export const MOCK_POOL_METRICS = {
  HIGH_TVL: {
    tvlUSD: '234567890.75',
    volumeUSD: '23456789.12',
    feesUSD: '23456.78',
  },
  MEDIUM_TVL: {
    tvlUSD: '123456789.50',
    volumeUSD: '12345678.90',
    feesUSD: '12345.67',
  },
  LOW_TVL: {
    tvlUSD: '45678901.25',
    volumeUSD: '4567890.45',
    feesUSD: '4567.89',
  },
  ZERO_METRICS: {
    tvlUSD: '0',
    volumeUSD: '0',
    feesUSD: '0',
  },
} as const;
