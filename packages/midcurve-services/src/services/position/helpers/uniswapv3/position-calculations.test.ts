/**
 * Unit tests for position calculations helpers
 *
 * Tests for getLedgerSummary, calculateUnclaimedFees, calculateCurrentPositionValue,
 * and getCurrentLiquidityFromLedger functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@midcurve/database';
import { pino } from 'pino';
import {
  getLedgerSummary,
  calculateUnclaimedFees,
  getUncollectedPrincipalFromLedger,
  calculateCurrentPositionValue,
  getCurrentLiquidityFromLedger,
  type LedgerSummary,
} from './position-calculations.js';
import type { UniswapV3PositionLedgerService } from '../../../position-ledger/uniswapv3-position-ledger-service.js';
import type { UniswapV3Position, UniswapV3Pool } from '@midcurve/shared';
import type { EvmConfig } from '../../../../config/evm.js';

describe('getLedgerSummary', () => {
  let ledgerServiceMock: DeepMockProxy<UniswapV3PositionLedgerService>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    ledgerServiceMock = mockDeep<UniswapV3PositionLedgerService>();
    mockReset(ledgerServiceMock);
  });

  it('should return zero values when no ledger events exist', async () => {
    ledgerServiceMock.findAllItems.mockResolvedValue([]);

    const result = await getLedgerSummary('pos_123', ledgerServiceMock, logger);

    expect(result.costBasis).toBe(0n);
    expect(result.realizedPnl).toBe(0n);
    expect(result.collectedFees).toBe(0n);
    expect(result.lastFeesCollectedAt).toBeInstanceOf(Date);
  });

  it('should extract cost basis and PnL from latest event', async () => {
    const mockEvents = [
      {
        id: 'evt_3',
        positionId: 'pos_123',
        eventType: 'INCREASE_LIQUIDITY',
        timestamp: new Date('2024-01-03'),
        costBasisAfter: 3000n,
        pnlAfter: -50n,
        rewards: [],
      },
      {
        id: 'evt_2',
        positionId: 'pos_123',
        eventType: 'INCREASE_LIQUIDITY',
        timestamp: new Date('2024-01-02'),
        costBasisAfter: 2000n,
        pnlAfter: 0n,
        rewards: [],
      },
    ];

    ledgerServiceMock.findAllItems.mockResolvedValue(mockEvents as any);

    const result = await getLedgerSummary('pos_123', ledgerServiceMock, logger);

    expect(result.costBasis).toBe(3000n);
    expect(result.realizedPnl).toBe(-50n);
    expect(result.collectedFees).toBe(0n);
  });

  it('should sum collected fees from COLLECT events', async () => {
    const mockEvents = [
      {
        id: 'evt_4',
        positionId: 'pos_123',
        eventType: 'COLLECT',
        timestamp: new Date('2024-01-04'),
        costBasisAfter: 2000n,
        pnlAfter: 0n,
        rewards: [
          { tokenId: 'token_0', tokenValue: 100n, tokenAmount: 100n },
          { tokenId: 'token_1', tokenValue: 200n, tokenAmount: 200n },
        ],
      },
      {
        id: 'evt_3',
        positionId: 'pos_123',
        eventType: 'COLLECT',
        timestamp: new Date('2024-01-03'),
        costBasisAfter: 2000n,
        pnlAfter: 0n,
        rewards: [
          { tokenId: 'token_0', tokenValue: 50n, tokenAmount: 50n },
        ],
      },
      {
        id: 'evt_2',
        positionId: 'pos_123',
        eventType: 'INCREASE_LIQUIDITY',
        timestamp: new Date('2024-01-02'),
        costBasisAfter: 2000n,
        pnlAfter: 0n,
        rewards: [],
      },
    ];

    ledgerServiceMock.findAllItems.mockResolvedValue(mockEvents as any);

    const result = await getLedgerSummary('pos_123', ledgerServiceMock, logger);

    // Total fees: 100 + 200 + 50 = 350
    expect(result.collectedFees).toBe(350n);
    expect(result.lastFeesCollectedAt).toEqual(new Date('2024-01-04'));
  });

  it('should ignore COLLECT events with no rewards', async () => {
    const mockEvents = [
      {
        id: 'evt_2',
        positionId: 'pos_123',
        eventType: 'COLLECT',
        timestamp: new Date('2024-01-02'),
        costBasisAfter: 2000n,
        pnlAfter: 0n,
        rewards: [], // No rewards
      },
      {
        id: 'evt_1',
        positionId: 'pos_123',
        eventType: 'INCREASE_LIQUIDITY',
        timestamp: new Date('2024-01-01'),
        costBasisAfter: 2000n,
        pnlAfter: 0n,
        rewards: [],
      },
    ];

    ledgerServiceMock.findAllItems.mockResolvedValue(mockEvents as any);

    const result = await getLedgerSummary('pos_123', ledgerServiceMock, logger);

    expect(result.collectedFees).toBe(0n);
  });

  it('should track most recent fee collection timestamp', async () => {
    const mockEvents = [
      {
        id: 'evt_3',
        positionId: 'pos_123',
        eventType: 'COLLECT',
        timestamp: new Date('2024-01-05'), // Most recent
        costBasisAfter: 2000n,
        pnlAfter: 0n,
        rewards: [{ tokenId: 'token_0', tokenValue: 100n, tokenAmount: 100n }],
      },
      {
        id: 'evt_2',
        positionId: 'pos_123',
        eventType: 'COLLECT',
        timestamp: new Date('2024-01-03'),
        costBasisAfter: 2000n,
        pnlAfter: 0n,
        rewards: [{ tokenId: 'token_0', tokenValue: 50n, tokenAmount: 50n }],
      },
    ];

    ledgerServiceMock.findAllItems.mockResolvedValue(mockEvents as any);

    const result = await getLedgerSummary('pos_123', ledgerServiceMock, logger);

    expect(result.lastFeesCollectedAt).toEqual(new Date('2024-01-05'));
  });

  it('should return default values if ledger service throws error', async () => {
    ledgerServiceMock.findAllItems.mockRejectedValue(new Error('Database error'));

    const result = await getLedgerSummary('pos_123', ledgerServiceMock, logger);

    expect(result.costBasis).toBe(0n);
    expect(result.realizedPnl).toBe(0n);
    expect(result.collectedFees).toBe(0n);
    expect(result.lastFeesCollectedAt).toBeInstanceOf(Date);
  });
});

describe('getUncollectedPrincipalFromLedger', () => {
  let ledgerServiceMock: DeepMockProxy<UniswapV3PositionLedgerService>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    ledgerServiceMock = mockDeep<UniswapV3PositionLedgerService>();
    mockReset(ledgerServiceMock);
  });

  it('should return zero when no ledger events exist', async () => {
    ledgerServiceMock.findAllItems.mockResolvedValue([]);

    const result = await getUncollectedPrincipalFromLedger('pos_123', ledgerServiceMock, logger);

    expect(result.uncollectedPrincipal0).toBe(0n);
    expect(result.uncollectedPrincipal1).toBe(0n);
  });

  it('should extract uncollected principal from latest event config', async () => {
    const mockEvents = [
      {
        id: 'evt_2',
        positionId: 'pos_123',
        eventType: 'DECREASE_LIQUIDITY',
        timestamp: new Date('2024-01-02'),
        config: {
          uncollectedPrincipal0After: 500000000000000000n, // 0.5 ETH
          uncollectedPrincipal1After: 1000000000n, // 1000 USDC
        },
      },
      {
        id: 'evt_1',
        positionId: 'pos_123',
        eventType: 'INCREASE_LIQUIDITY',
        timestamp: new Date('2024-01-01'),
        config: {
          uncollectedPrincipal0After: 0n,
          uncollectedPrincipal1After: 0n,
        },
      },
    ];

    ledgerServiceMock.findAllItems.mockResolvedValue(mockEvents as any);

    const result = await getUncollectedPrincipalFromLedger('pos_123', ledgerServiceMock, logger);

    expect(result.uncollectedPrincipal0).toBe(500000000000000000n);
    expect(result.uncollectedPrincipal1).toBe(1000000000n);
  });

  it('should handle errors gracefully and return zero', async () => {
    ledgerServiceMock.findAllItems.mockRejectedValue(new Error('Database error'));

    const result = await getUncollectedPrincipalFromLedger('pos_123', ledgerServiceMock, logger);

    expect(result.uncollectedPrincipal0).toBe(0n);
    expect(result.uncollectedPrincipal1).toBe(0n);
  });
});

describe('calculateUnclaimedFees', () => {
  let evmConfigMock: DeepMockProxy<EvmConfig>;
  let ledgerServiceMock: DeepMockProxy<UniswapV3PositionLedgerService>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    evmConfigMock = mockDeep<EvmConfig>();
    ledgerServiceMock = mockDeep<UniswapV3PositionLedgerService>();
    mockReset(evmConfigMock);
    mockReset(ledgerServiceMock);
  });

  it('should return zero values when position has no liquidity', async () => {
    const position: Partial<UniswapV3Position> = {
      id: 'pos_123',
      config: {
        chainId: 1,
        poolAddress: '0xPool',
        tickLower: -100,
        tickUpper: 100,
      },
      state: {
        liquidity: 0n, // No liquidity
        feeGrowthInside0LastX128: 0n,
        feeGrowthInside1LastX128: 0n,
        tokensOwed0: 0n,
        tokensOwed1: 0n,
      },
      isToken0Quote: true,
    };

    const pool: Partial<UniswapV3Pool> = {
      state: { currentTick: 0, sqrtPriceX96: 79228162514264337593543950336n },
      token0: { decimals: 18 },
      token1: { decimals: 6 },
    };

    const result = await calculateUnclaimedFees(
      position as UniswapV3Position,
      pool as UniswapV3Pool,
      evmConfigMock,
      ledgerServiceMock,
      logger
    );

    expect(result.unclaimedFeesValue).toBe(0n);
    expect(result.unclaimedFees0).toBe(0n);
    expect(result.unclaimedFees1).toBe(0n);
    expect(evmConfigMock.getPublicClient).not.toHaveBeenCalled();
  });

  it('should calculate only incremental fees when no tokensOwed or uncollected principal', async () => {
    const mockClient = {
      readContract: vi.fn(),
    };

    // Mock RPC responses
    mockClient.readContract
      .mockResolvedValueOnce(1000000n) // feeGrowthGlobal0X128
      .mockResolvedValueOnce(2000000n) // feeGrowthGlobal1X128
      .mockResolvedValueOnce([
        0n, 0n,
        500000n, // feeGrowthOutsideLower0X128
        1000000n, // feeGrowthOutsideLower1X128
        0n, 0n, 0, false,
      ]) // tickDataLower
      .mockResolvedValueOnce([
        0n, 0n,
        600000n, // feeGrowthOutsideUpper0X128
        1200000n, // feeGrowthOutsideUpper1X128
        0n, 0n, 0, false,
      ]); // tickDataUpper

    evmConfigMock.getPublicClient.mockReturnValue(mockClient as any);
    ledgerServiceMock.findAllItems.mockResolvedValue([]); // No ledger events

    const position: Partial<UniswapV3Position> = {
      id: 'pos_123',
      config: {
        chainId: 1,
        poolAddress: '0xPool',
        tickLower: -100,
        tickUpper: 100,
      },
      state: {
        liquidity: 1000000000000000000n,
        feeGrowthInside0LastX128: 100000n,
        feeGrowthInside1LastX128: 200000n,
        tokensOwed0: 0n, // No checkpointed fees
        tokensOwed1: 0n,
      },
      isToken0Quote: true,
    };

    const pool: Partial<UniswapV3Pool> = {
      state: {
        currentTick: 0, // In range
        sqrtPriceX96: 79228162514264337593543950336n, // 1:1 price
      },
      token0: { decimals: 18 },
      token1: { decimals: 6 },
    };

    const result = await calculateUnclaimedFees(
      position as UniswapV3Position,
      pool as UniswapV3Pool,
      evmConfigMock,
      ledgerServiceMock,
      logger
    );

    // Result should be >= 0 (only incremental fees)
    expect(result.unclaimedFeesValue).toBeGreaterThanOrEqual(0n);
    expect(result.unclaimedFees0).toBeGreaterThanOrEqual(0n);
    expect(result.unclaimedFees1).toBeGreaterThanOrEqual(0n);
    expect(evmConfigMock.getPublicClient).toHaveBeenCalledWith(1);
    expect(mockClient.readContract).toHaveBeenCalledTimes(4);
  });

  it('should separate pure fees from tokensOwed by subtracting uncollected principal', async () => {
    const mockClient = {
      readContract: vi.fn(),
    };

    // Mock RPC responses (minimal fee growth for simplicity)
    mockClient.readContract
      .mockResolvedValueOnce(1000n) // feeGrowthGlobal0X128
      .mockResolvedValueOnce(2000n) // feeGrowthGlobal1X128
      .mockResolvedValueOnce([0n, 0n, 500n, 1000n, 0n, 0n, 0, false]) // tickDataLower
      .mockResolvedValueOnce([0n, 0n, 600n, 1200n, 0n, 0n, 0, false]); // tickDataUpper

    evmConfigMock.getPublicClient.mockReturnValue(mockClient as any);

    // Mock ledger with uncollected principal
    const mockEvents = [
      {
        id: 'evt_1',
        config: {
          uncollectedPrincipal0After: 500000000000000000n, // 0.5 ETH principal
          uncollectedPrincipal1After: 1000000000n, // 1000 USDC principal
        },
      },
    ];
    ledgerServiceMock.findAllItems.mockResolvedValue(mockEvents as any);

    const position: Partial<UniswapV3Position> = {
      id: 'pos_123',
      config: {
        chainId: 1,
        poolAddress: '0xPool',
        tickLower: -100,
        tickUpper: 100,
      },
      state: {
        liquidity: 1000000000000000000n,
        feeGrowthInside0LastX128: 100n,
        feeGrowthInside1LastX128: 200n,
        tokensOwed0: 500100000000000000n, // 0.5001 ETH (0.5 principal + 0.0001 fees)
        tokensOwed1: 1000050000n, // 1000.05 USDC (1000 principal + 0.05 fees)
      },
      isToken0Quote: true,
    };

    const pool: Partial<UniswapV3Pool> = {
      state: {
        currentTick: 0,
        sqrtPriceX96: 79228162514264337593543950336n, // 1:1 price
      },
      token0: { decimals: 18 },
      token1: { decimals: 6 },
    };

    const result = await calculateUnclaimedFees(
      position as UniswapV3Position,
      pool as UniswapV3Pool,
      evmConfigMock,
      ledgerServiceMock,
      logger
    );

    // Checkpointed fees0 = tokensOwed0 - uncollectedPrincipal0 = 0.0001 ETH
    // Checkpointed fees1 = tokensOwed1 - uncollectedPrincipal1 = 0.05 USDC
    // Total fees = checkpointed + incremental (incremental is very small in this test)
    expect(result.unclaimedFees0).toBeGreaterThanOrEqual(100000000000000n); // At least checkpointed fees
    expect(result.unclaimedFees1).toBeGreaterThanOrEqual(50000n); // At least checkpointed fees
  });

  it('should handle edge case where tokensOwed equals uncollected principal (no fees)', async () => {
    const mockClient = {
      readContract: vi.fn(),
    };

    // Mock RPC responses (zero fee growth)
    mockClient.readContract
      .mockResolvedValueOnce(0n) // feeGrowthGlobal0X128
      .mockResolvedValueOnce(0n) // feeGrowthGlobal1X128
      .mockResolvedValueOnce([0n, 0n, 0n, 0n, 0n, 0n, 0, false]) // tickDataLower
      .mockResolvedValueOnce([0n, 0n, 0n, 0n, 0n, 0n, 0, false]); // tickDataUpper

    evmConfigMock.getPublicClient.mockReturnValue(mockClient as any);

    // Mock ledger with uncollected principal exactly equal to tokensOwed
    const mockEvents = [
      {
        id: 'evt_1',
        config: {
          uncollectedPrincipal0After: 500000000000000000n,
          uncollectedPrincipal1After: 1000000000n,
        },
      },
    ];
    ledgerServiceMock.findAllItems.mockResolvedValue(mockEvents as any);

    const position: Partial<UniswapV3Position> = {
      id: 'pos_123',
      config: {
        chainId: 1,
        poolAddress: '0xPool',
        tickLower: -100,
        tickUpper: 100,
      },
      state: {
        liquidity: 1000000000000000000n,
        feeGrowthInside0LastX128: 0n,
        feeGrowthInside1LastX128: 0n,
        tokensOwed0: 500000000000000000n, // Exactly equals uncollected principal
        tokensOwed1: 1000000000n, // Exactly equals uncollected principal
      },
      isToken0Quote: true,
    };

    const pool: Partial<UniswapV3Pool> = {
      state: {
        currentTick: 0,
        sqrtPriceX96: 79228162514264337593543950336n,
      },
      token0: { decimals: 18 },
      token1: { decimals: 6 },
    };

    const result = await calculateUnclaimedFees(
      position as UniswapV3Position,
      pool as UniswapV3Pool,
      evmConfigMock,
      ledgerServiceMock,
      logger
    );

    // All tokensOwed is principal, no fees checkpointed, no incremental fees
    expect(result.unclaimedFees0).toBe(0n);
    expect(result.unclaimedFees1).toBe(0n);
    expect(result.unclaimedFeesValue).toBe(0n);
  });

  it('should handle RPC call failure gracefully', async () => {
    const mockClient = {
      readContract: vi.fn().mockRejectedValue(new Error('RPC error')),
    };

    evmConfigMock.getPublicClient.mockReturnValue(mockClient as any);
    ledgerServiceMock.findAllItems.mockResolvedValue([]);

    const position: Partial<UniswapV3Position> = {
      id: 'pos_123',
      config: {
        chainId: 1,
        poolAddress: '0xPool',
        tickLower: -100,
        tickUpper: 100,
      },
      state: {
        liquidity: 1000000000000000000n,
        feeGrowthInside0LastX128: 0n,
        feeGrowthInside1LastX128: 0n,
        tokensOwed0: 0n,
        tokensOwed1: 0n,
      },
      isToken0Quote: true,
    };

    const pool: Partial<UniswapV3Pool> = {
      state: { currentTick: 0, sqrtPriceX96: 79228162514264337593543950336n },
      token0: { decimals: 18 },
      token1: { decimals: 6 },
    };

    const result = await calculateUnclaimedFees(
      position as UniswapV3Position,
      pool as UniswapV3Pool,
      evmConfigMock,
      ledgerServiceMock,
      logger
    );

    // Should return zero values on error
    expect(result.unclaimedFeesValue).toBe(0n);
    expect(result.unclaimedFees0).toBe(0n);
    expect(result.unclaimedFees1).toBe(0n);
  });
});

describe('calculateCurrentPositionValue', () => {
  it('should return 0 when position has no liquidity', () => {
    const position: Partial<UniswapV3Position> = {
      config: { tickLower: -100, tickUpper: 100 },
      state: { liquidity: 0n },
      isToken0Quote: true,
    };

    const pool: Partial<UniswapV3Pool> = {
      state: { sqrtPriceX96: 79228162514264337593543950336n },
    };

    const result = calculateCurrentPositionValue(
      position as UniswapV3Position,
      pool as UniswapV3Pool
    );

    expect(result).toBe(0n);
  });

  it('should calculate value for in-range position', () => {
    const position: Partial<UniswapV3Position> = {
      config: { tickLower: -100, tickUpper: 100 },
      state: { liquidity: 1000000000000000000n }, // 1e18
      isToken0Quote: true, // token1 is base
    };

    const pool: Partial<UniswapV3Pool> = {
      state: { sqrtPriceX96: 79228162514264337593543950336n }, // 1:1 price
    };

    const result = calculateCurrentPositionValue(
      position as UniswapV3Position,
      pool as UniswapV3Pool
    );

    // Should return a positive value
    expect(result).toBeGreaterThan(0n);
  });

  it('should calculate value for out-of-range position (below range)', () => {
    const position: Partial<UniswapV3Position> = {
      config: { tickLower: 100, tickUpper: 200 }, // Price below range
      state: { liquidity: 1000000000000000000n },
      isToken0Quote: true,
    };

    const pool: Partial<UniswapV3Pool> = {
      state: { sqrtPriceX96: 56022770974786139918731938227n }, // Price at tick -100 (below range)
    };

    const result = calculateCurrentPositionValue(
      position as UniswapV3Position,
      pool as UniswapV3Pool
    );

    // Should return a positive value (all in base token)
    expect(result).toBeGreaterThan(0n);
  });

  it('should calculate value for out-of-range position (above range)', () => {
    const position: Partial<UniswapV3Position> = {
      config: { tickLower: -200, tickUpper: -100 }, // Price above range
      state: { liquidity: 1000000000000000000n },
      isToken0Quote: true,
    };

    const pool: Partial<UniswapV3Pool> = {
      state: { sqrtPriceX96: 112045541949572279837463876454n }, // Price at tick 100 (above range)
    };

    const result = calculateCurrentPositionValue(
      position as UniswapV3Position,
      pool as UniswapV3Pool
    );

    // Should return a positive value (all in quote token)
    expect(result).toBeGreaterThan(0n);
  });

  it('should handle different quote token designations', () => {
    const positionToken0Quote: Partial<UniswapV3Position> = {
      config: { tickLower: -100, tickUpper: 100 },
      state: { liquidity: 1000000000000000000n },
      isToken0Quote: true, // token1 is base
    };

    const positionToken1Quote: Partial<UniswapV3Position> = {
      config: { tickLower: -100, tickUpper: 100 },
      state: { liquidity: 1000000000000000000n },
      isToken0Quote: false, // token0 is base
    };

    const pool: Partial<UniswapV3Pool> = {
      state: { sqrtPriceX96: 79228162514264337593543950336n },
    };

    const result1 = calculateCurrentPositionValue(
      positionToken0Quote as UniswapV3Position,
      pool as UniswapV3Pool
    );

    const result2 = calculateCurrentPositionValue(
      positionToken1Quote as UniswapV3Position,
      pool as UniswapV3Pool
    );

    // Both should return positive values (may differ due to quote token)
    expect(result1).toBeGreaterThan(0n);
    expect(result2).toBeGreaterThan(0n);
  });
});

describe('getCurrentLiquidityFromLedger', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    mockReset(prismaMock);
  });

  it('should return 0 when no ledger events exist', async () => {
    prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(null);

    const result = await getCurrentLiquidityFromLedger('pos_123', prismaMock, logger);

    expect(result).toBe(0n);
    expect(prismaMock.positionLedgerEvent.findFirst).toHaveBeenCalledWith({
      where: { positionId: 'pos_123' },
      orderBy: { timestamp: 'desc' },
      select: { config: true },
    });
  });

  it('should extract liquidity from last event config', async () => {
    const mockEvent = {
      config: { liquidityAfter: '1000000000000000000' },
    };

    prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(mockEvent as any);

    const result = await getCurrentLiquidityFromLedger('pos_123', prismaMock, logger);

    expect(result).toBe(1000000000000000000n);
  });

  it('should handle large liquidity values', async () => {
    const mockEvent = {
      config: { liquidityAfter: '999999999999999999999999' },
    };

    prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(mockEvent as any);

    const result = await getCurrentLiquidityFromLedger('pos_123', prismaMock, logger);

    expect(result).toBe(999999999999999999999999n);
  });

  it('should return 0 if liquidityAfter is missing in config', async () => {
    const mockEvent = {
      config: {}, // Missing liquidityAfter
    };

    prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(mockEvent as any);

    const result = await getCurrentLiquidityFromLedger('pos_123', prismaMock, logger);

    expect(result).toBe(0n);
  });

  it('should return 0 if liquidityAfter is 0', async () => {
    const mockEvent = {
      config: { liquidityAfter: '0' },
    };

    prismaMock.positionLedgerEvent.findFirst.mockResolvedValue(mockEvent as any);

    const result = await getCurrentLiquidityFromLedger('pos_123', prismaMock, logger);

    expect(result).toBe(0n);
  });
});
