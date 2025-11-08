/**
 * Unit tests for pool price fetching utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import { pino } from 'pino';
import { getHistoricPoolPrice } from './pool-price-fetcher.js';
import type { UniswapV3PoolPriceService } from '../../../pool-price/uniswapv3-pool-price-service.js';
import type { UniswapV3PoolPrice } from '@midcurve/shared';

describe('getHistoricPoolPrice', () => {
  let poolPriceServiceMock: DeepMockProxy<UniswapV3PoolPriceService>;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    poolPriceServiceMock = mockDeep<UniswapV3PoolPriceService>();
    mockReset(poolPriceServiceMock);
  });

  it('should fetch historic pool price successfully', async () => {
    const mockPoolPrice: UniswapV3PoolPrice = {
      id: 'price_123',
      poolId: 'pool_eth_usdc_500',
      blockNumber: 12345678,
      timestamp: new Date('2024-01-01T00:00:00Z'),
      state: {
        sqrtPriceX96: 79228162514264337593543950336n,
        tick: 0,
        liquidity: 1000000n,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UniswapV3PoolPrice;

    poolPriceServiceMock.discover.mockResolvedValue(mockPoolPrice);

    const result = await getHistoricPoolPrice(
      'pool_eth_usdc_500',
      12345678n,
      poolPriceServiceMock,
      logger
    );

    expect(result.poolPrice).toEqual(mockPoolPrice);
    expect(result.sqrtPriceX96).toBe(79228162514264337593543950336n);
    expect(result.timestamp).toEqual(new Date('2024-01-01T00:00:00Z'));

    expect(poolPriceServiceMock.discover).toHaveBeenCalledWith('pool_eth_usdc_500', {
      blockNumber: 12345678,
    });
  });

  it('should convert bigint block number to number for service call', async () => {
    const mockPoolPrice: UniswapV3PoolPrice = {
      id: 'price_456',
      poolId: 'pool_123',
      blockNumber: 99999999,
      timestamp: new Date('2024-06-15T12:00:00Z'),
      state: {
        sqrtPriceX96: 123456789n,
        tick: 100,
        liquidity: 500000n,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UniswapV3PoolPrice;

    poolPriceServiceMock.discover.mockResolvedValue(mockPoolPrice);

    await getHistoricPoolPrice(
      'pool_123',
      99999999n, // bigint input
      poolPriceServiceMock,
      logger
    );

    // Verify it's converted to number
    expect(poolPriceServiceMock.discover).toHaveBeenCalledWith('pool_123', {
      blockNumber: 99999999, // number output
    });
  });

  it('should extract sqrtPriceX96 from state correctly', async () => {
    const sqrtPrice = 5000000000000000000000n;
    const mockPoolPrice: UniswapV3PoolPrice = {
      id: 'price_789',
      poolId: 'pool_123',
      blockNumber: 1000000,
      timestamp: new Date(),
      state: {
        sqrtPriceX96: sqrtPrice,
        tick: -100,
        liquidity: 2000000n,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UniswapV3PoolPrice;

    poolPriceServiceMock.discover.mockResolvedValue(mockPoolPrice);

    const result = await getHistoricPoolPrice(
      'pool_123',
      1000000n,
      poolPriceServiceMock,
      logger
    );

    expect(result.sqrtPriceX96).toBe(sqrtPrice);
  });

  it('should preserve timestamp from pool price', async () => {
    const specificTimestamp = new Date('2023-12-25T10:30:45Z');
    const mockPoolPrice: UniswapV3PoolPrice = {
      id: 'price_christmas',
      poolId: 'pool_123',
      blockNumber: 5555555,
      timestamp: specificTimestamp,
      state: {
        sqrtPriceX96: 111111n,
        tick: 50,
        liquidity: 750000n,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UniswapV3PoolPrice;

    poolPriceServiceMock.discover.mockResolvedValue(mockPoolPrice);

    const result = await getHistoricPoolPrice(
      'pool_123',
      5555555n,
      poolPriceServiceMock,
      logger
    );

    expect(result.timestamp).toEqual(specificTimestamp);
  });

  it('should handle very large block numbers', async () => {
    const largeBlockNumber = 999999999999n;
    const mockPoolPrice: UniswapV3PoolPrice = {
      id: 'price_large',
      poolId: 'pool_123',
      blockNumber: Number(largeBlockNumber),
      timestamp: new Date(),
      state: {
        sqrtPriceX96: 222222n,
        tick: 200,
        liquidity: 3000000n,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UniswapV3PoolPrice;

    poolPriceServiceMock.discover.mockResolvedValue(mockPoolPrice);

    const result = await getHistoricPoolPrice(
      'pool_123',
      largeBlockNumber,
      poolPriceServiceMock,
      logger
    );

    expect(result.poolPrice.blockNumber).toBe(Number(largeBlockNumber));
    expect(poolPriceServiceMock.discover).toHaveBeenCalledWith('pool_123', {
      blockNumber: Number(largeBlockNumber),
    });
  });

  it('should propagate errors from pool price service', async () => {
    poolPriceServiceMock.discover.mockRejectedValue(
      new Error('RPC connection failed')
    );

    await expect(
      getHistoricPoolPrice('pool_123', 12345n, poolPriceServiceMock, logger)
    ).rejects.toThrow('RPC connection failed');
  });
});
