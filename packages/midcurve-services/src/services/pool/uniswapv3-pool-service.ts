/**
 * UniswapV3PoolService
 *
 * On-chain-only service for Uniswap V3 pool data.
 * Reads pool configuration, state, price, and tick data from the blockchain.
 * Does NOT write to any database — all results are transient.
 *
 * The discover() method fetches on-chain pool config/state and returns a
 * transient UniswapV3Pool instance (with a synthetic ID based on pool hash).
 */

import {
  UniswapV3Pool,
  UniswapV3PoolConfig,
  isValidAddress,
  normalizeAddress,
} from '@midcurve/shared';
import type {
  UniswapV3PoolState,
} from '@midcurve/shared';
import type {
  UniswapV3PoolDiscoverInput,
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

// Re-export PrismaTransactionClient for backwards compatibility
// The canonical location is now clients/prisma/index.ts
export type { PrismaTransactionClient } from '../../clients/prisma/index.js';

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

/**
 * Dependencies for UniswapV3PoolService
 * All dependencies are optional and will use defaults if not provided
 */
export interface UniswapV3PoolServiceDependencies {
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
 * On-chain-only service for Uniswap V3 concentrated liquidity pools.
 * Returns UniswapV3Pool class instances for type-safe config/state access.
 * Does NOT perform any database operations.
 */
export class UniswapV3PoolService {
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
   * @param dependencies.evmConfig - EVM configuration instance (uses singleton if not provided)
   * @param dependencies.erc20TokenService - ERC-20 token service (creates default if not provided)
   */
  constructor(dependencies: UniswapV3PoolServiceDependencies = {}) {
    this.logger = createServiceLogger('UniswapV3PoolService');
    this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this._erc20TokenService =
      dependencies.erc20TokenService ??
      new Erc20TokenService();
    this._evmBlockService =
      dependencies.evmBlockService ??
      new EvmBlockService({ evmConfig: this._evmConfig });
    this._cacheService =
      dependencies.cacheService ?? CacheService.getInstance();
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

    // 4. Check cache (pool config is immutable — long TTL)
    const cacheKey = `uniswapv3-pool-config:${chainId}:${normalizedAddress}`;
    const cached = await this._cacheService.get<{
      chainId: number;
      address: string;
      token0: string;
      token1: string;
      feeBps: number;
      tickSpacing: number;
    }>(cacheKey);

    if (cached) {
      this.logger.debug({ cacheKey }, 'Pool config cache hit');
      log.methodExit(this.logger, 'fetchPoolConfig', { address: normalizedAddress });
      return new UniswapV3PoolConfig(cached);
    }

    // 5. Cache miss — get public client for the chain
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

      // Cache the immutable config (30 days)
      await this._cacheService.set(cacheKey, config.toJSON(), 30 * 24 * 60 * 60);

      this.logger.info(
        {
          address: normalizedAddress,
          chainId,
          token0,
          token1,
          feeBps: fee,
          tickSpacing,
        },
        'Pool configuration fetched and cached',
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
  // DISCOVERY (on-chain only, no DB writes)
  // ============================================================================

  /**
   * Discover a Uniswap V3 pool from on-chain contract data
   *
   * Reads on-chain pool config and state, discovers tokens, and returns
   * a transient UniswapV3Pool instance. Does NOT write to the database.
   *
   * 1. Validates and normalizes pool address
   * 2. Reads immutable pool config from on-chain (token0, token1, fee, tickSpacing)
   * 3. Discovers/fetches token0 and token1 via Erc20TokenService
   * 4. Reads current pool state from on-chain (sqrtPriceX96, liquidity, etc.)
   * 5. Constructs and returns a UniswapV3Pool instance with a synthetic ID (pool hash)
   *
   * @param params - Discovery parameters { poolAddress, chainId }
   * @returns A transient UniswapV3Pool instance (not persisted)
   * @throws Error if address format is invalid
   * @throws Error if chain ID is not supported
   * @throws PoolConfigError if contract doesn't implement Uniswap V3 pool interface
   */
  async discover(
    params: UniswapV3PoolDiscoverInput,
  ): Promise<UniswapV3Pool> {
    const { poolAddress, chainId } = params;
    log.methodEntry(this.logger, 'discover', { poolAddress, chainId });

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

      // 3. Verify chain is supported
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

      // 4. Read on-chain pool configuration
      this.logger.debug(
        { address: normalizedAddress, chainId },
        'Reading pool configuration from contract'
      );

      const config = await this.fetchPoolConfig(chainId, normalizedAddress);

      // 5. Discover tokens (creates in DB if not exist)
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

      // 6. Read current pool state from on-chain (with caching)
      const onChainState = await this.fetchPoolState(chainId, normalizedAddress, 'latest');
      const state: UniswapV3PoolState = {
        sqrtPriceX96: onChainState.sqrtPriceX96,
        currentTick: onChainState.currentTick,
        liquidity: onChainState.liquidity,
        feeGrowthGlobal0: onChainState.feeGrowthGlobal0,
        feeGrowthGlobal1: onChainState.feeGrowthGlobal1,
      };

      // 7. Create a synthetic pool hash as the ID (no DB row)
      const poolHash = this.createHash({ chainId, address: normalizedAddress });

      // 8. Construct transient UniswapV3Pool instance
      const now = new Date();
      const pool = new UniswapV3Pool({
        id: poolHash,
        token0,
        token1,
        config,
        state,
        createdAt: now,
        updatedAt: now,
      });

      this.logger.info(
        {
          id: pool.id,
          address: normalizedAddress,
          chainId,
          token0: token0.symbol,
          token1: token1.symbol,
          feeBps: config.feeBps,
        },
        'Pool discovered successfully (transient)'
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
   * given token pair and fee tier, then calls discover() to fetch the pool data.
   *
   * @param chainId - Chain ID
   * @param tokenA - Address of first token (order doesn't matter)
   * @param tokenB - Address of second token (order doesn't matter)
   * @param feeBps - Fee tier in basis points (e.g., 500, 3000, 10000)
   * @returns A transient UniswapV3Pool instance
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

      // Call discover() to fetch pool data
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
}
