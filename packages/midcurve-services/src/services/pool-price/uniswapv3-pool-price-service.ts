/**
 * Uniswap V3 Pool Price Service
 *
 * Standalone service for managing historic pool price snapshots for Uniswap V3 pools.
 *
 * Pool prices are historic snapshots used for:
 * - PnL calculations (comparing current value to historic cost basis)
 * - Historical analysis and charting
 * - Performance tracking over time
 */

import { PrismaClient } from '@midcurve/database';
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
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { uniswapV3PoolAbi } from '../../utils/uniswapv3/pool-abi.js';
import { EvmConfig } from '../../config/evm.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import type { PrismaTransactionClient } from '../pool/uniswapv3-pool-service.js';

/**
 * Database result interface for pool price queries.
 * Note: Prisma stores bigint as string in the database, so we use string here.
 * The factory methods handle conversion to native bigint.
 */
export interface PoolPriceDbResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  protocol: string;
  poolId: string;
  timestamp: Date;
  token1PricePerToken0: string; // Prisma returns bigint as string
  token0PricePerToken1: string; // Prisma returns bigint as string
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

/**
 * Dependencies for UniswapV3PoolPriceService
 * All dependencies are optional and will use defaults if not provided
 */
export interface UniswapV3PoolPriceServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;

  /**
   * EVM configuration for RPC clients
   * If not provided, a new EvmConfig instance will be created
   * Required for discover() method to fetch on-chain data
   */
  evmConfig?: EvmConfig;

  /**
   * Uniswap V3 pool service for pool data access
   * If not provided, a new UniswapV3PoolService instance will be created
   */
  poolService?: UniswapV3PoolService;
}

/**
 * Uniswap V3 Pool Price Service
 *
 * Standalone service for Uniswap V3 pool price management.
 *
 * Features:
 * - Returns UniswapV3PoolPrice class instances with typed config/state
 * - Protocol validation (ensures only 'uniswapv3' pool prices)
 * - On-chain discovery at specific block numbers
 */
export class UniswapV3PoolPriceService {
  protected readonly protocol = 'uniswapv3' as const;
  protected readonly _prisma: PrismaClient;
  protected readonly _evmConfig: EvmConfig;
  protected readonly _poolService: UniswapV3PoolService;
  protected readonly logger: ServiceLogger;

  /**
   * Creates a new UniswapV3PoolPriceService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   * @param dependencies.evmConfig - EVM config instance (creates default if not provided)
   * @param dependencies.poolService - Pool service instance (creates default if not provided)
   */
  constructor(dependencies: UniswapV3PoolPriceServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this._poolService =
      dependencies.poolService ?? new UniswapV3PoolService({ prisma: this._prisma });
    this.logger = createServiceLogger('UniswapV3PoolPriceService');
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * Get the EVM config instance
   */
  protected get evmConfig(): EvmConfig {
    return this._evmConfig;
  }

  /**
   * Get the pool service instance
   */
  protected get poolService(): UniswapV3PoolService {
    return this._poolService;
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
   * record if price already exists for the given pool and block with matching hash.
   *
   * Reorg detection: If a cached price exists but the blockHash doesn't match
   * the on-chain blockHash, the cached record is deleted and re-fetched.
   *
   * @param poolId - Pool ID to fetch price for
   * @param params - Discovery parameters (blockNumber)
   * @param tx - Optional Prisma transaction client for atomic operations
   * @returns The discovered or existing pool price snapshot
   * @throws Error if pool not found, not uniswapv3, chain not supported, or RPC call fails
   */
  async discover(
    poolId: string,
    params: UniswapV3PoolPriceDiscoverInput,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3PoolPrice> {
    log.methodEntry(this.logger, 'discover', { poolId, params });

    const db = tx ?? this.prisma;

    try {
      // 1. Fetch pool using pool service (includes tokens and validates protocol)
      const pool = await this.poolService.findById(poolId);

      if (!pool) {
        const error = new Error(`Pool not found: ${poolId}`);
        log.methodError(this.logger, 'discover', error, { poolId });
        throw error;
      }

      // 2. Get chainId and pool address from typed config
      const { chainId, address: poolAddress } = pool.typedConfig;

      // 3. Validate chain support
      if (!this.evmConfig.isChainSupported(chainId)) {
        const error = new Error(
          `Chain ${chainId} is not supported. Please configure RPC_URL_${this.evmConfig
            .getChainConfig(chainId)
            ?.name.toUpperCase()}`
        );
        log.methodError(this.logger, 'discover', error, { chainId });
        throw error;
      }

      // 4. Get public client for the chain
      const client = this.evmConfig.getPublicClient(chainId);

      // 5. Fetch block info to get timestamp and hash for reorg detection
      this.logger.debug(
        { blockNumber: params.blockNumber },
        'Fetching block info'
      );
      const block = await client.getBlock({
        blockNumber: BigInt(params.blockNumber),
      });

      const blockTimestamp = Number(block.timestamp);
      const blockHash = block.hash;
      const timestamp = new Date(blockTimestamp * 1000);

      // 6. Check for existing price snapshot at this block
      const existingPrice = await db.poolPrice.findFirst({
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
        const existingConfig = existingPrice.config as { blockHash?: string };

        // Compare blockHash for reorg detection
        if (existingConfig.blockHash === blockHash) {
          this.logger.info(
            { poolId, blockNumber: params.blockNumber, blockHash },
            'Pool price already exists with matching blockHash, returning cached'
          );
          return this.mapToUniswapV3PoolPrice(existingPrice as unknown as PoolPriceDbResult);
        }

        // Reorg detected - blockHash mismatch (common occurrence, not urgent)
        this.logger.debug(
          {
            poolId,
            blockNumber: params.blockNumber,
            cachedBlockHash: existingConfig.blockHash,
            onChainBlockHash: blockHash,
          },
          'Reorg detected: blockHash mismatch, deleting stale price and re-fetching'
        );

        // Delete the stale record
        await db.poolPrice.delete({
          where: { id: existingPrice.id },
        });
      }

      // 8. Read pool state at specific block
      this.logger.debug(
        { poolAddress, blockNumber: params.blockNumber },
        'Reading pool slot0 at block'
      );

      const slot0Data = (await client.readContract({
        address: poolAddress as `0x${string}`,
        abi: uniswapV3PoolAbi,
        functionName: 'slot0',
        blockNumber: BigInt(params.blockNumber),
      })) as readonly [bigint, number, number, number, number, number, boolean];

      const sqrtPriceX96 = slot0Data[0];
      const tick = slot0Data[1];

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
      const poolPrice = await this.create(
        {
          protocol: 'uniswapv3',
          poolId,
          timestamp,
          token1PricePerToken0,
          token0PricePerToken1,
          config: {
            blockNumber: params.blockNumber,
            blockHash,
            blockTimestamp,
          },
          state: {
            sqrtPriceX96,
            tick,
          },
        },
        tx
      );

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
   * @param tx - Optional Prisma transaction client for atomic operations
   * @returns The created pool price with generated id and timestamps
   * @throws Error if protocol is not 'uniswapv3'
   */
  async create(
    input: CreateUniswapV3PoolPriceInput,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3PoolPrice> {
    log.methodEntry(this.logger, 'create', {
      protocol: input.protocol,
      poolId: input.poolId,
      timestamp: input.timestamp,
    });

    const db = tx ?? this.prisma;

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

      const result = await db.poolPrice.create({
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
}
