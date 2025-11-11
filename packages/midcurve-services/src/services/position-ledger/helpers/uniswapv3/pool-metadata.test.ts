/**
 * Unit tests for pool metadata fetching utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@midcurve/database';
import { pino } from 'pino';
import { fetchPoolWithTokens } from './pool-metadata.js';

describe('fetchPoolWithTokens', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    mockReset(prismaMock);
  });

  it('should fetch pool with tokens successfully', async () => {
    const mockPool = {
      id: 'pool_eth_usdc_500',
      fee: 500n,
      token0: {
        id: 'token_weth',
        symbol: 'WETH',
        decimals: 18,
      },
      token1: {
        id: 'token_usdc',
        symbol: 'USDC',
        decimals: 6,
      },
    };

    prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);

    const result = await fetchPoolWithTokens('pool_eth_usdc_500', prismaMock, logger);

    expect(result.pool).toEqual(mockPool);
    expect(result.token0.symbol).toBe('WETH');
    expect(result.token1.symbol).toBe('USDC');
    expect(result.token0Decimals).toBe(18);
    expect(result.token1Decimals).toBe(6);
    expect(result.token0IsQuote).toBe(false); // token1 (USDC) is quote by default

    expect(prismaMock.pool.findUnique).toHaveBeenCalledWith({
      where: { id: 'pool_eth_usdc_500' },
      include: {
        token0: true,
        token1: true,
      },
    });
  });

  it('should set token0IsQuote to false by default', async () => {
    const mockPool = {
      id: 'pool_123',
      fee: 3000n,
      token0: {
        id: 'token_a',
        symbol: 'TOKENA',
        decimals: 18,
      },
      token1: {
        id: 'token_b',
        symbol: 'TOKENB',
        decimals: 18,
      },
    };

    prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);

    const result = await fetchPoolWithTokens('pool_123', prismaMock, logger);

    // By default, token1 is assumed to be quote
    expect(result.token0IsQuote).toBe(false);
  });

  it('should handle different decimal configurations', async () => {
    const mockPool = {
      id: 'pool_123',
      fee: 10000n,
      token0: {
        id: 'token_a',
        symbol: 'TOKENA',
        decimals: 6, // USDC-like
      },
      token1: {
        id: 'token_b',
        symbol: 'TOKENB',
        decimals: 18, // ETH-like
      },
    };

    prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);

    const result = await fetchPoolWithTokens('pool_123', prismaMock, logger);

    expect(result.token0Decimals).toBe(6);
    expect(result.token1Decimals).toBe(18);
  });

  it('should throw error if pool not found', async () => {
    prismaMock.pool.findUnique.mockResolvedValue(null);

    await expect(
      fetchPoolWithTokens('pool_nonexistent', prismaMock, logger)
    ).rejects.toThrow('Pool not found: pool_nonexistent');

    expect(prismaMock.pool.findUnique).toHaveBeenCalledWith({
      where: { id: 'pool_nonexistent' },
      include: {
        token0: true,
        token1: true,
      },
    });
  });

  it('should throw error if token0 is missing', async () => {
    const mockPool = {
      id: 'pool_123',
      fee: 500n,
      token0: null, // Missing
      token1: {
        id: 'token_b',
        symbol: 'TOKENB',
        decimals: 6,
      },
    };

    prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);

    await expect(
      fetchPoolWithTokens('pool_123', prismaMock, logger)
    ).rejects.toThrow('Pool tokens not found for pool: pool_123');
  });

  it('should throw error if token1 is missing', async () => {
    const mockPool = {
      id: 'pool_123',
      fee: 500n,
      token0: {
        id: 'token_a',
        symbol: 'TOKENA',
        decimals: 18,
      },
      token1: null, // Missing
    };

    prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);

    await expect(
      fetchPoolWithTokens('pool_123', prismaMock, logger)
    ).rejects.toThrow('Pool tokens not found for pool: pool_123');
  });

  it('should throw error if both tokens are missing', async () => {
    const mockPool = {
      id: 'pool_123',
      fee: 500n,
      token0: null,
      token1: null,
    };

    prismaMock.pool.findUnique.mockResolvedValue(mockPool as any);

    await expect(
      fetchPoolWithTokens('pool_123', prismaMock, logger)
    ).rejects.toThrow('Pool tokens not found for pool: pool_123');
  });
});
