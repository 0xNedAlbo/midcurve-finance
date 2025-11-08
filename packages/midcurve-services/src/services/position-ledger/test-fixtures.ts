/**
 * Test fixtures for Position Ledger Service tests
 *
 * Provides reusable test data for position ledger event testing.
 * Each fixture contains:
 * - input: CreatePositionLedgerEventInput (for service.addItem())
 * - dbResult: Database result (for mock return value)
 *
 * Fixtures follow realistic Uniswap V3 scenarios with proper state progression.
 */

import type {
  CreateUniswapV3LedgerEventInput,
  UniswapV3LedgerEventDiscoverInput,
} from '../types/position-ledger/position-ledger-event-input.js';

/**
 * Fixture structure for position ledger events
 */
export interface LedgerEventFixture {
  input: CreateUniswapV3LedgerEventInput;
  dbResult: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    positionId: string;
    protocol: string;
    previousId: string | null;
    timestamp: Date;
    eventType: string;
    inputHash: string;
    poolPrice: string;
    token0Amount: string;
    token1Amount: string;
    tokenValue: string;
    rewards: object[];
    deltaCostBasis: string;
    costBasisAfter: string;
    deltaPnl: string;
    pnlAfter: string;
    config: object;
    state: object;
  };
}

/**
 * Fixture structure for discovery inputs
 */
export interface LedgerEventDiscoveryFixture {
  input: UniswapV3LedgerEventDiscoverInput;
}

// ============================================================================
// UNISWAP V3 EVENT FIXTURES
// ============================================================================

/**
 * INCREASE_POSITION event (First event in chain)
 *
 * Scenario: User adds liquidity to a new WETH/USDC position
 * - Pool: WETH/USDC (token0=WETH, token1=USDC)
 * - Quote token: USDC (token1)
 * - Pool price: 2000 USDC per WETH
 * - Liquidity added: 1000000
 * - Amount0 (WETH): 0.5 WETH = 500000000000000000 wei
 * - Amount1 (USDC): 1000 USDC = 1000000000 micro-USDC
 * - Total value: 2000 USDC = 2000000000 micro-USDC
 * - Cost basis after: 2000 USDC (first deposit)
 * - PnL after: 0 (no realization yet)
 */
export const INCREASE_POSITION_FIRST: LedgerEventFixture = {
  input: {
    positionId: 'position_001',
    protocol: 'uniswapv3',
    previousId: null, // First event
    timestamp: new Date('2024-01-01T00:00:00Z'),
    eventType: 'INCREASE_POSITION',
    inputHash: 'hash_increase_1',
    poolPrice: 2000_000000n, // 2000 USDC per WETH (6 decimals)
    token0Amount: 500000000000000000n, // 0.5 WETH (18 decimals)
    token1Amount: 1000_000000n, // 1000 USDC (6 decimals)
    tokenValue: 2000_000000n, // 2000 USDC total value
    rewards: [],
    deltaCostBasis: 2000_000000n, // +2000 USDC cost basis
    costBasisAfter: 2000_000000n, // Total: 2000 USDC
    deltaPnl: 0n, // No PnL on deposit
    pnlAfter: 0n, // Total PnL: 0
    config: {
      chainId: 1,
      nftId: 123456n,
      blockNumber: 18000000n,
      txIndex: 10,
      logIndex: 5,
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      deltaL: 1000000n,
      liquidityAfter: 1000000n,
      feesCollected0: 0n,
      feesCollected1: 0n,
      uncollectedPrincipal0After: 0n,
      uncollectedPrincipal1After: 0n,
      sqrtPriceX96: 1461446703485210103287273052203988822378723970341n,
    },
    state: {
      eventType: 'INCREASE_LIQUIDITY',
      tokenId: 123456n,
      liquidity: 1000000n,
      amount0: 500000000000000000n,
      amount1: 1000_000000n,
    },
  },
  dbResult: {
    id: 'event_increase_001',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    positionId: 'position_001',
    protocol: 'uniswapv3',
    previousId: null,
    timestamp: new Date('2024-01-01T00:00:00Z'),
    eventType: 'INCREASE_POSITION',
    inputHash: 'hash_increase_1',
    poolPrice: '2000000000',
    token0Amount: '500000000000000000',
    token1Amount: '1000000000',
    tokenValue: '2000000000',
    rewards: [],
    deltaCostBasis: '2000000000',
    costBasisAfter: '2000000000',
    deltaPnl: '0',
    pnlAfter: '0',
    config: {
      chainId: 1,
      nftId: '123456',
      blockNumber: '18000000',
      txIndex: 10,
      logIndex: 5,
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      deltaL: '1000000',
      liquidityAfter: '1000000',
      feesCollected0: '0',
      feesCollected1: '0',
      uncollectedPrincipal0After: '0',
      uncollectedPrincipal1After: '0',
      sqrtPriceX96: '1461446703485210103287273052203988822378723970341',
    },
    state: {
      eventType: 'INCREASE_LIQUIDITY',
      tokenId: '123456',
      liquidity: '1000000',
      amount0: '500000000000000000',
      amount1: '1000000000',
    },
  },
};

/**
 * DECREASE_POSITION event (Second event in chain)
 *
 * Scenario: User removes 50% of liquidity, realizing PnL
 * - Previous event: INCREASE_POSITION_FIRST
 * - Liquidity removed: 500000 (50% of 1000000)
 * - Pool price: 2200 USDC per WETH (price increased 10%)
 * - Amount0 (WETH): 0.25 WETH = 250000000000000000 wei
 * - Amount1 (USDC): 550 USDC = 550000000 micro-USDC
 * - Total value: 1100 USDC = 1100000000 micro-USDC (at current price)
 * - Proportional cost basis: 1000 USDC (50% of 2000)
 * - Realized PnL: +100 USDC (1100 - 1000)
 * - Cost basis after: 1000 USDC (2000 - 1000)
 * - PnL after: +100 USDC
 */
export const DECREASE_POSITION_SECOND: LedgerEventFixture = {
  input: {
    positionId: 'position_001',
    protocol: 'uniswapv3',
    previousId: 'event_increase_001',
    timestamp: new Date('2024-01-02T00:00:00Z'),
    eventType: 'DECREASE_POSITION',
    inputHash: 'hash_decrease_1',
    poolPrice: 2200_000000n, // Price increased to 2200 USDC
    token0Amount: 250000000000000000n, // 0.25 WETH
    token1Amount: 550_000000n, // 550 USDC
    tokenValue: 1100_000000n, // 1100 USDC total value
    rewards: [],
    deltaCostBasis: -1000_000000n, // -1000 USDC (proportional cost basis removed)
    costBasisAfter: 1000_000000n, // 2000 - 1000 = 1000 USDC
    deltaPnl: 100_000000n, // +100 USDC profit (1100 - 1000)
    pnlAfter: 100_000000n, // Total PnL: +100 USDC
    config: {
      chainId: 1,
      nftId: 123456n,
      blockNumber: 18000100n,
      txIndex: 15,
      logIndex: 8,
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      deltaL: -500000n,
      liquidityAfter: 500000n,
      feesCollected0: 0n,
      feesCollected1: 0n,
      uncollectedPrincipal0After: 250000000000000000n, // Tokens added to uncollected pool
      uncollectedPrincipal1After: 550_000000n,
      sqrtPriceX96: 1533622919764858576023969693395666620607296507328n,
    },
    state: {
      eventType: 'DECREASE_LIQUIDITY',
      tokenId: 123456n,
      liquidity: 500000n,
      amount0: 250000000000000000n,
      amount1: 550_000000n,
    },
  },
  dbResult: {
    id: 'event_decrease_001',
    createdAt: new Date('2024-01-02T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    positionId: 'position_001',
    protocol: 'uniswapv3',
    previousId: 'event_increase_001',
    timestamp: new Date('2024-01-02T00:00:00Z'),
    eventType: 'DECREASE_POSITION',
    inputHash: 'hash_decrease_1',
    poolPrice: '2200000000',
    token0Amount: '250000000000000000',
    token1Amount: '550000000',
    tokenValue: '1100000000',
    rewards: [],
    deltaCostBasis: '-1000000000',
    costBasisAfter: '1000000000',
    deltaPnl: '100000000',
    pnlAfter: '100000000',
    config: {
      chainId: 1,
      nftId: '123456',
      blockNumber: '18000100',
      txIndex: 15,
      logIndex: 8,
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      deltaL: '-500000',
      liquidityAfter: '500000',
      feesCollected0: '0',
      feesCollected1: '0',
      uncollectedPrincipal0After: '250000000000000000',
      uncollectedPrincipal1After: '550000000',
      sqrtPriceX96: '1533622919764858576023969693395666620607296507328',
    },
    state: {
      eventType: 'DECREASE_LIQUIDITY',
      tokenId: '123456',
      liquidity: '500000',
      amount0: '250000000000000000',
      amount1: '550000000',
    },
  },
};

/**
 * COLLECT event (Third event in chain)
 *
 * Scenario: User collects uncollected principal + accrued fees
 * - Previous event: DECREASE_POSITION_SECOND
 * - Uncollected principal: 0.25 WETH + 550 USDC (from DECREASE)
 * - Accrued fees: 0.01 WETH + 20 USDC
 * - Total collected: 0.26 WETH + 570 USDC
 * - Fee separation logic:
 *   - Principal collected: min(collected, uncollected) for each token
 *   - Fees collected: collected - principal
 * - Cost basis unchanged (fees don't affect cost basis)
 * - PnL unchanged (fees tracked separately as rewards)
 */
export const COLLECT_THIRD: LedgerEventFixture = {
  input: {
    positionId: 'position_001',
    protocol: 'uniswapv3',
    previousId: 'event_decrease_001',
    timestamp: new Date('2024-01-03T00:00:00Z'),
    eventType: 'COLLECT',
    inputHash: 'hash_collect_1',
    poolPrice: 2200_000000n, // Same price
    token0Amount: 260000000000000000n, // 0.26 WETH (0.25 principal + 0.01 fees)
    token1Amount: 570_000000n, // 570 USDC (550 principal + 20 fees)
    tokenValue: 570_000000n, // Value in quote token (principal only, no double-counting)
    rewards: [
      {
        tokenId: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH address
        tokenAmount: 10000000000000000n, // 0.01 WETH fees
        tokenValue: 22_000000n, // 22 USDC value
      },
      {
        tokenId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC address
        tokenAmount: 20_000000n, // 20 USDC fees
        tokenValue: 20_000000n, // 20 USDC value
      },
    ],
    deltaCostBasis: 0n, // Fees don't affect cost basis
    costBasisAfter: 1000_000000n, // Unchanged
    deltaPnl: 0n, // Fees tracked separately, not in PnL
    pnlAfter: 100_000000n, // Unchanged from previous
    config: {
      chainId: 1,
      nftId: 123456n,
      blockNumber: 18000200n,
      txIndex: 20,
      logIndex: 12,
      txHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
      deltaL: 0n, // No liquidity change
      liquidityAfter: 500000n, // Unchanged
      feesCollected0: 10000000000000000n, // 0.01 WETH fees
      feesCollected1: 20_000000n, // 20 USDC fees
      uncollectedPrincipal0After: 0n, // All principal collected
      uncollectedPrincipal1After: 0n,
      sqrtPriceX96: 1533622919764858576023969693395666620607296507328n,
    },
    state: {
      eventType: 'COLLECT',
      tokenId: 123456n,
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
      amount0: 260000000000000000n,
      amount1: 570_000000n,
    },
  },
  dbResult: {
    id: 'event_collect_001',
    createdAt: new Date('2024-01-03T00:00:00Z'),
    updatedAt: new Date('2024-01-03T00:00:00Z'),
    positionId: 'position_001',
    protocol: 'uniswapv3',
    previousId: 'event_decrease_001',
    timestamp: new Date('2024-01-03T00:00:00Z'),
    eventType: 'COLLECT',
    inputHash: 'hash_collect_1',
    poolPrice: '2200000000',
    token0Amount: '260000000000000000',
    token1Amount: '570000000',
    tokenValue: '570000000',
    rewards: [
      {
        tokenId: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenAmount: '10000000000000000',
        tokenValue: '22000000',
      },
      {
        tokenId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenAmount: '20000000',
        tokenValue: '20000000',
      },
    ],
    deltaCostBasis: '0',
    costBasisAfter: '1000000000',
    deltaPnl: '0',
    pnlAfter: '100000000',
    config: {
      chainId: 1,
      nftId: '123456',
      blockNumber: '18000200',
      txIndex: 20,
      logIndex: 12,
      txHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
      deltaL: '0',
      liquidityAfter: '500000',
      feesCollected0: '10000000000000000',
      feesCollected1: '20000000',
      uncollectedPrincipal0After: '0',
      uncollectedPrincipal1After: '0',
      sqrtPriceX96: '1533622919764858576023969693395666620607296507328',
    },
    state: {
      eventType: 'COLLECT',
      tokenId: '123456',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
      amount0: '260000000000000000',
      amount1: '570000000',
    },
  },
};

// ============================================================================
// DISCOVERY INPUT FIXTURES
// ============================================================================

/**
 * Discovery input for INCREASE_LIQUIDITY event
 */
export const DISCOVER_INCREASE: LedgerEventDiscoveryFixture = {
  input: {
    eventType: 'INCREASE_LIQUIDITY',
    blockNumber: 18000000n,
    transactionIndex: 10,
    logIndex: 5,
    transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    tokenId: 123456n,
    liquidity: 1000000n,
    amount0: 500000000000000000n,
    amount1: 1000_000000n,
  },
};

/**
 * Discovery input for DECREASE_LIQUIDITY event
 */
export const DISCOVER_DECREASE: LedgerEventDiscoveryFixture = {
  input: {
    eventType: 'DECREASE_LIQUIDITY',
    blockNumber: 18000100n,
    transactionIndex: 15,
    logIndex: 8,
    transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    timestamp: new Date('2024-01-02T00:00:00Z'),
    tokenId: 123456n,
    liquidity: 500000n,
    amount0: 250000000000000000n,
    amount1: 550_000000n,
  },
};

/**
 * Discovery input for COLLECT event
 */
export const DISCOVER_COLLECT: LedgerEventDiscoveryFixture = {
  input: {
    eventType: 'COLLECT',
    blockNumber: 18000200n,
    transactionIndex: 20,
    logIndex: 12,
    transactionHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
    timestamp: new Date('2024-01-03T00:00:00Z'),
    tokenId: 123456n,
    amount0: 260000000000000000n,
    amount1: 570_000000n,
    recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a custom event fixture with overrides
 *
 * Useful for testing edge cases or specific scenarios.
 *
 * @param base - Base fixture to extend
 * @param overrides - Fields to override in both input and dbResult
 * @returns Custom fixture
 */
export function createEventFixture(
  base: LedgerEventFixture,
  overrides: Partial<LedgerEventFixture>
): LedgerEventFixture {
  return {
    input: {
      ...base.input,
      ...(overrides.input ?? {}),
    },
    dbResult: {
      ...base.dbResult,
      ...(overrides.dbResult ?? {}),
    },
  };
}
