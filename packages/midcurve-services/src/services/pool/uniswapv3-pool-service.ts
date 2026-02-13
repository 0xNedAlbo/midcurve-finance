/**
 * UniswapV3PoolService
 *
 * Specialized service for Uniswap V3 pool management.
 * Handles address validation, normalization, token discovery, and pool state serialization.
 *
 * Returns UniswapV3Pool class instances for type-safe config/state access.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import {
  UniswapV3Pool,
  UniswapV3PoolConfig,
  isValidAddress,
  normalizeAddress,
  stateToJSON,
} from '@midcurve/shared';
import type {
  UniswapV3PoolRow,
  UniswapV3PoolState,
  Erc20TokenRow,
} from '@midcurve/shared';
import type {
  UniswapV3PoolDiscoverInput,
  CreateUniswapV3PoolInput,
  UpdateUniswapV3PoolInput,
} from '../types/pool/pool-input.js';
import {
  PoolConfigError,
  uniswapV3PoolAbi,
} from '../../utils/uniswapv3/index.js';
import { EvmConfig } from '../../config/evm.js';
import {
  getFactoryAddress,
  UNISWAP_V3_FACTORY_ABI,
} from '../../config/uniswapv3.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import { EvmBlockService } from '../block/evm-block-service.js';
import { CacheService } from '../cache/cache-service.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PoolServiceInterface } from './pool-service.interface.js';

// ============================================================================
// TYPES
// ============================================================================

/** TTL for pool on-chain state cache: 24 hours in seconds */
const POOL_STATE_CACHE_TTL_SECONDS = 24 * 60 * 60; // 86400 seconds

/**
 * On-chain pool state from Uniswap V3 pool contract
 * Combines data from slot0(), liquidity(), and feeGrowthGlobal*X128()
 */
export interface OnChainPoolState {
  /** Block number when this state was fetched */
  blockNumber: bigint;
  /** Whether the pool existed at this block (false if queried before pool creation) */
  exists: boolean;
  /** Current sqrt price as Q64.96 (0n if pool doesn't exist) */
  sqrtPriceX96: bigint;
  /** Current tick (0 if pool doesn't exist) */
  currentTick: number;
  /** Current in-range liquidity (0n if pool doesn't exist) */
  liquidity: bigint;
  /** Global fee growth for token0 (0n if pool doesn't exist) */
  feeGrowthGlobal0: bigint;
  /** Global fee growth for token1 (0n if pool doesn't exist) */
  feeGrowthGlobal1: bigint;
}

/** Serialized version for cache (bigints as strings) */
interface OnChainPoolStateCached {
  blockNumber: string;
  exists: boolean;
  sqrtPriceX96: string;
  currentTick: number;
  liquidity: string;
  feeGrowthGlobal0: string;
  feeGrowthGlobal1: string;
}

function serializePoolState(state: OnChainPoolState): OnChainPoolStateCached {
  return {
    blockNumber: state.blockNumber.toString(),
    exists: state.exists,
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    currentTick: state.currentTick,
    liquidity: state.liquidity.toString(),
    feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
    feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
  };
}

function deserializePoolState(cached: OnChainPoolStateCached): OnChainPoolState {
  return {
    blockNumber: BigInt(cached.blockNumber),
    exists: cached.exists,
    sqrtPriceX96: BigInt(cached.sqrtPriceX96),
    currentTick: cached.currentTick,
    liquidity: BigInt(cached.liquidity),
    feeGrowthGlobal0: BigInt(cached.feeGrowthGlobal0),
    feeGrowthGlobal1: BigInt(cached.feeGrowthGlobal1),
  };
}

/**
 * On-chain tick data from Uniswap V3 pool contract ticks() function
 */
export interface OnChainTickData {
  /** Block number when this data was fetched */
  blockNumber: bigint;
  /** The tick index */
  tick: number;
  /** Fee growth outside this tick for token0 */
  feeGrowthOutside0X128: bigint;
  /** Fee growth outside this tick for token1 */
  feeGrowthOutside1X128: bigint;
}

/** Serialized version for cache (bigints as strings) */
interface OnChainTickDataCached {
  blockNumber: string;
  tick: number;
  feeGrowthOutside0X128: string;
  feeGrowthOutside1X128: string;
}

function serializeTickData(data: OnChainTickData): OnChainTickDataCached {
  return {
    blockNumber: data.blockNumber.toString(),
    tick: data.tick,
    feeGrowthOutside0X128: data.feeGrowthOutside0X128.toString(),
    feeGrowthOutside1X128: data.feeGrowthOutside1X128.toString(),
  };
}

function deserializeTickData(cached: OnChainTickDataCached): OnChainTickData {
  return {
    blockNumber: BigInt(cached.blockNumber),
    tick: cached.tick,
    feeGrowthOutside0X128: BigInt(cached.feeGrowthOutside0X128),
    feeGrowthOutside1X128: BigInt(cached.feeGrowthOutside1X128),
  };
}

// Re-export PrismaTransactionClient for backwards compatibility
// The canonical location is now clients/prisma/index.ts
export type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';

/**
 * Generic pool result from database (before conversion to class instance)
 * Matches Prisma Pool model output with included token relations
 */
export interface PoolDbResult {
  id: string;
  protocol: string;
  poolType: string;
  token0Id: string;
  token1Id: string;
  feeBps: number;
  config: unknown;
  state: unknown;
  createdAt: Date;
  updatedAt: Date;
  token0?: {
    id: string;
    tokenType: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    coingeckoId: string | null;
    marketCap: number | null;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  };
  token1?: {
    id: string;
    tokenType: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    coingeckoId: string | null;
    marketCap: number | null;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * Dependencies for UniswapV3PoolService
 * All dependencies are optional and will use defaults if not provided
 */
export interface UniswapV3PoolServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;

  /**
   * EVM configuration for chain RPC access
   * If not provided, the singleton EvmConfig instance will be used
   */
  evmConfig?: EvmConfig;

  /**
   * ERC-20 token service for token discovery
   * If not provided, a new Erc20TokenService instance will be created
   */
  erc20TokenService?: Erc20TokenService;

  /**
   * EVM block service for block number queries
   * If not provided, a new EvmBlockService instance will be created
   */
  evmBlockService?: EvmBlockService;

  /**
   * Cache service for distributed caching
   * If not provided, the singleton CacheService instance will be used
   */
  cacheService?: CacheService;
}

/**
 * UniswapV3PoolService
 *
 * Provides pool management for Uniswap V3 concentrated liquidity pools.
 * Returns UniswapV3Pool class instances for type-safe config/state access.
 */
export class UniswapV3PoolService implements PoolServiceInterface {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;
  public readonly protocol = 'uniswapv3' as const;

  private readonly _evmConfig: EvmConfig;
  private readonly _erc20TokenService: Erc20TokenService;
  private readonly _evmBlockService: EvmBlockService;
  private readonly _cacheService: CacheService;

  /**
   * Creates a new UniswapV3PoolService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   * @param dependencies.evmConfig - EVM configuration instance (uses singleton if not provided)
   * @param dependencies.erc20TokenService - ERC-20 token service (creates default if not provided)
   */
  constructor(dependencies: UniswapV3PoolServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('UniswapV3PoolService');
    this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this._erc20TokenService =
      dependencies.erc20TokenService ??
      new Erc20TokenService({ prisma: this._prisma });
    this._evmBlockService =
      dependencies.evmBlockService ??
      new EvmBlockService({ evmConfig: this._evmConfig });
    this._cacheService =
      dependencies.cacheService ?? CacheService.getInstance();
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * Get the EVM configuration instance
   */
  protected get evmConfig(): EvmConfig {
    return this._evmConfig;
  }

  /**
   * Get the ERC-20 token service instance
   */
  protected get erc20TokenService(): Erc20TokenService {
    return this._erc20TokenService;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Convert database result to UniswapV3Pool class instance.
   *
   * Uses UniswapV3Pool.fromDBWithTokens() which handles:
   * - Config deserialization via UniswapV3PoolConfig.fromJSON()
   * - State deserialization via stateFromJSON()
   * - Token conversion via Erc20Token.fromDB()
   *
   * @param dbResult - Raw database result from Prisma (with included tokens)
   * @returns UniswapV3Pool class instance
   */
  private mapToUniswapV3Pool(dbResult: PoolDbResult): UniswapV3Pool {
    // UniswapV3Pool.fromDBWithTokens expects token relations to be included
    if (!dbResult.token0 || !dbResult.token1) {
      throw new Error(
        'UniswapV3PoolService.mapToUniswapV3Pool requires token0 and token1 to be included'
      );
    }

    return UniswapV3Pool.fromDBWithTokens({
      id: dbResult.id,
      protocol: 'uniswapv3',
      poolType: dbResult.poolType,
      token0Id: dbResult.token0Id,
      token1Id: dbResult.token1Id,
      feeBps: dbResult.feeBps,
      config: dbResult.config as Record<string, unknown>,
      state: dbResult.state as Record<string, unknown>,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      token0: dbResult.token0 as Erc20TokenRow,
      token1: dbResult.token1 as Erc20TokenRow,
    } as UniswapV3PoolRow);
  }

  // ============================================================================
  // ON-CHAIN STATE FETCHING (with caching)
  // ============================================================================

  /**
   * Fetch on-chain pool state with block-based caching
   *
   * Fetches pool data from contract (slot0, liquidity, feeGrowthGlobal*)
   * with caching to reduce RPC calls. Cache key includes block number
   * to ensure freshness while avoiding duplicate reads within the same block.
   *
   * Flow:
   * 1. Validate and normalize address
   * 2. Resolve block number (fetch if 'latest')
   * 3. Build cache key with block number
   * 4. Check cache for state at this block
   * 5. If cache miss, fetch slot0(), liquidity(), feeGrowthGlobal*X128() in parallel
   * 6. Build result object
   * 7. Cache result with 24h TTL
   *
   * @param chainId - Chain ID
   * @param poolAddress - Pool contract address
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @returns On-chain pool state with resolved block number
   * @throws Error if chain not supported or RPC fails
   */
  async fetchPoolState(
    chainId: number,
    poolAddress: string,
    blockNumber: number | 'latest' = 'latest',
  ): Promise<OnChainPoolState> {
    log.methodEntry(this.logger, 'fetchPoolState', { chainId, poolAddress, blockNumber });

    // 1. Validate and normalize address
    if (!isValidAddress(poolAddress)) {
      const error = new Error(`Invalid pool address format: ${poolAddress}`);
      log.methodError(this.logger, 'fetchPoolState', error, { poolAddress, chainId });
      throw error;
    }
    const normalizedAddress = normalizeAddress(poolAddress);

    // 2. Verify chain is supported
    if (!this.evmConfig.isChainSupported(chainId)) {
      const error = new Error(
        `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
          .getSupportedChainIds()
          .join(', ')}`
      );
      log.methodError(this.logger, 'fetchPoolState', error, { chainId });
      throw error;
    }

    // 3. Resolve block number (fetch if 'latest')
    const resolvedBlockNumber =
      blockNumber === 'latest'
        ? await this._evmBlockService.getCurrentBlockNumber(chainId)
        : BigInt(blockNumber);

    // 4. Build cache key (includes protocol and block number for freshness)
    const cacheKey = `uniswapv3-pool-onchain:${chainId}:${normalizedAddress}:${resolvedBlockNumber}`;

    // 5. Check cache
    const cached = await this._cacheService.get<OnChainPoolStateCached>(cacheKey);
    if (cached) {
      this.logger.debug(
        {
          chainId,
          poolAddress: normalizedAddress,
          blockNumber: resolvedBlockNumber.toString(),
          cacheHit: true,
        },
        'On-chain pool state cache hit'
      );
      log.methodExit(this.logger, 'fetchPoolState', { cacheHit: true });
      return deserializePoolState(cached);
    }

    // 6. Cache miss - fetch from chain in parallel
    const client = this.evmConfig.getPublicClient(chainId);

    this.logger.debug(
      { poolAddress: normalizedAddress, chainId, blockNumber: resolvedBlockNumber.toString() },
      'Fetching pool state from contract'
    );

    try {
      const [slot0Data, liquidity, feeGrowthGlobal0, feeGrowthGlobal1] = await Promise.all([
        client.readContract({
          address: normalizedAddress as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'slot0',
          blockNumber: resolvedBlockNumber,
        }) as Promise<readonly [bigint, number, number, number, number, number, boolean]>,
        client.readContract({
          address: normalizedAddress as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'liquidity',
          blockNumber: resolvedBlockNumber,
        }) as Promise<bigint>,
        client.readContract({
          address: normalizedAddress as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'feeGrowthGlobal0X128',
          blockNumber: resolvedBlockNumber,
        }) as Promise<bigint>,
        client.readContract({
          address: normalizedAddress as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'feeGrowthGlobal1X128',
          blockNumber: resolvedBlockNumber,
        }) as Promise<bigint>,
      ]);

      // 7. Build result
      const state: OnChainPoolState = {
        blockNumber: resolvedBlockNumber,
        exists: true,
        sqrtPriceX96: slot0Data[0],
        currentTick: slot0Data[1],
        liquidity,
        feeGrowthGlobal0,
        feeGrowthGlobal1,
      };

      // 8. Cache with 24h TTL
      await this._cacheService.set(
        cacheKey,
        serializePoolState(state),
        POOL_STATE_CACHE_TTL_SECONDS
      );

      this.logger.debug(
        {
          chainId,
          poolAddress: normalizedAddress,
          blockNumber: resolvedBlockNumber.toString(),
          cacheHit: false,
          exists: true,
        },
        'On-chain pool state fetched and cached'
      );

      log.methodExit(this.logger, 'fetchPoolState', { cacheHit: false, exists: true });
      return state;
    } catch (error) {
      // Handle pool not existing at this block (e.g., queried before pool creation)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('execution reverted') ||
        errorMessage.includes('call revert exception') ||
        errorMessage.includes('missing revert data')
      ) {
        this.logger.debug(
          {
            chainId,
            poolAddress: normalizedAddress,
            blockNumber: resolvedBlockNumber.toString(),
          },
          'Pool does not exist at this block - caching non-existent state'
        );

        // Create non-existent state with zero defaults
        const nonExistentState: OnChainPoolState = {
          blockNumber: resolvedBlockNumber,
          exists: false,
          sqrtPriceX96: 0n,
          currentTick: 0,
          liquidity: 0n,
          feeGrowthGlobal0: 0n,
          feeGrowthGlobal1: 0n,
        };

        // Cache non-existent state with same TTL
        await this._cacheService.set(
          cacheKey,
          serializePoolState(nonExistentState),
          POOL_STATE_CACHE_TTL_SECONDS
        );

        log.methodExit(this.logger, 'fetchPoolState', { cacheHit: false, exists: false });
        return nonExistentState;
      }

      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Fetch pool price from on-chain data with caching
   *
   * Uses the cached fetchPoolState() internally to reduce RPC calls.
   *
   * @param chainId - Chain ID
   * @param poolAddress - Pool contract address
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @returns { sqrtPriceX96, currentTick }
   * @throws Error if chain is not supported or RPC fails
   */
  async fetchPoolPrice(
    chainId: number,
    poolAddress: string,
    blockNumber: number | 'latest' = 'latest',
  ): Promise<{ sqrtPriceX96: bigint; currentTick: number }> {
    const state = await this.fetchPoolState(chainId, poolAddress, blockNumber);
    return { sqrtPriceX96: state.sqrtPriceX96, currentTick: state.currentTick };
  }

  /**
   * Fetch pool liquidity from on-chain data with caching
   *
   * Uses the cached fetchPoolState() internally to reduce RPC calls.
   *
   * @param chainId - Chain ID
   * @param poolAddress - Pool contract address
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @returns Pool liquidity as bigint
   * @throws Error if chain is not supported or RPC fails
   */
  async fetchPoolLiquidity(
    chainId: number,
    poolAddress: string,
    blockNumber: number | 'latest' = 'latest',
  ): Promise<bigint> {
    const state = await this.fetchPoolState(chainId, poolAddress, blockNumber);
    return state.liquidity;
  }

  /**
   * Fetch pool fee growth from on-chain data with caching
   *
   * Uses the cached fetchPoolState() internally to reduce RPC calls.
   *
   * @param chainId - Chain ID
   * @param poolAddress - Pool contract address
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @returns { feeGrowthGlobal0, feeGrowthGlobal1 }
   * @throws Error if chain is not supported or RPC fails
   */
  async fetchPoolFeeGrowth(
    chainId: number,
    poolAddress: string,
    blockNumber: number | 'latest' = 'latest',
  ): Promise<{ feeGrowthGlobal0: bigint; feeGrowthGlobal1: bigint }> {
    const state = await this.fetchPoolState(chainId, poolAddress, blockNumber);
    return {
      feeGrowthGlobal0: state.feeGrowthGlobal0,
      feeGrowthGlobal1: state.feeGrowthGlobal1,
    };
  }

  /**
   * Fetch tick data from on-chain with caching
   *
   * Fetches feeGrowthOutside0X128 and feeGrowthOutside1X128 for a specific tick.
   * Results are cached by chainId/poolAddress/tick/blockNumber with 24h TTL.
   *
   * @param chainId - Chain ID
   * @param poolAddress - Pool contract address
   * @param tick - Tick index to fetch
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @returns On-chain tick data with fee growth values
   * @throws Error if chain not supported or RPC fails
   */
  async fetchTickData(
    chainId: number,
    poolAddress: string,
    tick: number,
    blockNumber: number | 'latest' = 'latest',
  ): Promise<OnChainTickData> {
    log.methodEntry(this.logger, 'fetchTickData', { chainId, poolAddress, tick, blockNumber });

    // 1. Validate and normalize address
    if (!isValidAddress(poolAddress)) {
      const error = new Error(`Invalid pool address format: ${poolAddress}`);
      log.methodError(this.logger, 'fetchTickData', error, { poolAddress, chainId });
      throw error;
    }
    const normalizedAddress = normalizeAddress(poolAddress);

    // 2. Verify chain is supported
    if (!this.evmConfig.isChainSupported(chainId)) {
      const error = new Error(
        `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
          .getSupportedChainIds()
          .join(', ')}`
      );
      log.methodError(this.logger, 'fetchTickData', error, { chainId });
      throw error;
    }

    // 3. Resolve block number (fetch if 'latest')
    const resolvedBlockNumber =
      blockNumber === 'latest'
        ? await this._evmBlockService.getCurrentBlockNumber(chainId)
        : BigInt(blockNumber);

    // 4. Build cache key (includes tick and block number)
    const cacheKey = `uniswapv3-tick:${chainId}:${normalizedAddress}:${tick}:${resolvedBlockNumber}`;

    // 5. Check cache
    const cached = await this._cacheService.get<OnChainTickDataCached>(cacheKey);
    if (cached) {
      this.logger.debug(
        {
          chainId,
          poolAddress: normalizedAddress,
          tick,
          blockNumber: resolvedBlockNumber.toString(),
          cacheHit: true,
        },
        'Tick data cache hit'
      );
      log.methodExit(this.logger, 'fetchTickData', { cacheHit: true });
      return deserializeTickData(cached);
    }

    // 6. Cache miss - fetch from chain
    const client = this.evmConfig.getPublicClient(chainId);

    this.logger.debug(
      { poolAddress: normalizedAddress, chainId, tick, blockNumber: resolvedBlockNumber.toString() },
      'Fetching tick data from contract'
    );

    const tickData = await client.readContract({
      address: normalizedAddress as `0x${string}`,
      abi: uniswapV3PoolAbi,
      functionName: 'ticks',
      args: [tick],
      blockNumber: resolvedBlockNumber,
    }) as readonly [
      bigint, // liquidityGross
      bigint, // liquidityNet (int128)
      bigint, // feeGrowthOutside0X128
      bigint, // feeGrowthOutside1X128
      bigint, // tickCumulativeOutside
      bigint, // secondsPerLiquidityOutsideX128
      number, // secondsOutside
      boolean, // initialized
    ];

    // 7. Build result (only extract the fee growth values we need)
    const result: OnChainTickData = {
      blockNumber: resolvedBlockNumber,
      tick,
      feeGrowthOutside0X128: tickData[2],
      feeGrowthOutside1X128: tickData[3],
    };

    // 8. Cache with 24h TTL
    await this._cacheService.set(
      cacheKey,
      serializeTickData(result),
      POOL_STATE_CACHE_TTL_SECONDS
    );

    this.logger.debug(
      {
        chainId,
        poolAddress: normalizedAddress,
        tick,
        blockNumber: resolvedBlockNumber.toString(),
        cacheHit: false,
      },
      'Tick data fetched and cached'
    );

    log.methodExit(this.logger, 'fetchTickData', { cacheHit: false });
    return result;
  }

  /**
   * Fetch pool configuration from a Uniswap V3 pool contract
   *
   * Uses viem's multicall to fetch immutable pool parameters (token0, token1, fee, tickSpacing)
   * in a single RPC call. This is more efficient than making four separate contract calls.
   *
   * @param chainId - Chain ID where the pool is deployed
   * @param poolAddress - Pool contract address
   * @returns Pool configuration with immutable parameters
   * @throws PoolConfigError if contract doesn't implement Uniswap V3 pool interface
   * @throws Error if chain is not supported or address is invalid
   *
   * @example
   * ```typescript
   * const config = await poolService.fetchPoolConfig(1, '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640');
   * // {
   * //   chainId: 1,
   * //   address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
   * //   token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
   * //   token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
   * //   feeBps: 3000,
   * //   tickSpacing: 60
   * // }
   * ```
   */
  async fetchPoolConfig(
    chainId: number,
    poolAddress: string,
  ): Promise<UniswapV3PoolConfig> {
    log.methodEntry(this.logger, 'fetchPoolConfig', { chainId, poolAddress });

    // 1. Validate pool address format
    if (!isValidAddress(poolAddress)) {
      const error = new Error(`Invalid pool address format: ${poolAddress}`);
      log.methodError(this.logger, 'fetchPoolConfig', error, { poolAddress, chainId });
      throw error;
    }

    // 2. Normalize to EIP-55
    const normalizedAddress = normalizeAddress(poolAddress);

    // 3. Verify chain is supported
    if (!this.evmConfig.isChainSupported(chainId)) {
      const error = new Error(
        `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
          .getSupportedChainIds()
          .join(', ')}`
      );
      log.methodError(this.logger, 'fetchPoolConfig', error, { chainId });
      throw error;
    }

    // 4. Get public client for the chain
    const client = this.evmConfig.getPublicClient(chainId);

    try {
      // 5. Use multicall for efficient batch reading
      const results = await client.multicall({
        contracts: [
          {
            address: normalizedAddress as `0x${string}`,
            abi: uniswapV3PoolAbi,
            functionName: 'token0',
          },
          {
            address: normalizedAddress as `0x${string}`,
            abi: uniswapV3PoolAbi,
            functionName: 'token1',
          },
          {
            address: normalizedAddress as `0x${string}`,
            abi: uniswapV3PoolAbi,
            functionName: 'fee',
          },
          {
            address: normalizedAddress as `0x${string}`,
            abi: uniswapV3PoolAbi,
            functionName: 'tickSpacing',
          },
        ],
        allowFailure: false, // Throw if any call fails
      });

      // 6. Extract results from multicall response
      const [token0, token1, fee, tickSpacing] = results;

      // 7. Validate results
      if (typeof token0 !== 'string' || token0.length !== 42) {
        throw new PoolConfigError(
          `Pool contract returned invalid token0 address: ${token0}`,
          normalizedAddress
        );
      }

      if (typeof token1 !== 'string' || token1.length !== 42) {
        throw new PoolConfigError(
          `Pool contract returned invalid token1 address: ${token1}`,
          normalizedAddress
        );
      }

      if (typeof fee !== 'number' || fee < 0) {
        throw new PoolConfigError(
          `Pool contract returned invalid fee: ${fee}`,
          normalizedAddress
        );
      }

      if (typeof tickSpacing !== 'number') {
        throw new PoolConfigError(
          `Pool contract returned invalid tickSpacing: ${tickSpacing}`,
          normalizedAddress
        );
      }

      const config = new UniswapV3PoolConfig({
        chainId,
        address: normalizedAddress,
        token0,
        token1,
        feeBps: fee,
        tickSpacing,
      });

      this.logger.info(
        {
          address: normalizedAddress,
          chainId,
          token0,
          token1,
          feeBps: fee,
          tickSpacing,
        },
        'Pool configuration fetched successfully'
      );

      log.methodExit(this.logger, 'fetchPoolConfig', { address: normalizedAddress });
      return config;
    } catch (error) {
      // Re-throw PoolConfigError as-is
      if (error instanceof PoolConfigError) {
        log.methodError(this.logger, 'fetchPoolConfig', error, {
          address: normalizedAddress,
          chainId,
        });
        throw error;
      }

      // Wrap other errors
      const wrappedError = new PoolConfigError(
        `Failed to read pool configuration from ${normalizedAddress}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        normalizedAddress,
        error
      );
      log.methodError(this.logger, 'fetchPoolConfig', wrappedError, {
        address: normalizedAddress,
        chainId,
      });
      throw wrappedError;
    }
  }

  // ============================================================================
  // DISCOVERY
  // ============================================================================

  /**
   * Discover and create a Uniswap V3 pool from on-chain contract data
   *
   * Checks the database first for an existing pool. If not found:
   * 1. Validates and normalizes pool address
   * 2. Reads immutable pool config from on-chain (token0, token1, fee, tickSpacing)
   * 3. Discovers/fetches token0 and token1 via Erc20TokenService
   * 4. Reads current pool state from on-chain (sqrtPriceX96, liquidity, etc.)
   * 5. Saves pool to database with token ID references
   * 6. Returns Pool with full Token objects
   *
   * Discovery is idempotent - calling multiple times with the same address/chain
   * returns the existing pool.
   *
   * Note: Pool state can be refreshed later using the refresh() method to get
   * the latest on-chain values.
   *
   * @param params - Discovery parameters { poolAddress, chainId }
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns The discovered or existing pool with full Token objects
   * @throws Error if address format is invalid
   * @throws Error if chain ID is not supported
   * @throws PoolConfigError if contract doesn't implement Uniswap V3 pool interface
   */
  async discover(
    params: UniswapV3PoolDiscoverInput,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    const { poolAddress, chainId } = params;
    log.methodEntry(this.logger, 'discover', { poolAddress, chainId, inTransaction: !!tx });

    try {
      // 1. Validate pool address format
      if (!isValidAddress(poolAddress)) {
        const error = new Error(
          `Invalid pool address format: ${poolAddress}`
        );
        log.methodError(this.logger, 'discover', error, {
          poolAddress,
          chainId,
        });
        throw error;
      }

      // 2. Normalize to EIP-55
      const normalizedAddress = normalizeAddress(poolAddress);
      this.logger.debug(
        { original: poolAddress, normalized: normalizedAddress },
        'Pool address normalized for discovery'
      );

      // 3. Check database first (optimization)
      const existing = await this.findByAddressAndChain(
        normalizedAddress,
        chainId
      );

      if (existing) {
        this.logger.info(
          {
            id: existing.id,
            address: normalizedAddress,
            chainId,
            token0: existing.token0.symbol,
            token1: existing.token1.symbol,
          },
          'Pool already exists, refreshing state from on-chain'
        );

        // Refresh pool state to get current price/liquidity/tick
        const refreshed = await this.refresh(existing.id, "latest", tx);

        log.methodExit(this.logger, 'discover', {
          id: refreshed.id,
          fromDatabase: true,
          refreshed: true,
        });
        return refreshed;
      }

      // 4. Verify chain is supported
      if (!this.evmConfig.isChainSupported(chainId)) {
        const error = new Error(
          `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
            .getSupportedChainIds()
            .join(', ')}`
        );
        log.methodError(this.logger, 'discover', error, { chainId });
        throw error;
      }

      this.logger.debug(
        { chainId },
        'Chain is supported, proceeding with on-chain discovery'
      );

      // 5. Read on-chain pool configuration
      this.logger.debug(
        { address: normalizedAddress, chainId },
        'Reading pool configuration from contract'
      );

      const config = await this.fetchPoolConfig(chainId, normalizedAddress);

      // 6. Discover tokens (creates if not exist)
      this.logger.debug(
        { token0: config.token0, token1: config.token1, chainId },
        'Discovering pool tokens'
      );

      const [token0, token1] = await Promise.all([
        this.erc20TokenService.discover({
          address: config.token0,
          chainId,
        }),
        this.erc20TokenService.discover({
          address: config.token1,
          chainId,
        }),
      ]);

      this.logger.info(
        {
          token0Id: token0.id,
          token0Symbol: token0.symbol,
          token1Id: token1.id,
          token1Symbol: token1.symbol,
        },
        'Pool tokens discovered successfully'
      );

      // 7. Read current pool state from on-chain (with caching)
      const onChainState = await this.fetchPoolState(chainId, normalizedAddress, 'latest');
      const state = {
        sqrtPriceX96: onChainState.sqrtPriceX96,
        currentTick: onChainState.currentTick,
        liquidity: onChainState.liquidity,
        feeGrowthGlobal0: onChainState.feeGrowthGlobal0,
        feeGrowthGlobal1: onChainState.feeGrowthGlobal1,
      };

      // 8. Create pool using create() method (handles validation, normalization, and Token population)
      this.logger.debug(
        {
          address: normalizedAddress,
          chainId,
          token0Id: token0.id,
          token1Id: token1.id,
        },
        'Creating pool with discovered tokens'
      );

      const pool = await this.create(
        {
          protocol: 'uniswapv3',
          poolType: 'CL_TICKS',
          token0Id: token0.id,
          token1Id: token1.id,
          feeBps: config.feeBps,
          config,
          state,
        },
        tx
      );

      this.logger.info(
        {
          id: pool.id,
          address: normalizedAddress,
          chainId,
          token0: token0.symbol,
          token1: token1.symbol,
          feeBps: config.feeBps,
        },
        'Pool discovered and created successfully'
      );

      log.methodExit(this.logger, 'discover', { id: pool.id });
      return pool;
    } catch (error) {
      // Only log if not already logged
      if (
        !(error instanceof Error && error.message.includes('Invalid')) &&
        !(error instanceof PoolConfigError)
      ) {
        log.methodError(this.logger, 'discover', error as Error, {
          poolAddress,
          chainId,
        });
      }
      throw error;
    }
  }

  /**
   * Discover a pool by token addresses and fee tier
   *
   * Queries the Uniswap V3 Factory contract to find the pool address for the
   * given token pair and fee tier, then calls discover() to fetch or create
   * the pool record.
   *
   * @param chainId - Chain ID
   * @param tokenA - Address of first token (order doesn't matter)
   * @param tokenB - Address of second token (order doesn't matter)
   * @param feeBps - Fee tier in basis points (e.g., 500, 3000, 10000)
   * @returns The discovered or existing pool
   * @throws Error if pool doesn't exist in factory
   * @throws Error if token addresses are invalid
   */
  async discoverByTokensAndFee(
    chainId: number,
    tokenA: string,
    tokenB: string,
    feeBps: number
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'discoverByTokensAndFee', {
      chainId,
      tokenA,
      tokenB,
      feeBps,
    });

    try {
      // Validate token addresses
      if (!isValidAddress(tokenA)) {
        throw new Error(`Invalid tokenA address format: ${tokenA}`);
      }
      if (!isValidAddress(tokenB)) {
        throw new Error(`Invalid tokenB address format: ${tokenB}`);
      }

      // Normalize addresses
      const normalizedTokenA = normalizeAddress(tokenA);
      const normalizedTokenB = normalizeAddress(tokenB);

      // Query factory for pool address
      const factoryAddress = getFactoryAddress(chainId);
      const client = this.evmConfig.getPublicClient(chainId);

      this.logger.debug(
        { factoryAddress, tokenA: normalizedTokenA, tokenB: normalizedTokenB, feeBps, chainId },
        'Querying factory for pool address'
      );

      const poolAddress = (await client.readContract({
        address: factoryAddress,
        abi: UNISWAP_V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [normalizedTokenA as `0x${string}`, normalizedTokenB as `0x${string}`, feeBps],
      })) as string;

      // Check if pool exists (factory returns zero address if pool doesn't exist)
      const zeroAddress = '0x0000000000000000000000000000000000000000';
      if (
        poolAddress.toLowerCase() === zeroAddress.toLowerCase() ||
        poolAddress === zeroAddress
      ) {
        const error = new Error(
          `Pool does not exist for tokenA=${normalizedTokenA}, tokenB=${normalizedTokenB}, fee=${feeBps} on chain ${chainId}`
        );
        log.methodError(this.logger, 'discoverByTokensAndFee', error, {
          chainId,
          tokenA: normalizedTokenA,
          tokenB: normalizedTokenB,
          feeBps,
        });
        throw error;
      }

      const normalizedPoolAddress = normalizeAddress(poolAddress);
      this.logger.debug(
        { poolAddress: normalizedPoolAddress, tokenA: normalizedTokenA, tokenB: normalizedTokenB, feeBps },
        'Pool address retrieved from factory'
      );

      // Call discover() to fetch or create the pool
      const pool = await this.discover({
        poolAddress: normalizedPoolAddress,
        chainId,
      });

      log.methodExit(this.logger, 'discoverByTokensAndFee', {
        poolId: pool.id,
        poolAddress: normalizedPoolAddress,
      });

      return pool;
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          (error.message.includes('Invalid') ||
            error.message.includes('Pool does not exist'))
        )
      ) {
        log.methodError(this.logger, 'discoverByTokensAndFee', error as Error, {
          chainId,
          tokenA,
          tokenB,
          feeBps,
        });
      }
      throw error;
    }
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new Uniswap V3 pool
   *
   * Adds:
   * - Address validation and normalization (pool address in config)
   * - Token address validation and normalization (token0, token1 in config)
   * - Returns UniswapV3Pool class instance
   *
   * Note: This is a manual creation helper. For creating pools from on-chain data,
   * use discover() which handles token discovery and pool state fetching.
   *
   * @param input - Pool data to create (with token0Id, token1Id)
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns The created pool with full Token objects
   * @throws Error if address format is invalid
   */
  async create(
    input: CreateUniswapV3PoolInput,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'create', {
      address: input.config.address,
      chainId: input.config.chainId,
      token0Id: input.token0Id,
      token1Id: input.token1Id,
      inTransaction: !!tx,
    });

    try {
      const client = tx ?? this.prisma;

      // Validate and normalize pool address
      if (!isValidAddress(input.config.address)) {
        const error = new Error(
          `Invalid pool address format: ${input.config.address}`
        );
        log.methodError(this.logger, 'create', error, { input });
        throw error;
      }

      // Validate and normalize token addresses
      if (!isValidAddress(input.config.token0)) {
        const error = new Error(
          `Invalid token0 address format: ${input.config.token0}`
        );
        log.methodError(this.logger, 'create', error, { input });
        throw error;
      }

      if (!isValidAddress(input.config.token1)) {
        const error = new Error(
          `Invalid token1 address format: ${input.config.token1}`
        );
        log.methodError(this.logger, 'create', error, { input });
        throw error;
      }

      // Create config class for serialization with normalized addresses
      const configData = {
        ...input.config,
        address: normalizeAddress(input.config.address),
        token0: normalizeAddress(input.config.token0),
        token1: normalizeAddress(input.config.token1),
      };
      const config = new UniswapV3PoolConfig(configData);

      // Serialize state
      const stateDB = stateToJSON(input.state);

      // Generate poolHash for fast lookups
      const poolHash = this.createHash({
        chainId: input.config.chainId,
        address: input.config.address,
      });

      log.dbOperation(this.logger, 'create', 'Pool', {
        protocol: input.protocol,
        poolType: input.poolType,
        poolHash,
      });

      const result = await client.pool.create({
        data: {
          protocol: input.protocol,
          poolType: input.poolType,
          token0Id: input.token0Id,
          token1Id: input.token1Id,
          feeBps: input.feeBps,
          poolHash,
          config: config.toJSON() as object,
          state: stateDB as object,
        },
        include: {
          token0: true,
          token1: true,
        },
      });

      const pool = this.mapToUniswapV3Pool(result);

      this.logger.info(
        {
          id: pool.id,
          protocol: pool.protocol,
          poolType: pool.poolType,
        },
        'Pool created'
      );
      log.methodExit(this.logger, 'create', { id: pool.id });
      return pool;
    } catch (error) {
      // Only log if not already logged
      if (!(error instanceof Error && error.message.includes('Invalid'))) {
        log.methodError(this.logger, 'create', error as Error, { input });
      }
      throw error;
    }
  }

  /**
   * Find pool by ID
   *
   * Returns null if:
   * - Pool not found
   * - Pool is not uniswapv3 protocol
   *
   * @param id - Pool ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Pool if found and is uniswapv3 protocol, null otherwise
   */
  async findById(
    id: string,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool | null> {
    log.methodEntry(this.logger, 'findById', { id, inTransaction: !!tx });

    try {
      const client = tx ?? this.prisma;
      log.dbOperation(this.logger, 'findUnique', 'Pool', { id });

      const result = await client.pool.findUnique({
        where: { id },
        include: {
          token0: true,
          token1: true,
        },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      // Filter by protocol type
      if (result.protocol !== 'uniswapv3') {
        this.logger.debug(
          { id, protocol: result.protocol },
          'Pool found but is not uniswapv3 protocol'
        );
        log.methodExit(this.logger, 'findById', { id, found: false, reason: 'wrong_protocol' });
        return null;
      }

      // Map to UniswapV3Pool with full Token objects
      const pool = this.mapToUniswapV3Pool(result);

      log.methodExit(this.logger, 'findById', { id, found: true });
      return pool;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Update pool
   *
   * Handles address normalization and returns UniswapV3Pool class instance.
   *
   * @param id - Pool ID
   * @param input - Update input with optional fields
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool with full Token objects
   * @throws Error if pool not found or not uniswapv3 protocol
   */
  async update(
    id: string,
    input: UpdateUniswapV3PoolInput,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'update', { id, input, inTransaction: !!tx });

    try {
      const client = tx ?? this.prisma;

      // Build update data
      const data: Record<string, unknown> = {};

      if (input.feeBps !== undefined) {
        data.feeBps = input.feeBps;
      }

      // Handle config update with address normalization
      if (input.config !== undefined) {
        // Get existing pool to merge with partial config
        const existing = await this.findById(id, tx);
        if (!existing) {
          const error = new Error(`Pool ${id} not found`);
          log.methodError(this.logger, 'update', error, { id });
          throw error;
        }

        const mergedConfig = {
          ...existing.typedConfig.toJSON(),
          ...input.config,
        };

        // Normalize addresses if provided
        if (input.config.address) {
          if (!isValidAddress(input.config.address)) {
            const error = new Error(
              `Invalid pool address format: ${input.config.address}`
            );
            log.methodError(this.logger, 'update', error, { id, input });
            throw error;
          }
          mergedConfig.address = normalizeAddress(input.config.address);
        }

        if (input.config.token0) {
          if (!isValidAddress(input.config.token0)) {
            const error = new Error(
              `Invalid token0 address format: ${input.config.token0}`
            );
            log.methodError(this.logger, 'update', error, { id, input });
            throw error;
          }
          mergedConfig.token0 = normalizeAddress(input.config.token0);
        }

        if (input.config.token1) {
          if (!isValidAddress(input.config.token1)) {
            const error = new Error(
              `Invalid token1 address format: ${input.config.token1}`
            );
            log.methodError(this.logger, 'update', error, { id, input });
            throw error;
          }
          mergedConfig.token1 = normalizeAddress(input.config.token1);
        }

        const config = new UniswapV3PoolConfig(mergedConfig);
        data.config = config.toJSON() as object;
      }

      // Handle state update
      if (input.state !== undefined) {
        // Get existing pool to merge with partial state
        const existing = await this.findById(id, tx);
        if (!existing) {
          const error = new Error(`Pool ${id} not found`);
          log.methodError(this.logger, 'update', error, { id });
          throw error;
        }

        const mergedState: UniswapV3PoolState = {
          ...existing.typedState,
          ...input.state,
        };

        data.state = stateToJSON(mergedState) as object;
      }

      log.dbOperation(this.logger, 'update', 'Pool', { id, fields: Object.keys(data) });

      const result = await client.pool.update({
        where: { id },
        data,
        include: {
          token0: true,
          token1: true,
        },
      });

      const pool = this.mapToUniswapV3Pool(result);

      log.methodExit(this.logger, 'update', { id });
      return pool;
    } catch (error) {
      // Only log if not already logged
      if (!(error instanceof Error && error.message.includes('Invalid'))) {
        log.methodError(this.logger, 'update', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Delete pool
   *
   * Verifies protocol type and checks for dependent positions.
   * Silently succeeds if pool doesn't exist (idempotent).
   *
   * @param id - Pool ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Promise that resolves when deletion is complete
   * @throws Error if pool exists but is not uniswapv3 protocol
   * @throws Error if pool has dependent positions
   */
  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id, inTransaction: !!tx });

    try {
      const client = tx ?? this.prisma;

      // Check if pool exists and verify protocol type
      log.dbOperation(this.logger, 'findUnique', 'Pool', { id });

      const existing = await client.pool.findUnique({
        where: { id },
        include: {
          positions: {
            take: 1, // Just check if any exist
          },
        },
      });

      if (!existing) {
        this.logger.debug({ id }, 'Pool not found, delete operation is no-op');
        log.methodExit(this.logger, 'delete', { id, deleted: false });
        return;
      }

      // Verify protocol type
      if (existing.protocol !== 'uniswapv3') {
        const error = new Error(
          `Cannot delete pool ${id}: expected protocol 'uniswapv3', got '${existing.protocol}'`
        );
        log.methodError(this.logger, 'delete', error, { id, protocol: existing.protocol });
        throw error;
      }

      // Check for dependent positions
      if (existing.positions.length > 0) {
        const error = new Error(
          `Cannot delete pool ${id}: pool has dependent positions. Delete positions first.`
        );
        log.methodError(this.logger, 'delete', error, { id });
        throw error;
      }

      // Delete pool
      log.dbOperation(this.logger, 'delete', 'Pool', { id });
      await client.pool.delete({ where: { id } });

      this.logger.info(
        { id, protocol: existing.protocol, poolType: existing.poolType },
        'Pool deleted successfully'
      );

      log.methodExit(this.logger, 'delete', { id, deleted: true });
    } catch (error) {
      // Only log if not already logged
      if (!(error instanceof Error && error.message.includes('Cannot delete'))) {
        log.methodError(this.logger, 'delete', error as Error, { id });
      }
      throw error;
    }
  }

  // ============================================================================
  // UPDATE METHODS (persist to database without RPC calls)
  // ============================================================================

  /**
   * Update pool price in the database.
   *
   * Simply persists the provided sqrtPriceX96 and currentTick to the database
   * without making any RPC calls.
   *
   * @param id - Pool database ID
   * @param priceData - Price data { sqrtPriceX96: bigint, currentTick: number }
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool
   */
  async updatePoolPrice(
    id: string,
    priceData: { sqrtPriceX96: bigint; currentTick: number },
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'updatePoolPrice', { id, inTransaction: !!tx });

    try {
      const updated = await this.update(
        id,
        {
          state: {
            sqrtPriceX96: priceData.sqrtPriceX96,
            currentTick: priceData.currentTick,
          },
        },
        tx
      );

      this.logger.debug(
        {
          id,
          sqrtPriceX96: priceData.sqrtPriceX96.toString(),
          currentTick: priceData.currentTick,
        },
        'Pool price updated'
      );

      log.methodExit(this.logger, 'updatePoolPrice', { id });
      return updated;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'updatePoolPrice', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Update pool liquidity in the database.
   *
   * Simply persists the provided liquidity to the database
   * without making any RPC calls.
   *
   * @param id - Pool database ID
   * @param liquidity - Pool liquidity value
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool
   */
  async updatePoolLiquidity(
    id: string,
    liquidity: bigint,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'updatePoolLiquidity', { id, inTransaction: !!tx });

    try {
      const updated = await this.update(
        id,
        {
          state: {
            liquidity,
          },
        },
        tx
      );

      this.logger.debug(
        {
          id,
          liquidity: liquidity.toString(),
        },
        'Pool liquidity updated'
      );

      log.methodExit(this.logger, 'updatePoolLiquidity', { id });
      return updated;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'updatePoolLiquidity', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Update pool fee growth in the database.
   *
   * Simply persists the provided feeGrowthGlobal0 and feeGrowthGlobal1 to the database
   * without making any RPC calls.
   *
   * @param id - Pool database ID
   * @param feeGrowthData - Fee growth data { feeGrowthGlobal0: bigint, feeGrowthGlobal1: bigint }
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool
   */
  async updatePoolFeeGrowth(
    id: string,
    feeGrowthData: { feeGrowthGlobal0: bigint; feeGrowthGlobal1: bigint },
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'updatePoolFeeGrowth', { id, inTransaction: !!tx });

    try {
      const updated = await this.update(
        id,
        {
          state: {
            feeGrowthGlobal0: feeGrowthData.feeGrowthGlobal0,
            feeGrowthGlobal1: feeGrowthData.feeGrowthGlobal1,
          },
        },
        tx
      );

      this.logger.debug(
        {
          id,
          feeGrowthGlobal0: feeGrowthData.feeGrowthGlobal0.toString(),
          feeGrowthGlobal1: feeGrowthData.feeGrowthGlobal1.toString(),
        },
        'Pool fee growth updated'
      );

      log.methodExit(this.logger, 'updatePoolFeeGrowth', { id });
      return updated;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'updatePoolFeeGrowth', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Update complete pool state in the database.
   *
   * Simply persists all state fields to the database without making any RPC calls.
   * This is the most efficient way to update all state fields at once.
   *
   * @param id - Pool database ID
   * @param stateData - Complete state data
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool
   */
  async updatePoolState(
    id: string,
    stateData: {
      sqrtPriceX96: bigint;
      currentTick: number;
      liquidity: bigint;
      feeGrowthGlobal0: bigint;
      feeGrowthGlobal1: bigint;
    },
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'updatePoolState', { id, inTransaction: !!tx });

    try {
      const updated = await this.update(
        id,
        {
          state: {
            sqrtPriceX96: stateData.sqrtPriceX96,
            currentTick: stateData.currentTick,
            liquidity: stateData.liquidity,
            feeGrowthGlobal0: stateData.feeGrowthGlobal0,
            feeGrowthGlobal1: stateData.feeGrowthGlobal1,
          },
        },
        tx
      );

      this.logger.debug(
        {
          id,
          sqrtPriceX96: stateData.sqrtPriceX96.toString(),
          currentTick: stateData.currentTick,
          liquidity: stateData.liquidity.toString(),
          feeGrowthGlobal0: stateData.feeGrowthGlobal0.toString(),
          feeGrowthGlobal1: stateData.feeGrowthGlobal1.toString(),
        },
        'Pool state updated'
      );

      log.methodExit(this.logger, 'updatePoolState', { id });
      return updated;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'updatePoolState', error as Error, { id });
      }
      throw error;
    }
  }

  // ============================================================================
  // REFRESH METHODS (fetch from chain + persist to database)
  // ============================================================================

  /**
   * Refresh pool state from on-chain data
   *
   * Fetches the current pool state from the blockchain and updates the database.
   * This is the primary method for updating pool state (vs update() which is a generic helper).
   *
   * The method first fetches the complete on-chain state to get a resolved block number,
   * then calls all individual refresh methods with that block number to ensure consistency.
   * All subsequent calls will hit the cache since fetchPoolState already cached the data.
   *
   * Note: Only updates mutable state fields (sqrtPriceX96, liquidity, currentTick, feeGrowth).
   * Config fields (address, token addresses, fee, tickSpacing) are immutable and not updated.
   *
   * @param id - Pool ID
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool with fresh on-chain state and full Token objects
   * @throws Error if pool not found
   * @throws Error if pool is not uniswapv3 protocol
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refresh(
    id: string,
    blockNumber: number | "latest" = "latest",
    tx?: PrismaTransactionClient,
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'refresh', { id, blockNumber, inTransaction: !!tx });

    try {
      // 1. Get existing pool to get address and chainId
      const existing = await this.findById(id);
      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refresh', error, { id });
        throw error;
      }

      // 2. Fetch on-chain state (gets resolved block number and populates cache)
      const onChainState = await this.fetchPoolState(
        existing.chainId,
        existing.address,
        blockNumber,
      );

      // 3. Extract resolved block number for consistency
      const resolvedBlockNumber = Number(onChainState.blockNumber);

      // 4. Call individual refresh methods with the resolved block number
      // All will hit cache since fetchPoolState already cached this block
      await this.refreshPoolPrice(id, resolvedBlockNumber, tx);
      await this.refreshPoolLiquidity(id, resolvedBlockNumber, tx);
      await this.refreshPoolFeeGrowth(id, resolvedBlockNumber, tx);

      // 5. Return the updated pool
      const updated = await this.findById(id, tx);
      if (!updated) {
        // This shouldn't happen since refresh methods would have succeeded
        const error = new Error(`Pool not found after refresh: ${id}`);
        log.methodError(this.logger, 'refresh', error, { id });
        throw error;
      }

      log.methodExit(this.logger, 'refresh', { id, blockNumber: resolvedBlockNumber });
      return updated;
    } catch (error) {
      // Only log if not already logged
      if (
        !(error instanceof Error &&
          (error.message.includes('not found') ||
           error.message.includes('not configured')))
      ) {
        log.methodError(this.logger, 'refresh', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Refresh pool price from on-chain data by pool ID.
   *
   * Fetches the price from on-chain (with caching) and persists it to the database.
   *
   * @param id - Pool database ID
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Current price data { sqrtPriceX96: string, currentTick: number }
   * @throws Error if pool not found
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refreshPoolPrice(
    id: string,
    blockNumber: number | 'latest' = 'latest',
    tx?: PrismaTransactionClient
  ): Promise<{ sqrtPriceX96: string; currentTick: number }> {
    log.methodEntry(this.logger, 'refreshPoolPrice', { id, blockNumber, inTransaction: !!tx });

    try {
      // 1. Get existing pool to get address and chainId
      const existing = await this.findById(id);
      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refreshPoolPrice', error, { id });
        throw error;
      }

      // 2. Fetch price using cached fetchPoolPrice
      const priceData = await this.fetchPoolPrice(
        existing.chainId,
        existing.address,
        blockNumber
      );

      // 3. Persist to database
      await this.updatePoolPrice(
        id,
        {
          sqrtPriceX96: priceData.sqrtPriceX96,
          currentTick: priceData.currentTick,
        },
        tx
      );

      log.methodExit(this.logger, 'refreshPoolPrice', {
        id,
        sqrtPriceX96: priceData.sqrtPriceX96.toString(),
        currentTick: priceData.currentTick,
      });

      return {
        sqrtPriceX96: priceData.sqrtPriceX96.toString(),
        currentTick: priceData.currentTick,
      };
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'refreshPoolPrice', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Refresh pool liquidity from on-chain data by pool ID.
   *
   * Fetches the liquidity from on-chain (with caching) and persists it to the database.
   *
   * @param id - Pool database ID
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Current liquidity as string
   * @throws Error if pool not found
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refreshPoolLiquidity(
    id: string,
    blockNumber: number | 'latest' = 'latest',
    tx?: PrismaTransactionClient
  ): Promise<string> {
    log.methodEntry(this.logger, 'refreshPoolLiquidity', { id, blockNumber, inTransaction: !!tx });

    try {
      // 1. Get existing pool to get address and chainId
      const existing = await this.findById(id);
      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refreshPoolLiquidity', error, { id });
        throw error;
      }

      // 2. Fetch liquidity using cached fetchPoolLiquidity
      const liquidity = await this.fetchPoolLiquidity(
        existing.chainId,
        existing.address,
        blockNumber
      );

      // 3. Persist to database
      await this.updatePoolLiquidity(id, liquidity, tx);

      this.logger.info(
        {
          id,
          poolAddress: existing.address,
          chainId: existing.chainId,
          liquidity: liquidity.toString(),
        },
        'Pool liquidity refreshed and persisted'
      );

      log.methodExit(this.logger, 'refreshPoolLiquidity', {
        id,
        liquidity: liquidity.toString(),
      });

      return liquidity.toString();
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          (error.message.includes('not found') ||
            error.message.includes('not configured'))
        )
      ) {
        log.methodError(this.logger, 'refreshPoolLiquidity', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Refresh pool fee growth from on-chain data by pool ID.
   *
   * Fetches the fee growth values from on-chain (with caching) and persists them to the database.
   *
   * @param id - Pool database ID
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Current fee growth data { feeGrowthGlobal0: string, feeGrowthGlobal1: string }
   * @throws Error if pool not found
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refreshPoolFeeGrowth(
    id: string,
    blockNumber: number | 'latest' = 'latest',
    tx?: PrismaTransactionClient
  ): Promise<{ feeGrowthGlobal0: string; feeGrowthGlobal1: string }> {
    log.methodEntry(this.logger, 'refreshPoolFeeGrowth', { id, blockNumber, inTransaction: !!tx });

    try {
      // 1. Get existing pool to get address and chainId
      const existing = await this.findById(id);
      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refreshPoolFeeGrowth', error, { id });
        throw error;
      }

      // 2. Fetch fee growth using cached fetchPoolFeeGrowth
      const feeGrowthData = await this.fetchPoolFeeGrowth(
        existing.chainId,
        existing.address,
        blockNumber
      );

      // 3. Persist to database
      await this.updatePoolFeeGrowth(
        id,
        {
          feeGrowthGlobal0: feeGrowthData.feeGrowthGlobal0,
          feeGrowthGlobal1: feeGrowthData.feeGrowthGlobal1,
        },
        tx
      );

      this.logger.info(
        {
          id,
          poolAddress: existing.address,
          chainId: existing.chainId,
          feeGrowthGlobal0: feeGrowthData.feeGrowthGlobal0.toString(),
          feeGrowthGlobal1: feeGrowthData.feeGrowthGlobal1.toString(),
        },
        'Pool fee growth refreshed and persisted'
      );

      log.methodExit(this.logger, 'refreshPoolFeeGrowth', {
        id,
        feeGrowthGlobal0: feeGrowthData.feeGrowthGlobal0.toString(),
        feeGrowthGlobal1: feeGrowthData.feeGrowthGlobal1.toString(),
      });

      return {
        feeGrowthGlobal0: feeGrowthData.feeGrowthGlobal0.toString(),
        feeGrowthGlobal1: feeGrowthData.feeGrowthGlobal1.toString(),
      };
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          (error.message.includes('not found') ||
            error.message.includes('not configured'))
        )
      ) {
        log.methodError(this.logger, 'refreshPoolFeeGrowth', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Refresh complete pool state from on-chain data by pool ID.
   *
   * Fetches all state values (price, liquidity, fee growth) from on-chain
   * (with caching) and persists them to the database in a single update.
   *
   * This is more efficient than calling individual refresh methods separately
   * as it batches both RPC reads and database writes.
   *
   * @param id - Pool database ID
   * @param blockNumber - Block number to fetch state at, or 'latest' for current block
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Complete state data with all fields as strings
   * @throws Error if pool not found
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refreshPoolState(
    id: string,
    blockNumber: number | 'latest' = 'latest',
    tx?: PrismaTransactionClient
  ): Promise<{
    sqrtPriceX96: string;
    currentTick: number;
    liquidity: string;
    feeGrowthGlobal0: string;
    feeGrowthGlobal1: string;
  }> {
    log.methodEntry(this.logger, 'refreshPoolState', { id, blockNumber, inTransaction: !!tx });

    try {
      // 1. Get existing pool to get address and chainId
      const existing = await this.findById(id);
      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refreshPoolState', error, { id });
        throw error;
      }

      // 2. Fetch complete state using cached fetchPoolState
      const onChainState = await this.fetchPoolState(
        existing.chainId,
        existing.address,
        blockNumber
      );

      // 3. Persist all state to database in single update
      await this.updatePoolState(
        id,
        {
          sqrtPriceX96: onChainState.sqrtPriceX96,
          currentTick: onChainState.currentTick,
          liquidity: onChainState.liquidity,
          feeGrowthGlobal0: onChainState.feeGrowthGlobal0,
          feeGrowthGlobal1: onChainState.feeGrowthGlobal1,
        },
        tx
      );

      this.logger.info(
        {
          id,
          poolAddress: existing.address,
          chainId: existing.chainId,
          blockNumber: onChainState.blockNumber.toString(),
          sqrtPriceX96: onChainState.sqrtPriceX96.toString(),
          currentTick: onChainState.currentTick,
          liquidity: onChainState.liquidity.toString(),
          feeGrowthGlobal0: onChainState.feeGrowthGlobal0.toString(),
          feeGrowthGlobal1: onChainState.feeGrowthGlobal1.toString(),
        },
        'Pool state refreshed and persisted'
      );

      log.methodExit(this.logger, 'refreshPoolState', { id });

      return {
        sqrtPriceX96: onChainState.sqrtPriceX96.toString(),
        currentTick: onChainState.currentTick,
        liquidity: onChainState.liquidity.toString(),
        feeGrowthGlobal0: onChainState.feeGrowthGlobal0.toString(),
        feeGrowthGlobal1: onChainState.feeGrowthGlobal1.toString(),
      };
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          (error.message.includes('not found') ||
            error.message.includes('not configured'))
        )
      ) {
        log.methodError(this.logger, 'refreshPoolState', error as Error, { id });
      }
      throw error;
    }
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Find pool by address and chain
   *
   * @param address - Pool address (normalized or not - will be normalized internally)
   * @param chainId - Chain ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Pool with full Token objects if found, null otherwise
   */
  async findByAddressAndChain(
    address: string,
    chainId: number,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool | null> {
    log.dbOperation(this.logger, 'findFirst', 'Pool', {
      address,
      chainId,
      protocol: 'uniswapv3',
      inTransaction: !!tx,
    });

    const client = tx ?? this.prisma;

    const result = await client.pool.findFirst({
      where: {
        protocol: 'uniswapv3',
        // Query config JSON field for address and chainId
        config: {
          path: ['address'],
          equals: address,
        },
      },
      include: {
        token0: true,
        token1: true,
      },
    });

    if (!result) {
      return null;
    }

    // Map to UniswapV3Pool
    const pool = this.mapToUniswapV3Pool(result);

    // Verify chainId matches (additional safeguard)
    if (pool.chainId !== chainId) {
      return null;
    }

    return pool;
  }

  // ============================================================================
  // POOL HASH
  // ============================================================================

  /**
   * Create a pool hash from raw parameters
   *
   * Format: "uniswapv3/{chainId}/{address}"
   * Example: "uniswapv3/1/0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8"
   *
   * @param params - Object containing chainId and address
   * @returns Human-readable composite key
   * @throws Error if chainId or address is missing or invalid
   */
  createHash(params: { chainId: number; address: string }): string {
    const { chainId, address } = params;

    if (chainId === undefined || chainId === null) {
      throw new Error('createHash: chainId is required');
    }

    if (typeof chainId !== 'number') {
      throw new Error('createHash: chainId must be a number');
    }

    if (!address || typeof address !== 'string') {
      throw new Error('createHash: address is required and must be a string');
    }

    if (!isValidAddress(address)) {
      throw new Error(`createHash: invalid pool address format: ${address}`);
    }

    const normalizedAddress = normalizeAddress(address);

    return `${this.protocol}/${chainId}/${normalizedAddress}`;
  }

  /**
   * Create a pool hash from a UniswapV3Pool instance
   *
   * Format: "uniswapv3/{chainId}/{address}"
   * Example: "uniswapv3/1/0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8"
   *
   * @param pool - UniswapV3Pool instance
   * @returns Human-readable composite key
   * @throws Error if pool protocol doesn't match
   */
  createHashFromPool(pool: UniswapV3Pool): string {
    if (pool.protocol !== this.protocol) {
      throw new Error(
        `createHashFromPool: expected protocol '${this.protocol}', got '${pool.protocol}'`
      );
    }

    const { chainId, address } = pool.typedConfig;

    return `${this.protocol}/${chainId}/${address}`;
  }

  /**
   * Find pool by its hash
   *
   * @param hash - Pool hash (e.g., "uniswapv3/1/0x...")
   * @param tx - Optional transaction client
   * @returns UniswapV3Pool if found and is uniswapv3 protocol, null otherwise
   */
  async findByHash(
    hash: string,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool | null> {
    log.methodEntry(this.logger, 'findByHash', { hash, inTransaction: !!tx });

    try {
      const client = tx ?? this.prisma;
      log.dbOperation(this.logger, 'findFirst', 'Pool', { poolHash: hash });

      const result = await client.pool.findFirst({
        where: {
          poolHash: hash,
          protocol: this.protocol,
        },
        include: {
          token0: true,
          token1: true,
        },
      });

      if (!result) {
        log.methodExit(this.logger, 'findByHash', { hash, found: false });
        return null;
      }

      const pool = this.mapToUniswapV3Pool(result);

      log.methodExit(this.logger, 'findByHash', { hash, found: true, id: pool.id });
      return pool;
    } catch (error) {
      log.methodError(this.logger, 'findByHash', error as Error, { hash });
      throw error;
    }
  }
}
