/**
 * Unit tests for position metadata fetching utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import { fetchPositionMetadata } from './position-metadata.js';
import type { UniswapV3Position } from '@midcurve/shared';

describe('fetchPositionMetadata', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    mockReset(prismaMock);
  });

  it('should fetch position metadata successfully', async () => {
    const mockPosition = {
      id: 'pos_123',
      protocol: 'uniswapv3',
      poolId: 'pool_456',
      config: { nftId: 789, chainId: 1 },
      pool: { id: 'pool_456' },
    };

    prismaMock.position.findUnique.mockResolvedValue(mockPosition as any);

    const result = await fetchPositionMetadata('pos_123', prismaMock, logger);

    expect(result.position).toEqual(mockPosition);
    expect(result.nftId).toBe(789n);
    expect(result.chainId).toBe(1);
    expect(result.poolId).toBe('pool_456');

    expect(prismaMock.position.findUnique).toHaveBeenCalledWith({
      where: { id: 'pos_123' },
      include: { pool: true },
    });
  });

  it('should handle large nftId values as bigint', async () => {
    const largeNftId = 999999999999;
    const mockPosition = {
      id: 'pos_123',
      protocol: 'uniswapv3',
      poolId: 'pool_456',
      config: { nftId: largeNftId, chainId: 1 },
      pool: { id: 'pool_456' },
    };

    prismaMock.position.findUnique.mockResolvedValue(mockPosition as any);

    const result = await fetchPositionMetadata('pos_123', prismaMock, logger);

    expect(result.nftId).toBe(999999999999n);
  });

  it('should handle different chain IDs', async () => {
    const mockPosition = {
      id: 'pos_123',
      protocol: 'uniswapv3',
      poolId: 'pool_456',
      config: { nftId: 789, chainId: 42161 }, // Arbitrum
      pool: { id: 'pool_456' },
    };

    prismaMock.position.findUnique.mockResolvedValue(mockPosition as any);

    const result = await fetchPositionMetadata('pos_123', prismaMock, logger);

    expect(result.chainId).toBe(42161);
  });

  it('should throw error if position not found', async () => {
    prismaMock.position.findUnique.mockResolvedValue(null);

    await expect(
      fetchPositionMetadata('pos_nonexistent', prismaMock, logger)
    ).rejects.toThrow('Position not found: pos_nonexistent');

    expect(prismaMock.position.findUnique).toHaveBeenCalledWith({
      where: { id: 'pos_nonexistent' },
      include: { pool: true },
    });
  });

  it('should throw error if protocol is not uniswapv3', async () => {
    const mockPosition = {
      id: 'pos_123',
      protocol: 'pancakeswapv3', // Wrong protocol
      poolId: 'pool_456',
      config: { nftId: 789, chainId: 56 },
      pool: { id: 'pool_456' },
    };

    prismaMock.position.findUnique.mockResolvedValue(mockPosition as any);

    await expect(
      fetchPositionMetadata('pos_123', prismaMock, logger)
    ).rejects.toThrow(
      "Invalid position protocol 'pancakeswapv3'. Expected 'uniswapv3'."
    );
  });

  it('should handle protocol validation case-sensitively', async () => {
    const mockPosition = {
      id: 'pos_123',
      protocol: 'UniswapV3', // Wrong case
      poolId: 'pool_456',
      config: { nftId: 789, chainId: 1 },
      pool: { id: 'pool_456' },
    };

    prismaMock.position.findUnique.mockResolvedValue(mockPosition as any);

    await expect(
      fetchPositionMetadata('pos_123', prismaMock, logger)
    ).rejects.toThrow("Invalid position protocol 'UniswapV3'. Expected 'uniswapv3'.");
  });
});
