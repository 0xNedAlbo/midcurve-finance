/**
 * Test fixtures for PositionService tests
 * Provides reusable, realistic test data for Uniswap V3 position testing
 */

import type { CreatePositionInput } from '../types/position/position-input.js';
import type {
  UniswapV3PositionConfig,
  UniswapV3PositionState,
  UniswapV3Position,
} from '@midcurve/shared';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { Erc20Token } from '@midcurve/shared';

/**
 * Fixture structure for positions
 * Contains input (for create), dbResult (for mock return), and full position object
 * Note: input includes state for testing, though typically state is computed during discovery
 */
interface PositionFixture {
  input: CreatePositionInput<'uniswapv3'> & { state: UniswapV3PositionState };
  dbResult: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    protocol: string;
    positionType: string;
    userId: string;
    currentValue: string;
    currentCostBasis: string;
    realizedPnl: string;
    unrealizedPnl: string;
    realizedCashflow: string; // Cash flow for non-AMM protocols (always '0' for UniswapV3)
    unrealizedCashflow: string; // Cash flow for non-AMM protocols (always '0' for UniswapV3)
    collectedFees: string;
    unClaimedFees: string;
    lastFeesCollectedAt: Date;
    priceRangeLower: string;
    priceRangeUpper: string;
    poolId: string;
    isToken0Quote: boolean;
    pool: any; // Pool with token0, token1 from include
    positionOpenedAt: Date;
    positionClosedAt: Date | null;
    isActive: boolean;
    config: unknown;
    state: unknown;
  };
  position: UniswapV3Position;
}

// ============================================================================
// User Fixtures
// ============================================================================

export const TEST_USER_ID = 'user_alice_001';
export const TEST_USER_ID_2 = 'user_bob_001';

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
  config: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    chainId: 1,
  },
};

// ============================================================================
// Pool Fixtures
// ============================================================================

export const USDC_WETH_POOL: UniswapV3Pool = {
  id: 'pool_usdc_weth_001',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  protocol: 'uniswapv3',
  poolType: 'CL_TICKS',
  token0: USDC_TOKEN,
  token1: WETH_TOKEN,
  feeBps: 500, // 0.05%
  config: {
    chainId: 1,
    address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
    token0: USDC_TOKEN.config.address,
    token1: WETH_TOKEN.config.address,
    feeBps: 500,
    tickSpacing: 10,
  },
  state: {
    sqrtPriceX96: 1771595571142957166518320255467n,
    currentTick: 202347,
    liquidity: 20000000000000000000n,
    feeGrowthGlobal0: 123456789012345678901234567890n,
    feeGrowthGlobal1: 987654321098765432109876543210n,
  },
};

// ============================================================================
// Position Config Fixtures
// ============================================================================

export const ACTIVE_POSITION_CONFIG: UniswapV3PositionConfig = {
  chainId: 1,
  nftId: 123456,
  poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  tickLower: -887220,
  tickUpper: 887220,
};

export const NARROW_POSITION_CONFIG: UniswapV3PositionConfig = {
  chainId: 1,
  nftId: 123457,
  poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  tickLower: 200000,
  tickUpper: 205000,
};

// ============================================================================
// Position State Fixtures
// ============================================================================

export const ACTIVE_POSITION_STATE: UniswapV3PositionState = {
  ownerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  liquidity: 1000000000000000000n,
  feeGrowthInside0LastX128: 123456789012345678901234567890n,
  feeGrowthInside1LastX128: 987654321098765432109876543210n,
  tokensOwed0: 500000n, // 0.5 USDC
  tokensOwed1: 100000000000000000n, // 0.1 WETH
  unclaimedFees0: 500000n, // 0.5 USDC
  unclaimedFees1: 100000000000000000n, // 0.1 WETH
};

export const ZERO_POSITION_STATE: UniswapV3PositionState = {
  ownerAddress: '0x0000000000000000000000000000000000000000',
  liquidity: 0n,
  feeGrowthInside0LastX128: 0n,
  feeGrowthInside1LastX128: 0n,
  tokensOwed0: 0n,
  tokensOwed1: 0n,
  unclaimedFees0: 0n,
  unclaimedFees1: 0n,
};

// ============================================================================
// Complete Position Fixtures
// ============================================================================

/**
 * Active ETH/USDC position with liquidity and fees
 * - User: Alice
 * - Pool: USDC/WETH 0.05%
 * - Range: Full range (-887220 to 887220)
 * - Status: Active with unclaimed fees
 * - isToken0Quote: true (token0 = USDC is quote, token1 = WETH is base)
 */
export const ACTIVE_ETH_USDC_POSITION: PositionFixture = {
  input: {
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true, // USDC (token0) is quote, WETH (token1) is base
    config: ACTIVE_POSITION_CONFIG,
    state: ACTIVE_POSITION_STATE,
  },
  dbResult: {
    id: 'position_001',
    createdAt: new Date('2024-06-01T00:00:00Z'),
    updatedAt: new Date('2024-06-01T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    currentValue: '1500000000', // 1500 USDC
    currentCostBasis: '1000000000', // 1000 USDC
    realizedPnl: '0',
    unrealizedPnl: '500000000', // 500 USDC profit
    realizedCashflow: '0', // Always 0 for UniswapV3
    unrealizedCashflow: '0', // Always 0 for UniswapV3
    collectedFees: '25000000', // 25 USDC collected
    unClaimedFees: '5000000', // 5 USDC unclaimed
    lastFeesCollectedAt: new Date('2024-06-01T00:00:00Z'),
    priceRangeLower: '1400000000', // 1400 USDC per ETH
    priceRangeUpper: '2000000000', // 2000 USDC per ETH
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true,
    pool: USDC_WETH_POOL,
    positionOpenedAt: new Date('2024-05-01T00:00:00Z'),
    positionClosedAt: null,
    isActive: true,
    config: {
      chainId: 1,
      nftId: 123456,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: {
      ownerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
      liquidity: '1000000000000000000',
      feeGrowthInside0LastX128: '123456789012345678901234567890',
      feeGrowthInside1LastX128: '987654321098765432109876543210',
      tokensOwed0: '500000',
      tokensOwed1: '100000000000000000',
    },
  },
  position: {
    id: 'position_001',
    positionHash: 'uniswapv3/1/123456',
    createdAt: new Date('2024-06-01T00:00:00Z'),
    updatedAt: new Date('2024-06-01T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    currentValue: 1500000000n,
    currentCostBasis: 1000000000n,
    realizedPnl: 0n,
    unrealizedPnl: 500000000n,
    realizedCashflow: 0n, // Always 0 for UniswapV3
    unrealizedCashflow: 0n, // Always 0 for UniswapV3
    collectedFees: 25000000n,
    unClaimedFees: 5000000n,
    lastFeesCollectedAt: new Date('2024-06-01T00:00:00Z'),
    totalApr: 25.5,
    priceRangeLower: 1400000000n,
    priceRangeUpper: 2000000000n,
    pool: USDC_WETH_POOL,
    isToken0Quote: true,
    positionOpenedAt: new Date('2024-05-01T00:00:00Z'),
    positionClosedAt: null,
    isActive: true,
    config: ACTIVE_POSITION_CONFIG,
    state: ACTIVE_POSITION_STATE,
  },
};

/**
 * Closed position (no longer active)
 * - User: Alice
 * - Status: Closed with realized PnL
 */
export const CLOSED_POSITION: PositionFixture = {
  input: {
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true,
    config: {
      chainId: 1,
      nftId: 123458,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: ZERO_POSITION_STATE,
  },
  dbResult: {
    id: 'position_002',
    createdAt: new Date('2024-03-01T00:00:00Z'),
    updatedAt: new Date('2024-05-01T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    currentValue: '0',
    currentCostBasis: '0',
    realizedPnl: '100000000', // 100 USDC profit
    unrealizedPnl: '0',
    realizedCashflow: '0', // Always 0 for UniswapV3
    unrealizedCashflow: '0', // Always 0 for UniswapV3
    collectedFees: '50000000', // 50 USDC collected
    unClaimedFees: '0',
    lastFeesCollectedAt: new Date('2024-05-01T00:00:00Z'),
    priceRangeLower: '1400000000',
    priceRangeUpper: '2000000000',
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true,
    pool: USDC_WETH_POOL,
    positionOpenedAt: new Date('2024-03-01T00:00:00Z'),
    positionClosedAt: new Date('2024-05-01T00:00:00Z'),
    isActive: false,
    config: {
      chainId: 1,
      nftId: 123458,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: {
      ownerAddress: '0x0000000000000000000000000000000000000000',
      liquidity: '0',
      feeGrowthInside0LastX128: '0',
      feeGrowthInside1LastX128: '0',
      tokensOwed0: '0',
      tokensOwed1: '0',
    },
  },
  position: {
    id: 'position_002',
    positionHash: 'uniswapv3/1/234567',
    createdAt: new Date('2024-03-01T00:00:00Z'),
    updatedAt: new Date('2024-05-01T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    currentValue: 0n,
    currentCostBasis: 0n,
    realizedPnl: 100000000n,
    unrealizedPnl: 0n,
    realizedCashflow: 0n, // Always 0 for UniswapV3
    unrealizedCashflow: 0n, // Always 0 for UniswapV3
    collectedFees: 50000000n,
    unClaimedFees: 0n,
    lastFeesCollectedAt: new Date('2024-05-01T00:00:00Z'),
    totalApr: null,
    priceRangeLower: 1400000000n,
    priceRangeUpper: 2000000000n,
    pool: USDC_WETH_POOL,
    isToken0Quote: true,
    positionOpenedAt: new Date('2024-03-01T00:00:00Z'),
    positionClosedAt: new Date('2024-05-01T00:00:00Z'),
    isActive: false,
    config: {
      chainId: 1,
      nftId: 123458,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: ZERO_POSITION_STATE,
  },
};

/**
 * Position for different user (Bob)
 * Used for testing multi-user scenarios
 */
export const BOB_POSITION: PositionFixture = {
  input: {
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID_2,
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true,
    config: {
      chainId: 1,
      nftId: 456789,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: 200000,
      tickUpper: 205000,
    },
    state: {
      ownerAddress: '0x1234567890123456789012345678901234567890',
      liquidity: 500000000000000000n,
      feeGrowthInside0LastX128: 111111111111111111111111111111n,
      feeGrowthInside1LastX128: 222222222222222222222222222222n,
      tokensOwed0: 200000n,
      tokensOwed1: 50000000000000000n,
      unclaimedFees0: 200000n,
      unclaimedFees1: 50000000000000000n,
    },
  },
  dbResult: {
    id: 'position_003',
    createdAt: new Date('2024-06-15T00:00:00Z'),
    updatedAt: new Date('2024-06-15T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID_2,
    currentValue: '800000000',
    currentCostBasis: '750000000',
    realizedPnl: '0',
    unrealizedPnl: '50000000',
    realizedCashflow: '0', // Always 0 for UniswapV3
    unrealizedCashflow: '0', // Always 0 for UniswapV3
    collectedFees: '10000000',
    unClaimedFees: '2000000',
    lastFeesCollectedAt: new Date('2024-06-15T00:00:00Z'),
    priceRangeLower: '1600000000',
    priceRangeUpper: '1700000000',
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true,
    pool: USDC_WETH_POOL,
    positionOpenedAt: new Date('2024-06-01T00:00:00Z'),
    positionClosedAt: null,
    isActive: true,
    config: {
      chainId: 1,
      nftId: 456789,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: 200000,
      tickUpper: 205000,
    },
    state: {
      ownerAddress: '0x1234567890123456789012345678901234567890',
      liquidity: '500000000000000000',
      feeGrowthInside0LastX128: '111111111111111111111111111111',
      feeGrowthInside1LastX128: '222222222222222222222222222222',
      tokensOwed0: '200000',
      tokensOwed1: '50000000000000000',
    },
  },
  position: {
    id: 'position_003',
    positionHash: 'uniswapv3/1/345678',
    createdAt: new Date('2024-06-15T00:00:00Z'),
    updatedAt: new Date('2024-06-15T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID_2,
    currentValue: 800000000n,
    currentCostBasis: 750000000n,
    realizedPnl: 0n,
    unrealizedPnl: 50000000n,
    realizedCashflow: 0n, // Always 0 for UniswapV3
    unrealizedCashflow: 0n, // Always 0 for UniswapV3
    collectedFees: 10000000n,
    unClaimedFees: 2000000n,
    lastFeesCollectedAt: new Date('2024-06-15T00:00:00Z'),
    totalApr: 15.2,
    priceRangeLower: 1600000000n,
    priceRangeUpper: 1700000000n,
    pool: USDC_WETH_POOL,
    isToken0Quote: true,
    positionOpenedAt: new Date('2024-06-01T00:00:00Z'),
    positionClosedAt: null,
    isActive: true,
    config: {
      chainId: 1,
      nftId: 456789,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: 200000,
      tickUpper: 205000,
    },
    state: {
      ownerAddress: '0x1234567890123456789012345678901234567890',
      liquidity: 500000000000000000n,
      feeGrowthInside0LastX128: 111111111111111111111111111111n,
      feeGrowthInside1LastX128: 222222222222222222222222222222n,
      tokensOwed0: 200000n,
      tokensOwed1: 50000000000000000n,
      unclaimedFees0: 200000n,
      unclaimedFees1: 50000000000000000n,
    },
  },
};

/**
 * Position on Arbitrum (chainId: 42161)
 * - User: Alice
 * - Status: Active
 * - Used for testing multi-chain filtering
 */
export const ARBITRUM_POSITION: PositionFixture = {
  input: {
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true,
    config: {
      chainId: 42161, // Arbitrum
      nftId: 789012,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: ACTIVE_POSITION_STATE,
  },
  dbResult: {
    id: 'position_004',
    createdAt: new Date('2024-06-20T00:00:00Z'),
    updatedAt: new Date('2024-06-20T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    currentValue: '2000000000', // 2000 USDC
    currentCostBasis: '1800000000', // 1800 USDC
    realizedPnl: '0',
    unrealizedPnl: '200000000', // 200 USDC profit
    realizedCashflow: '0', // Always 0 for UniswapV3
    unrealizedCashflow: '0', // Always 0 for UniswapV3
    collectedFees: '15000000', // 15 USDC collected
    unClaimedFees: '3000000', // 3 USDC unclaimed
    lastFeesCollectedAt: new Date('2024-06-20T00:00:00Z'),
    priceRangeLower: '1400000000',
    priceRangeUpper: '2000000000',
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true,
    pool: USDC_WETH_POOL,
    positionOpenedAt: new Date('2024-06-10T00:00:00Z'),
    positionClosedAt: null,
    isActive: true,
    config: {
      chainId: 42161, // Arbitrum
      nftId: 789012,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: {
      ownerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
      liquidity: '1000000000000000000',
      feeGrowthInside0LastX128: '123456789012345678901234567890',
      feeGrowthInside1LastX128: '987654321098765432109876543210',
      tokensOwed0: '500000',
      tokensOwed1: '100000000000000000',
    },
  },
  position: {
    id: 'position_004',
    positionHash: 'uniswapv3/1/456789',
    createdAt: new Date('2024-06-20T00:00:00Z'),
    updatedAt: new Date('2024-06-20T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    currentValue: 2000000000n,
    currentCostBasis: 1800000000n,
    realizedPnl: 0n,
    unrealizedPnl: 200000000n,
    realizedCashflow: 0n, // Always 0 for UniswapV3
    unrealizedCashflow: 0n, // Always 0 for UniswapV3
    collectedFees: 15000000n,
    unClaimedFees: 3000000n,
    lastFeesCollectedAt: new Date('2024-06-20T00:00:00Z'),
    totalApr: 30.8,
    priceRangeLower: 1400000000n,
    priceRangeUpper: 2000000000n,
    pool: USDC_WETH_POOL,
    isToken0Quote: true,
    positionOpenedAt: new Date('2024-06-10T00:00:00Z'),
    positionClosedAt: null,
    isActive: true,
    config: {
      chainId: 42161, // Arbitrum
      nftId: 789012,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: ACTIVE_POSITION_STATE,
  },
};

/**
 * Position on Base (chainId: 8453)
 * - User: Alice
 * - Status: Closed
 * - Used for testing multi-chain filtering
 */
export const BASE_POSITION: PositionFixture = {
  input: {
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true,
    config: {
      chainId: 8453, // Base
      nftId: 999999,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: ZERO_POSITION_STATE,
  },
  dbResult: {
    id: 'position_005',
    createdAt: new Date('2024-04-01T00:00:00Z'),
    updatedAt: new Date('2024-06-01T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    currentValue: '0',
    currentCostBasis: '0',
    realizedPnl: '75000000', // 75 USDC profit
    unrealizedPnl: '0',
    realizedCashflow: '0', // Always 0 for UniswapV3
    unrealizedCashflow: '0', // Always 0 for UniswapV3
    collectedFees: '30000000', // 30 USDC collected
    unClaimedFees: '0',
    lastFeesCollectedAt: new Date('2024-06-01T00:00:00Z'),
    priceRangeLower: '1400000000',
    priceRangeUpper: '2000000000',
    poolId: USDC_WETH_POOL.id,
    isToken0Quote: true,
    pool: USDC_WETH_POOL,
    positionOpenedAt: new Date('2024-04-01T00:00:00Z'),
    positionClosedAt: new Date('2024-06-01T00:00:00Z'),
    isActive: false,
    config: {
      chainId: 8453, // Base
      nftId: 999999,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: {
      ownerAddress: '0x0000000000000000000000000000000000000000',
      liquidity: '0',
      feeGrowthInside0LastX128: '0',
      feeGrowthInside1LastX128: '0',
      tokensOwed0: '0',
      tokensOwed1: '0',
    },
  },
  position: {
    id: 'position_005',
    positionHash: 'uniswapv3/1/567890',
    createdAt: new Date('2024-04-01T00:00:00Z'),
    updatedAt: new Date('2024-06-01T00:00:00Z'),
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: TEST_USER_ID,
    currentValue: 0n,
    currentCostBasis: 0n,
    realizedPnl: 75000000n,
    unrealizedPnl: 0n,
    realizedCashflow: 0n, // Always 0 for UniswapV3
    unrealizedCashflow: 0n, // Always 0 for UniswapV3
    collectedFees: 30000000n,
    unClaimedFees: 0n,
    lastFeesCollectedAt: new Date('2024-06-01T00:00:00Z'),
    totalApr: null,
    priceRangeLower: 1400000000n,
    priceRangeUpper: 2000000000n,
    pool: USDC_WETH_POOL,
    isToken0Quote: true,
    positionOpenedAt: new Date('2024-04-01T00:00:00Z'),
    positionClosedAt: new Date('2024-06-01T00:00:00Z'),
    isActive: false,
    config: {
      chainId: 8453, // Base
      nftId: 999999,
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickLower: -887220,
      tickUpper: 887220,
    },
    state: ZERO_POSITION_STATE,
  },
};

/**
 * Helper function to create custom position fixtures
 */
export function createPositionFixture(
  overrides: Partial<UniswapV3Position>
): UniswapV3Position {
  return {
    ...ACTIVE_ETH_USDC_POSITION.position,
    ...overrides,
  };
}
