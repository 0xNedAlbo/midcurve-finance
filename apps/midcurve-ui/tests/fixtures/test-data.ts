/**
 * Test Data Fixtures
 *
 * Provides mock data for positions, pools, tokens, and other entities
 * used in Playwright tests.
 */

import type {
  Erc20Token,
} from '@midcurve/shared';

/**
 * Mock ERC-20 Token: USDC
 */
export const MOCK_USDC: Erc20Token = {
  id: 'token-1',
  tokenType: 'erc20',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  config: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
  },
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

/**
 * Mock ERC-20 Token: WETH
 */
export const MOCK_WETH: Erc20Token = {
  id: 'token-2',
  tokenType: 'erc20',
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: 18,
  config: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    chainId: 1,
  },
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

/**
 * Mock Uniswap V3 Pool: WETH/USDC 0.05%
 */
export const MOCK_POOL = {
  id: 'pool-1',
  poolType: 'CL_TICKS',
  protocol: 'uniswapv3',
  token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  feeBps: 500,
  state: {
    sqrtPriceX96: '0',
    tick: 0,
    liquidity: '0',
  },
  config: {
    address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
    chainId: 1,
    token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    feeBps: 500,
    tickSpacing: 10,
  },
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

/**
 * Mock Uniswap V3 Position
 */
export const MOCK_POSITION = {
  id: 'position-1',
  positionType: 'CL_TICKS',
  userId: 'user-1',
  poolId: MOCK_POOL.id,
  quoteTokenId: MOCK_USDC.id,
  baseTokenId: MOCK_WETH.id,
  config: {
    chainId: 1,
    nftId: 123456,
    poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
    tickLower: -887220,
    tickUpper: 887220,
  },
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

/**
 * Mock position with enriched data (amounts, PnL, etc.)
 */
export const MOCK_POSITION_ENRICHED = {
  ...MOCK_POSITION,
  pool: MOCK_POOL,
  quoteToken: MOCK_USDC,
  baseToken: MOCK_WETH,
  currentPrice: '2500.00',
  quoteTokenAmount: '5000.00',
  baseTokenAmount: '2.0',
  totalValueInQuote: '10000.00',
  feesCollectedQuote: '150.00',
  feesCollectedBase: '0.05',
  unrealizedPnL: '250.00',
  inRange: true,
};

/**
 * Mock list of positions for testing position list view
 */
export const MOCK_POSITION_LIST: typeof MOCK_POSITION_ENRICHED[] = [
  MOCK_POSITION_ENRICHED,
  {
    ...MOCK_POSITION_ENRICHED,
    id: 'position-2',
    config: {
      ...MOCK_POSITION_ENRICHED.config,
      nftId: 789012,
    },
    totalValueInQuote: '8000.00',
    inRange: false,
  },
  {
    ...MOCK_POSITION_ENRICHED,
    id: 'position-3',
    config: {
      ...MOCK_POSITION_ENRICHED.config,
      nftId: 345678,
    },
    totalValueInQuote: '12000.00',
    unrealizedPnL: '-100.00',
  },
];

/**
 * API Response wrapper for mock data
 */
export function createMockApiResponse<T>(data: T) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * API Error response for testing error states
 */
export function createMockApiError(
  code: string,
  message: string,
  statusCode = 400
) {
  return {
    success: false,
    error: {
      code,
      message,
      details: {},
    },
    timestamp: new Date().toISOString(),
    statusCode,
  };
}
