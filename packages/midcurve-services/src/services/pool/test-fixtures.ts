/**
 * Test fixtures for PoolService tests
 * Provides reusable, realistic test data for Uniswap V3 pool testing
 */

import type { CreatePoolInput } from '../types/pool/pool-input.js';
import type {
  UniswapV3PoolConfig,
  UniswapV3PoolState,
  UniswapV3Pool,
} from '@midcurve/shared';
import type { Erc20Token } from '@midcurve/shared';

/**
 * Fixture structure for pools
 * Contains input (for create), dbResult (for mock return), and full pool object
 */
interface PoolFixture {
  input: CreatePoolInput<'uniswapv3'>;
  dbResult: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    protocol: string;
    poolType: string;
    token0Id: string;
    token1Id: string;
    feeBps: number;
    config: unknown;
    state: unknown;
    token0: any;
    token1: any;
  };
  pool: UniswapV3Pool;
}

// ============================================================================
// Token Fixtures
// ============================================================================

export const USDC_TOKEN: Erc20Token = {
  id: 'token_usdc_eth_001',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  tokenType: 'erc20',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  logoUrl: 'https://example.com/usdc.png',
  coingeckoId: 'usd-coin',
  marketCap: 28000000000,
  config: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
  },
};

export const WETH_TOKEN: Erc20Token = {
  id: 'token_weth_eth_001',
  createdAt: new Date('2024-01-02T00:00:00Z'),
  updatedAt: new Date('2024-01-02T00:00:00Z'),
  tokenType: 'erc20',
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: 18,
  logoUrl: 'https://example.com/weth.png',
  coingeckoId: 'weth',
  marketCap: 5000000000,
  config: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    chainId: 1,
  },
};

export const DAI_TOKEN: Erc20Token = {
  id: 'token_dai_eth_001',
  createdAt: new Date('2024-01-03T00:00:00Z'),
  updatedAt: new Date('2024-01-03T00:00:00Z'),
  tokenType: 'erc20',
  name: 'Dai Stablecoin',
  symbol: 'DAI',
  decimals: 18,
  config: {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    chainId: 1,
  },
};

// Arbitrum tokens
export const USDC_ARBITRUM_TOKEN: Erc20Token = {
  id: 'token_usdc_arb_001',
  createdAt: new Date('2024-01-04T00:00:00Z'),
  updatedAt: new Date('2024-01-04T00:00:00Z'),
  tokenType: 'erc20',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  config: {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chainId: 42161,
  },
};

// ============================================================================
// Pool Config Fixtures
// ============================================================================

export const USDC_WETH_CONFIG: UniswapV3PoolConfig = {
  chainId: 1,
  address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  feeBps: 500, // 0.05%
  tickSpacing: 10,
};

export const USDC_DAI_CONFIG: UniswapV3PoolConfig = {
  chainId: 1,
  address: '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168',
  token0: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
  token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  feeBps: 100, // 0.01%
  tickSpacing: 1,
};

export const WETH_DAI_CONFIG: UniswapV3PoolConfig = {
  chainId: 1,
  address: '0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8',
  token0: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
  token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  feeBps: 3000, // 0.3%
  tickSpacing: 60,
};

// ============================================================================
// Pool State Fixtures
// ============================================================================

export const ACTIVE_POOL_STATE: UniswapV3PoolState = {
  sqrtPriceX96: 1234567890123456789012345678n,
  currentTick: 201234,
  liquidity: 9876543210987654321098765n,
  feeGrowthGlobal0: 111111111111111111111n,
  feeGrowthGlobal1: 222222222222222222222n,
};

export const ZERO_POOL_STATE: UniswapV3PoolState = {
  sqrtPriceX96: 0n,
  currentTick: 0,
  liquidity: 0n,
  feeGrowthGlobal0: 0n,
  feeGrowthGlobal1: 0n,
};

export const HIGH_LIQUIDITY_STATE: UniswapV3PoolState = {
  sqrtPriceX96: 5000000000000000000000000n,
  currentTick: 100000,
  liquidity: 999999999999999999999999999n,
  feeGrowthGlobal0: 999999999999999999999999n,
  feeGrowthGlobal1: 888888888888888888888888n,
};

// ============================================================================
// Complete Pool Fixtures
// ============================================================================

export const USDC_WETH_POOL: PoolFixture = {
  input: {
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0Id: USDC_TOKEN.id,
    token1Id: WETH_TOKEN.id,
    feeBps: 500,
    config: USDC_WETH_CONFIG,
    state: ACTIVE_POOL_STATE,
  },
  dbResult: {
    id: 'pool_usdc_weth_001',
    createdAt: new Date('2024-01-10T00:00:00Z'),
    updatedAt: new Date('2024-01-10T00:00:00Z'),
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0Id: USDC_TOKEN.id,
    token1Id: WETH_TOKEN.id,
    feeBps: 500,
    config: {
      chainId: 1,
      address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      feeBps: 500,
      tickSpacing: 10,
    },
    state: {
      sqrtPriceX96: '1234567890123456789012345678',
      currentTick: 201234,
      liquidity: '9876543210987654321098765',
      feeGrowthGlobal0: '111111111111111111111',
      feeGrowthGlobal1: '222222222222222222222',
    },
    token0: {
      id: USDC_TOKEN.id,
      createdAt: USDC_TOKEN.createdAt,
      updatedAt: USDC_TOKEN.updatedAt,
      tokenType: 'erc20',
      name: USDC_TOKEN.name,
      symbol: USDC_TOKEN.symbol,
      decimals: USDC_TOKEN.decimals,
      logoUrl: USDC_TOKEN.logoUrl,
      coingeckoId: USDC_TOKEN.coingeckoId,
      marketCap: USDC_TOKEN.marketCap,
      config: USDC_TOKEN.config,
    },
    token1: {
      id: WETH_TOKEN.id,
      createdAt: WETH_TOKEN.createdAt,
      updatedAt: WETH_TOKEN.updatedAt,
      tokenType: 'erc20',
      name: WETH_TOKEN.name,
      symbol: WETH_TOKEN.symbol,
      decimals: WETH_TOKEN.decimals,
      logoUrl: WETH_TOKEN.logoUrl,
      coingeckoId: WETH_TOKEN.coingeckoId,
      marketCap: WETH_TOKEN.marketCap,
      config: WETH_TOKEN.config,
    },
  },
  pool: {
    id: 'pool_usdc_weth_001',
    createdAt: new Date('2024-01-10T00:00:00Z'),
    updatedAt: new Date('2024-01-10T00:00:00Z'),
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0: USDC_TOKEN,
    token1: WETH_TOKEN,
    feeBps: 500,
    config: USDC_WETH_CONFIG,
    state: ACTIVE_POOL_STATE,
  },
};

export const USDC_DAI_POOL: PoolFixture = {
  input: {
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0Id: DAI_TOKEN.id,
    token1Id: USDC_TOKEN.id,
    feeBps: 100,
    config: USDC_DAI_CONFIG,
    state: ACTIVE_POOL_STATE,
  },
  dbResult: {
    id: 'pool_usdc_dai_001',
    createdAt: new Date('2024-01-11T00:00:00Z'),
    updatedAt: new Date('2024-01-11T00:00:00Z'),
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0Id: DAI_TOKEN.id,
    token1Id: USDC_TOKEN.id,
    feeBps: 100,
    config: {
      chainId: 1,
      address: '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168',
      token0: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      feeBps: 100,
      tickSpacing: 1,
    },
    state: {
      sqrtPriceX96: '1234567890123456789012345678',
      currentTick: 201234,
      liquidity: '9876543210987654321098765',
      feeGrowthGlobal0: '111111111111111111111',
      feeGrowthGlobal1: '222222222222222222222',
    },
    token0: {
      id: DAI_TOKEN.id,
      createdAt: DAI_TOKEN.createdAt,
      updatedAt: DAI_TOKEN.updatedAt,
      tokenType: 'erc20',
      name: DAI_TOKEN.name,
      symbol: DAI_TOKEN.symbol,
      decimals: DAI_TOKEN.decimals,
      logoUrl: null,
      coingeckoId: DAI_TOKEN.coingeckoId,
      marketCap: null,
      config: DAI_TOKEN.config,
    },
    token1: {
      id: USDC_TOKEN.id,
      createdAt: USDC_TOKEN.createdAt,
      updatedAt: USDC_TOKEN.updatedAt,
      tokenType: 'erc20',
      name: USDC_TOKEN.name,
      symbol: USDC_TOKEN.symbol,
      decimals: USDC_TOKEN.decimals,
      logoUrl: USDC_TOKEN.logoUrl,
      coingeckoId: USDC_TOKEN.coingeckoId,
      marketCap: USDC_TOKEN.marketCap,
      config: USDC_TOKEN.config,
    },
  },
  pool: {
    id: 'pool_usdc_dai_001',
    createdAt: new Date('2024-01-11T00:00:00Z'),
    updatedAt: new Date('2024-01-11T00:00:00Z'),
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0: DAI_TOKEN,
    token1: USDC_TOKEN,
    feeBps: 100,
    config: USDC_DAI_CONFIG,
    state: ACTIVE_POOL_STATE,
  },
};

// ============================================================================
// Helper Function
// ============================================================================

/**
 * Create a custom pool fixture with default values
 * Useful for creating test-specific pools with overrides
 */
export function createPoolFixture(
  overrides: Partial<PoolFixture['input']> = {}
): PoolFixture {
  const input: CreatePoolInput<'uniswapv3'> = {
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0Id: USDC_TOKEN.id,
    token1Id: WETH_TOKEN.id,
    feeBps: 3000,
    config: {
      chainId: 1,
      address: '0x0000000000000000000000000000000000000001',
      token0: USDC_TOKEN.config.address,
      token1: WETH_TOKEN.config.address,
      feeBps: 3000,
      tickSpacing: 60,
    },
    state: ZERO_POOL_STATE,
    ...overrides,
  };

  const config = input.config as UniswapV3PoolConfig;
  const state = input.state as UniswapV3PoolState;

  const dbResult = {
    id: 'pool_custom_001',
    createdAt: new Date('2024-01-15T00:00:00Z'),
    updatedAt: new Date('2024-01-15T00:00:00Z'),
    protocol: input.protocol,
    poolType: input.poolType,
    token0Id: input.token0Id,
    token1Id: input.token1Id,
    feeBps: input.feeBps,
    config: {
      chainId: config.chainId,
      address: config.address,
      token0: config.token0,
      token1: config.token1,
      feeBps: config.feeBps,
      tickSpacing: config.tickSpacing,
    },
    state: {
      sqrtPriceX96: state.sqrtPriceX96.toString(),
      currentTick: state.currentTick,
      liquidity: state.liquidity.toString(),
      feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
      feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
    },
    token0: {
      id: USDC_TOKEN.id,
      createdAt: USDC_TOKEN.createdAt,
      updatedAt: USDC_TOKEN.updatedAt,
      tokenType: 'erc20',
      name: USDC_TOKEN.name,
      symbol: USDC_TOKEN.symbol,
      decimals: USDC_TOKEN.decimals,
      logoUrl: USDC_TOKEN.logoUrl,
      coingeckoId: USDC_TOKEN.coingeckoId,
      marketCap: USDC_TOKEN.marketCap,
      config: USDC_TOKEN.config,
    },
    token1: {
      id: WETH_TOKEN.id,
      createdAt: WETH_TOKEN.createdAt,
      updatedAt: WETH_TOKEN.updatedAt,
      tokenType: 'erc20',
      name: WETH_TOKEN.name,
      symbol: WETH_TOKEN.symbol,
      decimals: WETH_TOKEN.decimals,
      logoUrl: WETH_TOKEN.logoUrl,
      coingeckoId: WETH_TOKEN.coingeckoId,
      marketCap: WETH_TOKEN.marketCap,
      config: WETH_TOKEN.config,
    },
  };

  const pool: UniswapV3Pool = {
    id: 'pool_custom_001',
    createdAt: new Date('2024-01-15T00:00:00Z'),
    updatedAt: new Date('2024-01-15T00:00:00Z'),
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0: USDC_TOKEN,
    token1: WETH_TOKEN,
    feeBps: input.feeBps,
    config,
    state,
  };

  return { input, dbResult, pool };
}
