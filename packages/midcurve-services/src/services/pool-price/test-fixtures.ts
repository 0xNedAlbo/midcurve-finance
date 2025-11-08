/**
 * Test Fixtures for Pool Price Tests
 *
 * Reusable test data for pool price service tests.
 * Uses real-world data from actual Arbitrum pools.
 */

import type {
  CreatePoolPriceInput,
  CreateUniswapV3PoolPriceInput,
} from '../types/pool-price/pool-price-input.js';
import type { UniswapV3PoolPrice } from '@midcurve/shared';

/**
 * Pool Price Fixture structure
 *
 * Contains both the input (for service.create()) and the expected
 * database result (with id, timestamps).
 */
export interface PoolPriceFixture<P extends 'uniswapv3' = 'uniswapv3'> {
  /** Input for service.create() */
  input: CreatePoolPriceInput<P>;
  /** Expected database result (with id and timestamps) */
  dbResult: UniswapV3PoolPrice;
}

/**
 * WETH/USDC Pool Price Fixture (Arbitrum)
 *
 * Real data from Arbitrum WETH/USDC 0.05% pool:
 * - Pool: 0xC6962004f452bE9203591991D15f6b388e09E8D0
 * - Block: 18000000 (~2024-01-15)
 * - sqrtPriceX96: 4880027310900678652549898
 * - Tick: -193909
 * - Price: 1 WETH = 3793.895265 USDC
 */
export const WETH_USDC_POOL_PRICE_ARBITRUM: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_001',
    timestamp: new Date('2024-01-15T10:30:00Z'),
    token1PricePerToken0: 3793_895265n, // USDC per WETH (6 decimals)
    token0PricePerToken1: 263592215453863n, // WETH per USDC (18 decimals)
    config: {
      blockNumber: 18000000,
      blockTimestamp: 1705315800,
    },
    state: {
      sqrtPriceX96: 4880027310900678652549898n,
      tick: -193909,
    },
  },
  dbResult: {
    id: 'poolprice_weth_usdc_arb_001',
    createdAt: new Date('2024-01-15T10:30:00Z'),
    updatedAt: new Date('2024-01-15T10:30:00Z'),
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_001',
    timestamp: new Date('2024-01-15T10:30:00Z'),
    token1PricePerToken0: 3793_895265n,
    token0PricePerToken1: 263592215453863n,
    config: {
      blockNumber: 18000000,
      blockTimestamp: 1705315800,
    },
    state: {
      sqrtPriceX96: 4880027310900678652549898n,
      tick: -193909,
    },
  },
};

/**
 * WBTC/USDC Pool Price Fixture (Arbitrum)
 *
 * Real data from Arbitrum WBTC/USDC pool:
 * - Pool: 0x6985cb98CE393FCE8d6272127F39013f61e36166
 * - Block: 18500000
 * - sqrtPriceX96: 2594590524261178691684425401086
 * - Tick: 69780
 * - Price: 1 WBTC = 107,245.354183 USDC
 */
export const WBTC_USDC_POOL_PRICE_ARBITRUM: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_wbtc_usdc_arb_001',
    timestamp: new Date('2024-02-01T14:00:00Z'),
    token1PricePerToken0: 107245_354183n, // USDC per WBTC (6 decimals)
    token0PricePerToken1: 9324395157n, // WBTC per USDC (8 decimals)
    config: {
      blockNumber: 18500000,
      blockTimestamp: 1706792400,
    },
    state: {
      sqrtPriceX96: 2594590524261178691684425401086n,
      tick: 69780,
    },
  },
  dbResult: {
    id: 'poolprice_wbtc_usdc_arb_001',
    createdAt: new Date('2024-02-01T14:00:00Z'),
    updatedAt: new Date('2024-02-01T14:00:00Z'),
    protocol: 'uniswapv3',
    poolId: 'pool_wbtc_usdc_arb_001',
    timestamp: new Date('2024-02-01T14:00:00Z'),
    token1PricePerToken0: 107245_354183n,
    token0PricePerToken1: 9324395157n,
    config: {
      blockNumber: 18500000,
      blockTimestamp: 1706792400,
    },
    state: {
      sqrtPriceX96: 2594590524261178691684425401086n,
      tick: 69780,
    },
  },
};

/**
 * USDC/USDT Pool Price Fixture (1:1 stablecoin pair)
 *
 * Example stablecoin pair with near 1:1 price ratio.
 * sqrtPriceX96 = 2^96 represents exact 1:1 ratio.
 */
export const USDC_USDT_POOL_PRICE: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_usdc_usdt_001',
    timestamp: new Date('2024-03-01T00:00:00Z'),
    token1PricePerToken0: 1_000000n, // 1 USDT per USDC (6 decimals)
    token0PricePerToken1: 1_000000n, // 1 USDC per USDT (6 decimals)
    config: {
      blockNumber: 19000000,
      blockTimestamp: 1709251200,
    },
    state: {
      sqrtPriceX96: 79228162514264337593543950336n, // 2^96 = 1:1
      tick: 0,
    },
  },
  dbResult: {
    id: 'poolprice_usdc_usdt_001',
    createdAt: new Date('2024-03-01T00:00:00Z'),
    updatedAt: new Date('2024-03-01T00:00:00Z'),
    protocol: 'uniswapv3',
    poolId: 'pool_usdc_usdt_001',
    timestamp: new Date('2024-03-01T00:00:00Z'),
    token1PricePerToken0: 1_000000n,
    token0PricePerToken1: 1_000000n,
    config: {
      blockNumber: 19000000,
      blockTimestamp: 1709251200,
    },
    state: {
      sqrtPriceX96: 79228162514264337593543950336n,
      tick: 0,
    },
  },
};

/**
 * Historical WETH/USDC Pool Price (Earlier block)
 *
 * Earlier snapshot of the same pool for time-range queries testing.
 */
export const WETH_USDC_POOL_PRICE_EARLIER: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_001',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    token1PricePerToken0: 2200_000000n, // Lower ETH price
    token0PricePerToken1: 454545454545454n,
    config: {
      blockNumber: 17500000,
      blockTimestamp: 1704067200,
    },
    state: {
      sqrtPriceX96: 3703786271042312924479525n,
      tick: -198710,
    },
  },
  dbResult: {
    id: 'poolprice_weth_usdc_arb_earlier',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_001',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    token1PricePerToken0: 2200_000000n,
    token0PricePerToken1: 454545454545454n,
    config: {
      blockNumber: 17500000,
      blockTimestamp: 1704067200,
    },
    state: {
      sqrtPriceX96: 3703786271042312924479525n,
      tick: -198710,
    },
  },
};

/**
 * Historical WETH/USDC Pool Price (Later block)
 *
 * Later snapshot of the same pool for time-range queries testing.
 */
export const WETH_USDC_POOL_PRICE_LATER: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_001',
    timestamp: new Date('2024-02-01T00:00:00Z'),
    token1PricePerToken0: 4100_000000n, // Higher ETH price
    token0PricePerToken1: 243902439024390n,
    config: {
      blockNumber: 18800000,
      blockTimestamp: 1706745600,
    },
    state: {
      sqrtPriceX96: 5059837277094050304851698n,
      tick: -192100,
    },
  },
  dbResult: {
    id: 'poolprice_weth_usdc_arb_later',
    createdAt: new Date('2024-02-01T00:00:00Z'),
    updatedAt: new Date('2024-02-01T00:00:00Z'),
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_001',
    timestamp: new Date('2024-02-01T00:00:00Z'),
    token1PricePerToken0: 4100_000000n,
    token0PricePerToken1: 243902439024390n,
    config: {
      blockNumber: 18800000,
      blockTimestamp: 1706745600,
    },
    state: {
      sqrtPriceX96: 5059837277094050304851698n,
      tick: -192100,
    },
  },
};

/**
 * Minimal Pool Price Fixture
 *
 * Minimal valid pool price for edge case testing.
 */
export const MINIMAL_POOL_PRICE: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_minimal',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    token1PricePerToken0: 1n,
    token0PricePerToken1: 1n,
    config: {
      blockNumber: 1,
      blockTimestamp: 1704067200,
    },
    state: {
      sqrtPriceX96: 79228162514264337593543950336n,
      tick: 0,
    },
  },
  dbResult: {
    id: 'poolprice_minimal',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    protocol: 'uniswapv3',
    poolId: 'pool_minimal',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    token1PricePerToken0: 1n,
    token0PricePerToken1: 1n,
    config: {
      blockNumber: 1,
      blockTimestamp: 1704067200,
    },
    state: {
      sqrtPriceX96: 79228162514264337593543950336n,
      tick: 0,
    },
  },
};

/**
 * Helper function to create custom pool price fixtures
 *
 * Useful for generating test-specific data while maintaining structure.
 */
export function createPoolPriceFixture(
  overrides: Partial<CreateUniswapV3PoolPriceInput> & {
    id?: string;
    createdAt?: Date;
    updatedAt?: Date;
  }
): PoolPriceFixture {
  const baseFixture = WETH_USDC_POOL_PRICE_ARBITRUM;

  const input: CreateUniswapV3PoolPriceInput = {
    ...baseFixture.input,
    ...overrides,
  };

  const dbResult: UniswapV3PoolPrice = {
    ...baseFixture.dbResult,
    ...input,
    id: overrides.id ?? baseFixture.dbResult.id,
    createdAt: overrides.createdAt ?? baseFixture.dbResult.createdAt,
    updatedAt: overrides.updatedAt ?? baseFixture.dbResult.updatedAt,
  };

  return { input, dbResult };
}

// =============================================================================
// REAL HISTORICAL DATA FROM ARBITRUM
// Generated by scripts/fetch-pool-price-data.ts
// =============================================================================

/**
 * Real WETH/USDC Pool Price from Arbitrum
 * Block: 150000000 (2023-11-13T12:31:19.000Z)
 * Price: 1 WETH = 2048.415760 USDC
 */
export const REAL_ARBITRUM_EARLY_2024: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_real', // Will be set to actual pool ID in tests
    timestamp: new Date('2023-11-13T12:31:19.000Z'),
    token1PricePerToken0: 2048415760n,
    token0PricePerToken1: 488182145169573n,
    config: {
      blockNumber: 150000000,
      blockTimestamp: 1699878679,
    },
    state: {
      sqrtPriceX96: 3585821261994244732184815n,
      tick: -200072,
    },
  },
  dbResult: {
    id: 'poolprice_weth_usdc_arb_early_2024',
    createdAt: new Date('2023-11-13T12:31:19.000Z'),
    updatedAt: new Date('2023-11-13T12:31:19.000Z'),
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_real',
    timestamp: new Date('2023-11-13T12:31:19.000Z'),
    token1PricePerToken0: 2048415760n,
    token0PricePerToken1: 488182145169573n,
    config: {
      blockNumber: 150000000,
      blockTimestamp: 1699878679,
    },
    state: {
      sqrtPriceX96: 3585821261994244732184815n,
      tick: -200072,
    },
  },
};

/**
 * Real WETH/USDC Pool Price from Arbitrum
 * Block: 175000000 (2024-01-28T09:35:26.000Z)
 * Price: 1 WETH = 2290.770615 USDC
 */
export const REAL_ARBITRUM_MID_2024: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_real', // Will be set to actual pool ID in tests
    timestamp: new Date('2024-01-28T09:35:26.000Z'),
    token1PricePerToken0: 2290770615n,
    token0PricePerToken1: 436534323027777n,
    config: {
      blockNumber: 175000000,
      blockTimestamp: 1706434526,
    },
    state: {
      sqrtPriceX96: 3792017959885741061979578n,
      tick: -198954,
    },
  },
  dbResult: {
    id: 'poolprice_weth_usdc_arb_mid_2024',
    createdAt: new Date('2024-01-28T09:35:26.000Z'),
    updatedAt: new Date('2024-01-28T09:35:26.000Z'),
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_real',
    timestamp: new Date('2024-01-28T09:35:26.000Z'),
    token1PricePerToken0: 2290770615n,
    token0PricePerToken1: 436534323027777n,
    config: {
      blockNumber: 175000000,
      blockTimestamp: 1706434526,
    },
    state: {
      sqrtPriceX96: 3792017959885741061979578n,
      tick: -198954,
    },
  },
};

/**
 * Real WETH/USDC Pool Price from Arbitrum
 * Block: 200000000 (2024-04-11T19:09:12.000Z)
 * Price: 1 WETH = 3501.607493 USDC
 */
export const REAL_ARBITRUM_LATE_2024: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_real', // Will be set to actual pool ID in tests
    timestamp: new Date('2024-04-11T19:09:12.000Z'),
    token1PricePerToken0: 3501607493n,
    token0PricePerToken1: 285583121965954n,
    config: {
      blockNumber: 200000000,
      blockTimestamp: 1712862552,
    },
    state: {
      sqrtPriceX96: 4688277559663176242347820n,
      tick: -194711,
    },
  },
  dbResult: {
    id: 'poolprice_weth_usdc_arb_late_2024',
    createdAt: new Date('2024-04-11T19:09:12.000Z'),
    updatedAt: new Date('2024-04-11T19:09:12.000Z'),
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_real',
    timestamp: new Date('2024-04-11T19:09:12.000Z'),
    token1PricePerToken0: 3501607493n,
    token0PricePerToken1: 285583121965954n,
    config: {
      blockNumber: 200000000,
      blockTimestamp: 1712862552,
    },
    state: {
      sqrtPriceX96: 4688277559663176242347820n,
      tick: -194711,
    },
  },
};
