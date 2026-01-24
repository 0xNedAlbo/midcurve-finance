/**
 * Uniswap V3 Pool Price Service
 *
 * Service for managing historic pool price snapshots for Uniswap V3 pools.
 *
 * Pool prices are historic snapshots used for:
 * - PnL calculations (comparing current value to historic cost basis)
 * - Historical analysis and charting
 * - Performance tracking over time
 */

import { PoolPriceService } from './pool-price-service.js';
import type { PoolPriceServiceDependencies, PoolPriceDbResult } from './pool-price-service.js';
import {
  UniswapV3PoolPrice,
  poolPriceConfigToJSON,
  priceStateToJSON,
  pricePerToken0InToken1,
  pricePerToken1InToken0,
} from '@midcurve/shared';
import type { UniswapV3PoolPriceRow } from '@midcurve/shared';
import type {
  CreateUniswapV3PoolPriceInput,
  UniswapV3PoolPriceDiscoverInput,
} from '../types/pool-price/pool-price-input.js';
import { log } from '../../logging/index.js';
import { uniswapV3PoolAbi } from '../../utils/uniswapv3/pool-abi.js';

/**
 * Uniswap V3 Pool Price Service
 *
 * Extends PoolPriceService with Uniswap V3-specific implementation.
 *
 * Features:
 * - Returns UniswapV3PoolPrice class instances with typed config/state
 * - Protocol validation (ensures only 'uniswapv3' pool prices)
 * - On-chain discovery at specific block numbers
 */
export class UniswapV3PoolPriceService extends PoolPriceService {
  protected readonly protocol = 'uniswapv3' as const;

  /**
   * Creates a new UniswapV3PoolPriceService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   */
  constructor(dependencies: PoolPriceServiceDependencies = {}) {
    super(dependencies);
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Map database result to UniswapV3PoolPrice class instance.
   *
   * Converts string price fields to bigint for UniswapV3PoolPriceRow compatibility.
   *
   * @param dbResult - Raw database result from Prisma
   * @returns UniswapV3PoolPrice class instance
   */
  private mapToUniswapV3PoolPrice(dbResult: PoolPriceDbResult): UniswapV3PoolPrice {
    // Convert string price fields to bigint for UniswapV3PoolPriceRow compatibility
    const rowWithBigInt: UniswapV3PoolPriceRow = {
      ...dbResult,
      protocol: 'uniswapv3' as const,
      token1PricePerToken0: BigInt(dbResult.token1PricePerToken0),
      token0PricePerToken1: BigInt(dbResult.token0PricePerToken1),
    };
    return UniswapV3PoolPrice.fromDB(rowWithBigInt);
  }

  // ============================================================================
  // DISCOVERY IMPLEMENTATION
  // ============================================================================

  /**
   * Discover and create a historic pool price snapshot from on-chain data
   *
   * Fetches pool state at a specific block number from the blockchain,
   * calculates prices, and stores in database. Idempotent - returns existing
   * record if price already exists for the given pool and block.
   *
   * @param poolId - Pool ID to fetch price for
   * @param params - Discovery parameters (blockNumber)
   * @returns The discovered or existing pool price snapshot
   * @throws Error if pool not found, not uniswapv3, chain not supported, or RPC call fails
   */
  async discover(
    poolId: string,
    params: UniswapV3PoolPriceDiscoverInput
  ): Promise<UniswapV3PoolPrice> {
    log.methodEntry(this.logger, 'discover', { poolId, params });

    try {
      // 1. Fetch pool from database (with tokens)
      const pool = await this.prisma.pool.findUnique({
        where: { id: poolId },
        include: {
          token0: true,
          token1: true,
        },
      });

      if (!pool) {
        const error = new Error(`Pool not found: ${poolId}`);
        log.methodError(this.logger, 'discover', error, { poolId });
        throw error;
      }

      // 2. Validate pool protocol
      if (pool.protocol !== 'uniswapv3') {
        const error = new Error(
          `Invalid pool protocol '${pool.protocol}'. Expected 'uniswapv3'.`
        );
        log.methodError(this.logger, 'discover', error, {
          poolId,
          protocol: pool.protocol,
        });
        throw error;
      }

      // 3. Get chainId and pool address from config
      const poolConfig = pool.config as { chainId: number; address: string };
      const { chainId, address: poolAddress } = poolConfig;

      // 4. Check for existing price snapshot at this block (idempotent)
      const existingPrice = await this.prisma.poolPrice.findFirst({
        where: {
          poolId,
          protocol: 'uniswapv3',
          config: {
            path: ['blockNumber'],
            equals: params.blockNumber,
          },
        },
      });

      if (existingPrice) {
        this.logger.info(
          { poolId, blockNumber: params.blockNumber },
          'Pool price already exists, returning cached'
        );
        return this.mapToUniswapV3PoolPrice(existingPrice as unknown as PoolPriceDbResult);
      }

      // 5. Validate chain support
      if (!this.evmConfig.isChainSupported(chainId)) {
        const error = new Error(
          `Chain ${chainId} is not supported. Please configure RPC_URL_${this.evmConfig
            .getChainConfig(chainId)
            ?.name.toUpperCase()}`
        );
        log.methodError(this.logger, 'discover', error, { chainId });
        throw error;
      }

      // 6. Get public client for the chain
      const client = this.evmConfig.getPublicClient(chainId);

      // 7. Fetch block info to get timestamp
      this.logger.debug(
        { blockNumber: params.blockNumber },
        'Fetching block info'
      );
      const block = await client.getBlock({
        blockNumber: BigInt(params.blockNumber),
      });

      const blockTimestamp = Number(block.timestamp);
      const timestamp = new Date(blockTimestamp * 1000);

      // 8. Read pool state at specific block
      this.logger.debug(
        { poolAddress, blockNumber: params.blockNumber },
        'Reading pool slot0 at block'
      );

      let slot0Data: readonly [bigint, number, number, number, number, number, boolean];
      let usedCurrentBlock = false;

      try {
        // Try to read at the specified historical block
        slot0Data = (await client.readContract({
          address: poolAddress as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'slot0',
          blockNumber: BigInt(params.blockNumber),
        })) as readonly [bigint, number, number, number, number, number, boolean];
      } catch (historicalError) {
        // If historical block query fails (block too recent or not indexed yet),
        // fall back to current block as approximation
        this.logger.warn(
          {
            poolAddress,
            blockNumber: params.blockNumber,
            error: (historicalError as Error).message,
          },
          'Failed to read pool state at historical block, falling back to current block'
        );

        slot0Data = (await client.readContract({
          address: poolAddress as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'slot0',
          // No blockNumber = current block
        })) as readonly [bigint, number, number, number, number, number, boolean];

        usedCurrentBlock = true;
      }

      const sqrtPriceX96 = slot0Data[0];
      const tick = slot0Data[1];

      if (usedCurrentBlock) {
        this.logger.info(
          {
            poolAddress,
            requestedBlock: params.blockNumber,
            sqrtPriceX96: sqrtPriceX96.toString(),
          },
          'Used current block price as fallback for recent transaction'
        );
      }

      // 9. Calculate prices using utility functions
      const token1PricePerToken0 = pricePerToken0InToken1(
        sqrtPriceX96,
        pool.token0.decimals
      );
      const token0PricePerToken1 = pricePerToken1InToken0(
        sqrtPriceX96,
        pool.token1.decimals
      );

      this.logger.debug(
        {
          sqrtPriceX96: sqrtPriceX96.toString(),
          tick,
          token1PricePerToken0: token1PricePerToken0.toString(),
          token0PricePerToken1: token0PricePerToken1.toString(),
        },
        'Calculated prices from pool state'
      );

      // 10. Create pool price record
      const poolPrice = await this.create({
        protocol: 'uniswapv3',
        poolId,
        timestamp,
        token1PricePerToken0,
        token0PricePerToken1,
        config: {
          blockNumber: params.blockNumber,
          blockTimestamp,
        },
        state: {
          sqrtPriceX96,
          tick,
        },
      });

      this.logger.info(
        {
          id: poolPrice.id,
          poolId,
          blockNumber: params.blockNumber,
          timestamp,
        },
        'Pool price discovered and saved'
      );
      log.methodExit(this.logger, 'discover', { id: poolPrice.id });
      return poolPrice;
    } catch (error) {
      log.methodError(this.logger, 'discover', error as Error, {
        poolId,
        params,
      });
      throw error;
    }
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new Uniswap V3 pool price snapshot
   *
   * @param input - Pool price data to create
   * @returns The created pool price with generated id and timestamps
   * @throws Error if protocol is not 'uniswapv3'
   */
  async create(input: CreateUniswapV3PoolPriceInput): Promise<UniswapV3PoolPrice> {
    log.methodEntry(this.logger, 'create', {
      protocol: input.protocol,
      poolId: input.poolId,
      timestamp: input.timestamp,
    });

    try {
      // Validate protocol
      if (input.protocol !== 'uniswapv3') {
        const error = new Error(
          `Invalid protocol '${input.protocol}' for UniswapV3PoolPriceService. Expected 'uniswapv3'.`
        );
        log.methodError(this.logger, 'create', error, {
          protocol: input.protocol,
        });
        throw error;
      }

      // Serialize config and state for database storage
      const configDB = poolPriceConfigToJSON(input.config);
      const stateDB = priceStateToJSON(input.state);

      log.dbOperation(this.logger, 'create', 'PoolPrice', {
        protocol: input.protocol,
        poolId: input.poolId,
      });

      const result = await this.prisma.poolPrice.create({
        data: {
          protocol: 'uniswapv3',
          poolId: input.poolId,
          timestamp: input.timestamp,
          token1PricePerToken0: input.token1PricePerToken0.toString(),
          token0PricePerToken1: input.token0PricePerToken1.toString(),
          config: configDB as object,
          state: stateDB as object,
        },
      });

      const poolPrice = this.mapToUniswapV3PoolPrice(result as unknown as PoolPriceDbResult);

      this.logger.info(
        {
          id: poolPrice.id,
          protocol: poolPrice.protocol,
          poolId: poolPrice.poolId,
          timestamp: poolPrice.timestamp,
        },
        'Pool price created'
      );
      log.methodExit(this.logger, 'create', { id: poolPrice.id });
      return poolPrice;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, {
        protocol: input.protocol,
      });
      throw error;
    }
  }

  /**
   * Find pool price by ID
   *
   * Overrides base implementation to return UniswapV3PoolPrice.
   *
   * @param id - Pool price ID
   * @returns Pool price if found and is 'uniswapv3' protocol, null otherwise
   */
  override async findById(id: string): Promise<UniswapV3PoolPrice | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      log.dbOperation(this.logger, 'findUnique', 'PoolPrice', { id });

      const result = await this.prisma.poolPrice.findUnique({
        where: { id },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      // Validate protocol
      if (result.protocol !== 'uniswapv3') {
        this.logger.warn(
          { id, protocol: result.protocol },
          'Pool price found but is not uniswapv3 protocol'
        );
        log.methodExit(this.logger, 'findById', { id, found: false, wrongProtocol: true });
        return null;
      }

      const poolPrice = this.mapToUniswapV3PoolPrice(result as unknown as PoolPriceDbResult);

      log.methodExit(this.logger, 'findById', { id, found: true });
      return poolPrice;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Find all pool prices for a specific pool
   *
   * Returns only Uniswap V3 pool prices for the specified pool.
   *
   * @param poolId - Pool ID
   * @returns Array of Uniswap V3 pool prices, ordered by timestamp (newest first)
   */
  override async findByPoolId(poolId: string): Promise<UniswapV3PoolPrice[]> {
    log.methodEntry(this.logger, 'findByPoolId', { poolId });

    try {
      log.dbOperation(this.logger, 'findMany', 'PoolPrice', { poolId });

      const results = await this.prisma.poolPrice.findMany({
        where: { poolId, protocol: 'uniswapv3' },
        orderBy: { timestamp: 'desc' },
      });

      const poolPrices = results.map((result) =>
        this.mapToUniswapV3PoolPrice(result as unknown as PoolPriceDbResult)
      );

      log.methodExit(this.logger, 'findByPoolId', {
        poolId,
        count: poolPrices.length,
      });
      return poolPrices;
    } catch (error) {
      log.methodError(this.logger, 'findByPoolId', error as Error, { poolId });
      throw error;
    }
  }

  /**
   * Find pool prices for a specific pool within a time range
   *
   * Returns only Uniswap V3 pool prices within the specified time range.
   *
   * @param poolId - Pool ID
   * @param startTime - Start of time range (inclusive)
   * @param endTime - End of time range (inclusive)
   * @returns Array of Uniswap V3 pool prices within time range, ordered by timestamp (oldest first)
   */
  override async findByPoolIdAndTimeRange(
    poolId: string,
    startTime: Date,
    endTime: Date
  ): Promise<UniswapV3PoolPrice[]> {
    log.methodEntry(this.logger, 'findByPoolIdAndTimeRange', {
      poolId,
      startTime,
      endTime,
    });

    try {
      log.dbOperation(this.logger, 'findMany', 'PoolPrice', {
        poolId,
        timeRange: true,
      });

      const results = await this.prisma.poolPrice.findMany({
        where: {
          poolId,
          protocol: 'uniswapv3',
          timestamp: {
            gte: startTime,
            lte: endTime,
          },
        },
        orderBy: { timestamp: 'asc' }, // Oldest first for time-series analysis
      });

      const poolPrices = results.map((result) =>
        this.mapToUniswapV3PoolPrice(result as unknown as PoolPriceDbResult)
      );

      log.methodExit(this.logger, 'findByPoolIdAndTimeRange', {
        poolId,
        count: poolPrices.length,
      });
      return poolPrices;
    } catch (error) {
      log.methodError(this.logger, 'findByPoolIdAndTimeRange', error as Error, {
        poolId,
      });
      throw error;
    }
  }

  /**
   * Delete pool price
   *
   * Overrides base implementation to add protocol validation.
   *
   * @param id - Pool price ID
   * @throws Error if pool price is not 'uniswapv3' protocol
   */
  override async delete(id: string): Promise<void> {
    // Fetch first to validate protocol
    const poolPrice = await this.findById(id);

    if (!poolPrice) {
      // Already doesn't exist, no-op
      return;
    }

    await super.delete(id);
  }
}
