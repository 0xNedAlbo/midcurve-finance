/**
 * Uniswap V3 Pool Price Service
 *
 * Discovers and caches historic pool price snapshots for Uniswap V3 pools.
 * Uses CacheService (PostgreSQL-backed) instead of a dedicated PoolPrice table.
 *
 * Pool prices are historic snapshots used for:
 * - PnL calculations (comparing current value to historic cost basis)
 * - Historical analysis and charting
 * - Performance tracking over time
 */

import {
  UniswapV3PoolPrice,
  pricePerToken0InToken1,
  pricePerToken1InToken0,
} from '@midcurve/shared';
import type { UniswapV3PoolPriceRow } from '@midcurve/shared';
import type { UniswapV3PoolPriceDiscoverInput } from '../types/pool-price/pool-price-input.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { uniswapV3PoolAbi } from '../../utils/uniswapv3/pool-abi.js';
import { EvmConfig } from '../../config/evm.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import { CacheService } from '../cache/cache-service.js';

/** TTL for cached pool prices: 30 days (prices at finalized blocks are immutable) */
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Flat, JSON-serializable shape stored in the cache.
 * All bigint values stored as strings.
 */
interface CachedPoolPriceValue {
  protocol: 'uniswapv3';
  poolId: string;
  timestamp: string; // ISO 8601
  token1PricePerToken0: string;
  token0PricePerToken1: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  sqrtPriceX96: string;
  tick: number;
}

/**
 * Dependencies for UniswapV3PoolPriceService
 * All dependencies are optional and will use defaults if not provided
 */
export interface UniswapV3PoolPriceServiceDependencies {
  /** EVM configuration for RPC clients */
  evmConfig?: EvmConfig;
  /** Uniswap V3 pool service for pool data access */
  poolService?: UniswapV3PoolService;
  /** Cache service for storing pool price snapshots */
  cacheService?: CacheService;
}

/**
 * Uniswap V3 Pool Price Service
 *
 * Discovers and caches historic pool price snapshots using CacheService.
 *
 * Features:
 * - Returns UniswapV3PoolPrice class instances with typed config/state
 * - Zero-RPC cache hits when caller provides blockHash (reorg detection in-memory)
 * - On-chain discovery at specific block numbers on cache miss
 */
export class UniswapV3PoolPriceService {
  protected readonly protocol = 'uniswapv3' as const;
  protected readonly _evmConfig: EvmConfig;
  protected readonly _poolService: UniswapV3PoolService;
  protected readonly _cacheService: CacheService;
  protected readonly logger: ServiceLogger;

  constructor(dependencies: UniswapV3PoolPriceServiceDependencies = {}) {
    this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this._poolService =
      dependencies.poolService ?? new UniswapV3PoolService();
    this._cacheService = dependencies.cacheService ?? CacheService.getInstance();
    this.logger = createServiceLogger('UniswapV3PoolPriceService');
  }

  protected get evmConfig(): EvmConfig {
    return this._evmConfig;
  }

  protected get poolService(): UniswapV3PoolService {
    return this._poolService;
  }

  protected get cacheService(): CacheService {
    return this._cacheService;
  }

  // ============================================================================
  // CACHE KEY & MAPPING
  // ============================================================================

  /**
   * Build a deterministic cache key for a pool price at a specific block.
   */
  private buildCacheKey(
    chainId: number,
    poolAddress: string,
    blockNumber: number,
  ): string {
    return `pool-price:uniswapv3:${chainId}:${poolAddress}:${blockNumber}`;
  }

  /**
   * Reconstruct a UniswapV3PoolPrice from a cached value.
   */
  private mapFromCache(
    cacheKey: string,
    cached: CachedPoolPriceValue,
  ): UniswapV3PoolPrice {
    const row: UniswapV3PoolPriceRow = {
      id: cacheKey,
      createdAt: new Date(),
      updatedAt: new Date(),
      protocol: 'uniswapv3' as const,
      poolId: cached.poolId,
      timestamp: new Date(cached.timestamp),
      token1PricePerToken0: BigInt(cached.token1PricePerToken0),
      token0PricePerToken1: BigInt(cached.token0PricePerToken1),
      config: {
        blockNumber: cached.blockNumber,
        blockHash: cached.blockHash,
        blockTimestamp: cached.blockTimestamp,
      },
      state: {
        sqrtPriceX96: cached.sqrtPriceX96,
        tick: cached.tick,
      },
    };
    return UniswapV3PoolPrice.fromDB(row);
  }

  // ============================================================================
  // DISCOVERY
  // ============================================================================

  /**
   * Discover and cache a historic pool price snapshot from on-chain data.
   *
   * Checks the cache first. On cache hit, validates blockHash for reorg detection.
   * When the caller provides blockHash (e.g., from a raw log event), the cache hit
   * path requires zero RPC calls.
   *
   * @param poolId - Pool ID to fetch price for
   * @param params - Discovery parameters (blockNumber, optional blockHash)
   * @returns The discovered or cached pool price snapshot
   */
  async discover(
    poolId: string,
    params: UniswapV3PoolPriceDiscoverInput,
  ): Promise<UniswapV3PoolPrice> {
    log.methodEntry(this.logger, 'discover', { poolId, params });

    // 1. Resolve pool to get chainId and poolAddress
    const pool = await this.poolService.findById(poolId);
    if (!pool) {
      const error = new Error(`Pool not found: ${poolId}`);
      log.methodError(this.logger, 'discover', error, { poolId });
      throw error;
    }

    const { chainId, address: poolAddress } = pool.typedConfig;

    // 2. Validate chain support
    if (!this.evmConfig.isChainSupported(chainId)) {
      const error = new Error(
        `Chain ${chainId} is not supported. Please configure RPC_URL_${this.evmConfig
          .getChainConfig(chainId)
          ?.name.toUpperCase()}`
      );
      log.methodError(this.logger, 'discover', error, { chainId });
      throw error;
    }

    // 3. Build cache key and check cache
    const cacheKey = this.buildCacheKey(chainId, poolAddress, params.blockNumber);
    const cached = await this.cacheService.get<CachedPoolPriceValue>(cacheKey);

    if (cached) {
      // 4. Reorg detection: compare blockHash
      const canonicalBlockHash = params.blockHash
        ?? (await this.evmConfig.getPublicClient(chainId).getBlock({
          blockNumber: BigInt(params.blockNumber),
        })).hash;

      if (cached.blockHash === canonicalBlockHash) {
        this.logger.info(
          { poolId, blockNumber: params.blockNumber },
          'Pool price cache hit with matching blockHash',
        );
        const result = this.mapFromCache(cacheKey, cached);
        log.methodExit(this.logger, 'discover', { cacheKey });
        return result;
      }

      // Reorg detected — delete stale cache entry
      this.logger.debug(
        {
          poolId,
          blockNumber: params.blockNumber,
          cachedBlockHash: cached.blockHash,
          canonicalBlockHash,
        },
        'Reorg detected: blockHash mismatch, invalidating cached pool price',
      );
      await this.cacheService.delete(cacheKey);
    }

    // 5. Cache miss (or reorg invalidation) — fetch from chain
    const client = this.evmConfig.getPublicClient(chainId);

    const block = await client.getBlock({
      blockNumber: BigInt(params.blockNumber),
    });
    const blockTimestamp = Number(block.timestamp);
    const blockHash = block.hash;
    const timestamp = new Date(blockTimestamp * 1000);

    this.logger.debug(
      { poolAddress, blockNumber: params.blockNumber },
      'Reading pool slot0 at block',
    );

    const slot0Data = (await client.readContract({
      address: poolAddress as `0x${string}`,
      abi: uniswapV3PoolAbi,
      functionName: 'slot0',
      blockNumber: BigInt(params.blockNumber),
    })) as readonly [bigint, number, number, number, number, number, boolean];

    const sqrtPriceX96 = slot0Data[0];
    const tick = slot0Data[1];

    // 6. Calculate prices
    const token1PricePerToken0 = pricePerToken0InToken1(
      sqrtPriceX96,
      pool.token0.decimals,
    );
    const token0PricePerToken1 = pricePerToken1InToken0(
      sqrtPriceX96,
      pool.token1.decimals,
    );

    this.logger.debug(
      {
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick,
        token1PricePerToken0: token1PricePerToken0.toString(),
        token0PricePerToken1: token0PricePerToken1.toString(),
      },
      'Calculated prices from pool state',
    );

    // 7. Store in cache
    const cacheValue: CachedPoolPriceValue = {
      protocol: 'uniswapv3',
      poolId,
      timestamp: timestamp.toISOString(),
      token1PricePerToken0: token1PricePerToken0.toString(),
      token0PricePerToken1: token0PricePerToken1.toString(),
      blockNumber: params.blockNumber,
      blockHash,
      blockTimestamp,
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick,
    };

    await this.cacheService.set(cacheKey, cacheValue, CACHE_TTL_SECONDS);

    // 8. Map to UniswapV3PoolPrice and return
    const poolPrice = this.mapFromCache(cacheKey, cacheValue);

    this.logger.info(
      {
        cacheKey,
        poolId,
        blockNumber: params.blockNumber,
        timestamp,
      },
      'Pool price discovered and cached',
    );
    log.methodExit(this.logger, 'discover', { cacheKey });
    return poolPrice;
  }
}
