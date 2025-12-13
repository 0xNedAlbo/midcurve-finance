/**
 * Strategy Service Test Fixtures
 *
 * Provides mock data and helper functions for testing the StrategyService.
 */

import type { StrategyConfig, StrategyStatus } from '@midcurve/shared';
import type { CreateStrategyInput, ActivateStrategyInput } from '../types/strategy/index.js';

// ============================================================================
// MOCK IDS
// ============================================================================

export const MOCK_USER_ID = 'test_user_123';
export const MOCK_STRATEGY_ID = 'test_strategy_456';
export const MOCK_POSITION_ID = 'test_position_789';
export const MOCK_WALLET_ID = 'test_wallet_012';
export const MOCK_TOKEN_ID = 'test_token_345';
export const MOCK_POOL_ID = 'test_pool_678';
export const MOCK_BASIC_CURRENCY_USD_ID = 'basic_currency_usd';
export const MOCK_BASIC_CURRENCY_ETH_ID = 'basic_currency_eth';

// ============================================================================
// MOCK CONFIGS
// ============================================================================

export const mockDeltaNeutralConfig: StrategyConfig = {
  targetDelta: 0,
  rebalanceThreshold: 0.05,
  maxPositions: 5,
};

export const mockYieldOptimizerConfig: StrategyConfig = {
  targetApr: 0.2,
  riskLevel: 'medium',
  autoCompound: true,
};

// ============================================================================
// CREATE INPUT FIXTURES
// ============================================================================

export function createMockStrategyInput(
  overrides: Partial<CreateStrategyInput> = {}
): CreateStrategyInput {
  return {
    userId: MOCK_USER_ID,
    name: 'Test Delta Neutral Strategy',
    strategyType: 'delta-neutral',
    config: mockDeltaNeutralConfig,
    ...overrides,
  };
}

export function createMockActivateInput(
  overrides: Partial<ActivateStrategyInput> = {}
): ActivateStrategyInput {
  return {
    chainId: 1337, // Local EVM
    contractAddress: '0x1234567890123456789012345678901234567890',
    ...overrides,
  };
}

// ============================================================================
// DATABASE RESULT FIXTURES
// ============================================================================

export interface MockStrategyDbResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  name: string;
  strategyType: string;
  state: string;
  contractAddress: string | null;
  chainId: number | null;
  quoteTokenId: string | null;
  currentValue: string;
  currentCostBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  collectedFees: string;
  unClaimedFees: string;
  realizedCashflow: string;
  unrealizedCashflow: string;
  skippedPositionIds: string[];
  config: unknown;
  quoteToken?: any;
  positions?: any[];
  automationWallets?: any[];
}

export function createMockStrategyDbResult(
  overrides: Partial<MockStrategyDbResult> = {}
): MockStrategyDbResult {
  const now = new Date();
  return {
    id: MOCK_STRATEGY_ID,
    createdAt: now,
    updatedAt: now,
    userId: MOCK_USER_ID,
    name: 'Test Delta Neutral Strategy',
    strategyType: 'delta-neutral',
    state: 'pending',
    contractAddress: null,
    chainId: null,
    quoteTokenId: null,
    currentValue: '0',
    currentCostBasis: '0',
    realizedPnl: '0',
    unrealizedPnl: '0',
    collectedFees: '0',
    unClaimedFees: '0',
    realizedCashflow: '0',
    unrealizedCashflow: '0',
    skippedPositionIds: [],
    config: mockDeltaNeutralConfig,
    ...overrides,
  };
}

export function createMockActiveStrategyDbResult(
  overrides: Partial<MockStrategyDbResult> = {}
): MockStrategyDbResult {
  return createMockStrategyDbResult({
    state: 'active',
    contractAddress: '0x1234567890123456789012345678901234567890',
    chainId: 1337,
    ...overrides,
  });
}

// ============================================================================
// TOKEN FIXTURES
// ============================================================================

export function createMockTokenDbResult(
  overrides: Partial<any> = {}
): any {
  const now = new Date();
  return {
    id: MOCK_TOKEN_ID,
    createdAt: now,
    updatedAt: now,
    tokenType: 'erc20',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    logoUrl: null,
    coingeckoId: 'usd-coin',
    marketCap: 50000000000,
    config: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chainId: 1,
      basicCurrencyId: MOCK_BASIC_CURRENCY_USD_ID,
    },
    ...overrides,
  };
}

export function createMockWethTokenDbResult(
  overrides: Partial<any> = {}
): any {
  const now = new Date();
  return {
    id: 'test_token_weth',
    createdAt: now,
    updatedAt: now,
    tokenType: 'erc20',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    logoUrl: null,
    coingeckoId: 'weth',
    marketCap: 10000000000,
    config: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      chainId: 1,
      basicCurrencyId: MOCK_BASIC_CURRENCY_ETH_ID,
    },
    ...overrides,
  };
}

// ============================================================================
// POOL FIXTURES
// ============================================================================

export function createMockPoolDbResult(
  overrides: Partial<any> = {}
): any {
  const now = new Date();
  return {
    id: MOCK_POOL_ID,
    createdAt: now,
    updatedAt: now,
    protocol: 'uniswapv3',
    poolType: 'CL_TICKS',
    token0Id: MOCK_TOKEN_ID,
    token1Id: 'test_token_weth',
    feeBps: 3000,
    config: {
      poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
      chainId: 1,
      tickSpacing: 60,
    },
    state: {
      sqrtPriceX96: '1234567890123456789012345678',
      liquidity: '1000000000000000000',
      currentTick: 0,
    },
    token0: createMockTokenDbResult(),
    token1: createMockWethTokenDbResult(),
    ...overrides,
  };
}

// ============================================================================
// POSITION FIXTURES
// ============================================================================

export function createMockPositionDbResult(
  overrides: Partial<any> = {}
): any {
  const now = new Date();
  return {
    id: MOCK_POSITION_ID,
    createdAt: now,
    updatedAt: now,
    protocol: 'uniswapv3',
    positionType: 'CL_TICKS',
    userId: MOCK_USER_ID,
    strategyId: null,
    positionHash: 'uniswapv3/1/123456',
    currentValue: '1000000000', // 1000 USDC (6 decimals)
    currentCostBasis: '900000000', // 900 USDC
    realizedPnl: '50000000', // 50 USDC
    unrealizedPnl: '100000000', // 100 USDC
    realizedCashflow: '0',
    unrealizedCashflow: '0',
    collectedFees: '25000000', // 25 USDC
    unClaimedFees: '5000000', // 5 USDC
    lastFeesCollectedAt: now,
    totalApr: 25.5,
    priceRangeLower: '1500000000',
    priceRangeUpper: '2000000000',
    poolId: MOCK_POOL_ID,
    isToken0Quote: true, // USDC is token0, so token0 is quote
    positionOpenedAt: now,
    positionClosedAt: null,
    isActive: true,
    config: {
      chainId: 1,
      nftId: 123456,
      poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
      tickLower: -1000,
      tickUpper: 1000,
    },
    state: {
      ownerAddress: '0x1111111111111111111111111111111111111111',
      liquidity: '1000000000000000000',
      feeGrowthInside0LastX128: '0',
      feeGrowthInside1LastX128: '0',
      tokensOwed0: '0',
      tokensOwed1: '0',
    },
    pool: createMockPoolDbResult(),
    ...overrides,
  };
}

// ============================================================================
// AUTOMATION WALLET FIXTURES
// ============================================================================

export function createMockAutomationWalletDbResult(
  overrides: Partial<any> = {}
): any {
  const now = new Date();
  return {
    id: MOCK_WALLET_ID,
    createdAt: now,
    updatedAt: now,
    userId: MOCK_USER_ID,
    strategyId: null,
    walletType: 'evm',
    label: 'Test EVM Wallet',
    walletHash: 'evm/1/0x1111111111111111111111111111111111111111',
    isActive: true,
    lastUsedAt: null,
    encryptedPrivateKey: 'encrypted_key_data',
    ...overrides,
  };
}

// ============================================================================
// STATE TRANSITION TEST DATA
// ============================================================================

export const VALID_TRANSITIONS: Array<{
  from: StrategyStatus;
  to: StrategyStatus;
  method: 'activate' | 'pause' | 'resume' | 'shutdown';
}> = [
  { from: 'pending', to: 'active', method: 'activate' },
  { from: 'active', to: 'paused', method: 'pause' },
  { from: 'paused', to: 'active', method: 'resume' },
  { from: 'active', to: 'shutdown', method: 'shutdown' },
  { from: 'paused', to: 'shutdown', method: 'shutdown' },
];

export const INVALID_TRANSITIONS: Array<{
  from: StrategyStatus;
  to: StrategyStatus;
  method: 'activate' | 'pause' | 'resume' | 'shutdown';
}> = [
  { from: 'active', to: 'active', method: 'activate' }, // Already active
  { from: 'paused', to: 'active', method: 'activate' }, // Should use resume
  { from: 'shutdown', to: 'active', method: 'activate' }, // Terminal state
  { from: 'pending', to: 'paused', method: 'pause' }, // Not active yet
  { from: 'shutdown', to: 'paused', method: 'pause' }, // Terminal state
  { from: 'pending', to: 'active', method: 'resume' }, // Not paused
  { from: 'active', to: 'active', method: 'resume' }, // Not paused
  { from: 'shutdown', to: 'active', method: 'resume' }, // Terminal state
  { from: 'pending', to: 'shutdown', method: 'shutdown' }, // Not deployed yet
  { from: 'shutdown', to: 'shutdown', method: 'shutdown' }, // Already shutdown
];
