/**
 * Uniswap V3 Subgraph Client
 *
 * Client for querying The Graph subgraphs for Uniswap V3 protocol data.
 * Provides pool metrics, fee data, and historical analytics across all
 * EVM chains where Uniswap V3 is deployed.
 *
 * Features:
 * - Distributed caching via PostgreSQL (5-minute TTL)
 * - Automatic retry with exponential backoff for network errors
 * - Graceful degradation (returns default values if unavailable)
 * - Structured logging
 * - Type-safe query responses
 * - Singleton pattern for convenient access
 *
 * @example
 * ```typescript
 * const client = UniswapV3SubgraphClient.getInstance();
 *
 * // Get simple metrics for pool discovery
 * const metrics = await client.getPoolMetrics(1, '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8');
 * console.log(`TVL: $${metrics.tvlUSD}`);
 *
 * // Get detailed fee data for APR calculations
 * const feeData = await client.getPoolFeeData(1, '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8');
 * console.log(`24h fees: $${feeData.feesUSD}`);
 * ```
 */

import crypto from 'crypto';
import { isLocalChain } from '../../../config/evm.js';
import { createServiceLogger, log } from '../../../logging/index.js';
import type { ServiceLogger } from '../../../logging/index.js';
import { CacheService } from '../../../services/cache/index.js';
import { normalizeAddress } from '@midcurve/shared';
import {
  getUniswapV3SubgraphEndpoint,
  isUniswapV3SubgraphSupported,
  getSupportedUniswapV3SubgraphChains,
} from '../../../config/uniswapv3-subgraph.js';
import {
  POOL_METRICS_QUERY,
  POOL_FEE_DATA_QUERY,
  POOLS_BY_TOKEN_SETS_QUERY,
  FACTORY_QUERY,
} from './queries.js';
import { getFactoryAddress } from '../../../config/uniswapv3.js';
import {
  PoolNotFoundInSubgraphError,
} from './types.js';
import type {
  SubgraphResponse,
  PoolMetrics,
  PoolFeeData,
  RawPoolData,
  RawPoolSearchData,
  PoolSearchSubgraphResult,
  UniswapV3SubgraphApiError,
  UniswapV3SubgraphUnavailableError,
} from './types.js';

/**
 * Dependencies for UniswapV3SubgraphClient
 */
export interface UniswapV3SubgraphClientDependencies {
  /**
   * Cache service for distributed caching
   * If not provided, the singleton CacheService instance will be used
   */
  cacheService?: CacheService;

  /**
   * Custom fetch function for testing
   * If not provided, the global fetch will be used
   */
  fetch?: typeof fetch;
}

/**
 * Cached factory validation result.
 * Stores both the validation result and the config values at validation time.
 * On lookup, compare cached config values with current config to detect changes.
 */
export interface FactoryValidationCache {
  /** Factory address returned by the subgraph */
  subgraphFactory: string;
  /** Our hardcoded factory address at validation time */
  expectedFactory: string;
  /** Subgraph deployment ID at validation time */
  subgraphId: string;
  /** Whether factory addresses matched */
  isValid: boolean;
  /** Timestamp when validation occurred */
  validatedAt: number;
}

/**
 * Uniswap V3 Subgraph Client
 *
 * Provides access to Uniswap V3 pool data from The Graph subgraphs.
 * Uses distributed PostgreSQL caching and retry logic for reliability.
 */
export class UniswapV3SubgraphClient {
  private static instance: UniswapV3SubgraphClient | null = null;

  private readonly cacheService: CacheService;
  private readonly fetchFn: typeof fetch;
  private readonly cacheTtl = 300; // 5 minutes in seconds
  private readonly factoryCacheTtl = 86400; // 24 hours in seconds
  private readonly logger: ServiceLogger;

  /**
   * Creates a new UniswapV3SubgraphClient instance
   *
   * @param dependencies - Optional dependencies for testing
   */
  constructor(dependencies: UniswapV3SubgraphClientDependencies = {}) {
    this.logger = createServiceLogger('UniswapV3SubgraphClient');
    this.cacheService = dependencies.cacheService ?? CacheService.getInstance();
    this.fetchFn = dependencies.fetch ?? fetch;

    this.logger.debug('UniswapV3SubgraphClient initialized');
  }

  /**
   * Get singleton instance of UniswapV3SubgraphClient
   */
  static getInstance(): UniswapV3SubgraphClient {
    if (!UniswapV3SubgraphClient.instance) {
      UniswapV3SubgraphClient.instance = new UniswapV3SubgraphClient();
    }
    return UniswapV3SubgraphClient.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  static resetInstance(): void {
    UniswapV3SubgraphClient.instance = null;
  }

  /**
   * Execute a GraphQL query against the Uniswap V3 subgraph
   *
   * This is the low-level query method that handles:
   * - Endpoint resolution
   * - Caching (5-minute TTL)
   * - Error handling
   * - Retry logic for network errors
   *
   * Most consumers should use higher-level methods like getPoolMetrics()
   * or getPoolFeeData() instead.
   *
   * @param chainId - Chain ID to query
   * @param query - GraphQL query string
   * @param variables - Query variables
   * @returns Subgraph response with typed data
   * @throws UniswapV3SubgraphApiError if subgraph returns errors
   * @throws UniswapV3SubgraphUnavailableError if network errors occur
   *
   * @example
   * ```typescript
   * const response = await client.query<{ pools: RawPoolData[] }>(
   *   1,
   *   POOL_METRICS_QUERY,
   *   { poolId: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8' }
   * );
   * ```
   */
  async query<T>(
    chainId: number,
    query: string,
    variables?: Record<string, unknown>
  ): Promise<SubgraphResponse<T>> {
    log.methodEntry(this.logger, 'query', { chainId, variables });

    // Validate chain support
    if (!isUniswapV3SubgraphSupported(chainId)) {
      const error = new Error(
        `Uniswap V3 subgraph not available for chain ${chainId}. ` +
          `Supported chains: ${getSupportedUniswapV3SubgraphChains().join(', ')}`
      ) as UniswapV3SubgraphApiError;
      error.name = 'UniswapV3SubgraphApiError';
      log.methodError(this.logger, 'query', error, { chainId });
      throw error;
    }

    // Check cache
    const cacheKey = this.buildCacheKey(chainId, query, variables);
    const cached = await this.cacheService.get<SubgraphResponse<T>>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'query', cacheKey);
      log.methodExit(this.logger, 'query', { fromCache: true });
      return cached;
    }

    log.cacheMiss(this.logger, 'query', cacheKey);

    // Get endpoint
    const endpoint = getUniswapV3SubgraphEndpoint(chainId);

    // Execute query with retry logic
    try {
      const response = await this.executeQueryWithRetry<T>(endpoint, query, variables);

      // Cache successful responses
      if (response.data && !response.errors) {
        await this.cacheService.set(cacheKey, response, this.cacheTtl);
        this.logger.debug({ cacheKey }, 'Cached subgraph response');
      }

      log.methodExit(this.logger, 'query', { fromCache: false });
      return response;
    } catch (error) {
      log.methodError(this.logger, 'query', error as Error, { chainId });
      throw error;
    }
  }

  /**
   * Get lightweight pool metrics for pool discovery
   *
   * Returns TVL, volume, and fees for ranking pools.
   * This is the primary method used by PoolDiscoveryService.
   *
   * If the pool is not found or has no data, returns default "0" values.
   * If the subgraph returns errors, throws UniswapV3SubgraphApiError.
   *
   * @param chainId - Chain ID where pool exists
   * @param poolAddress - Pool contract address (any case)
   * @returns Pool metrics with USD values as strings
   * @throws UniswapV3SubgraphApiError if subgraph returns errors
   *
   * @example
   * ```typescript
   * const metrics = await client.getPoolMetrics(
   *   1,
   *   '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8'
   * );
   * console.log(`TVL: $${metrics.tvlUSD}, Volume: $${metrics.volumeUSD}`);
   * ```
   */
  async getPoolMetrics(chainId: number, poolAddress: string): Promise<PoolMetrics> {
    log.methodEntry(this.logger, 'getPoolMetrics', { chainId, poolAddress });

    // Graceful degradation for local development chains
    // The Graph doesn't index local chains, so return default metrics
    if (isLocalChain(chainId)) {
      this.logger.warn(
        { chainId, poolAddress },
        'Subgraph not available for local chain, returning default metrics'
      );

      const defaultMetrics: PoolMetrics = {
        tvlUSD: '0',
        volumeUSD: '0',
        feesUSD: '0',
      };

      log.methodExit(this.logger, 'getPoolMetrics', { reason: 'local_chain' });
      return defaultMetrics;
    }

    try {
      // Normalize address to lowercase for subgraph query
      const poolId = normalizeAddress(poolAddress).toLowerCase();

      log.externalApiCall(
        this.logger,
        'UniswapV3Subgraph',
        'POOL_METRICS_QUERY',
        { chainId, poolId }
      );

      const response = await this.query<{ pools: RawPoolData[] }>(
        chainId,
        POOL_METRICS_QUERY,
        { poolId }
      );

      // Check for GraphQL errors
      if (response.errors && response.errors.length > 0) {
        const error = new Error(
          `Subgraph query failed: ${response.errors.map((e) => e.message).join(', ')}`
        ) as UniswapV3SubgraphApiError;
        error.name = 'UniswapV3SubgraphApiError';
        (error as any).graphqlErrors = response.errors;
        log.methodError(this.logger, 'getPoolMetrics', error, { chainId, poolAddress });
        throw error;
      }

      // Handle pool not found or no data
      if (!response.data?.pools || response.data.pools.length === 0) {
        this.logger.warn(
          { chainId, poolAddress },
          'Pool not found in subgraph, returning default metrics'
        );

        const defaultMetrics: PoolMetrics = {
          tvlUSD: '0',
          volumeUSD: '0',
          feesUSD: '0',
        };

        log.methodExit(this.logger, 'getPoolMetrics', { found: false });
        return defaultMetrics;
      }

      const pool = response.data.pools[0]!; // We checked length above

      // Handle missing pool day data
      if (!pool.poolDayData || pool.poolDayData.length === 0) {
        this.logger.warn(
          { chainId, poolAddress },
          'No pool day data available, returning default metrics'
        );

        const defaultMetrics: PoolMetrics = {
          tvlUSD: '0',
          volumeUSD: '0',
          feesUSD: '0',
        };

        log.methodExit(this.logger, 'getPoolMetrics', { found: true, hasData: false });
        return defaultMetrics;
      }

      const dayData = pool.poolDayData[0]!; // We checked length above

      const metrics: PoolMetrics = {
        tvlUSD: dayData.tvlUSD || '0',
        volumeUSD: dayData.volumeUSD || '0',
        feesUSD: dayData.feesUSD || '0',
      };

      this.logger.debug(
        { chainId, poolAddress, metrics },
        'Pool metrics retrieved from subgraph'
      );

      log.methodExit(this.logger, 'getPoolMetrics', { found: true, hasData: true });
      return metrics;
    } catch (error) {
      // Errors already logged by query() method
      throw error;
    }
  }

  /**
   * Get detailed pool fee data for analysis
   *
   * Returns comprehensive pool data including token prices, volumes,
   * and pool state. Used for APR calculations and fee projections.
   *
   * @param chainId - Chain ID where pool exists
   * @param poolAddress - Pool contract address (any case)
   * @returns Detailed pool fee data
   * @throws PoolNotFoundInSubgraphError if pool not found
   * @throws UniswapV3SubgraphApiError if subgraph returns errors
   *
   * @example
   * ```typescript
   * const feeData = await client.getPoolFeeData(
   *   1,
   *   '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8'
   * );
   * console.log(`Pool liquidity: ${feeData.poolLiquidity}`);
   * console.log(`Token0: ${feeData.token0.symbol}, price: ${feeData.token0.price}`);
   * ```
   */
  async getPoolFeeData(chainId: number, poolAddress: string): Promise<PoolFeeData> {
    log.methodEntry(this.logger, 'getPoolFeeData', { chainId, poolAddress });

    // Graceful degradation for local development chains
    // The Graph doesn't index local chains, so we can't provide fee data
    if (isLocalChain(chainId)) {
      this.logger.warn(
        { chainId, poolAddress },
        'Subgraph not available for local chain, fee data unavailable'
      );

      // For local chains, throw a specific error that callers can handle
      const error = new PoolNotFoundInSubgraphError(chainId, normalizeAddress(poolAddress));
      log.methodError(this.logger, 'getPoolFeeData', error, { reason: 'local_chain' });
      throw error;
    }

    try {
      // Normalize address
      const normalizedAddress = normalizeAddress(poolAddress);
      const poolId = normalizedAddress.toLowerCase();

      log.externalApiCall(
        this.logger,
        'UniswapV3Subgraph',
        'POOL_FEE_DATA_QUERY',
        { chainId, poolId }
      );

      const response = await this.query<{ pools: RawPoolData[] }>(
        chainId,
        POOL_FEE_DATA_QUERY,
        { poolId }
      );

      // Check for GraphQL errors
      if (response.errors && response.errors.length > 0) {
        const error = new Error(
          `Subgraph query failed: ${response.errors.map((e) => e.message).join(', ')}`
        ) as UniswapV3SubgraphApiError;
        error.name = 'UniswapV3SubgraphApiError';
        (error as any).graphqlErrors = response.errors;
        log.methodError(this.logger, 'getPoolFeeData', error, { chainId, poolAddress });
        throw error;
      }

      // Pool not found
      if (!response.data?.pools || response.data.pools.length === 0) {
        const error = new PoolNotFoundInSubgraphError(chainId, normalizedAddress);
        log.methodError(this.logger, 'getPoolFeeData', error, { chainId, poolAddress });
        throw error;
      }

      const pool = response.data.pools[0]!; // We checked length above

      // No pool day data
      if (!pool.poolDayData || pool.poolDayData.length === 0) {
        const error = new Error(
          `No recent pool data available for ${poolAddress} on chain ${chainId}`
        ) as UniswapV3SubgraphApiError;
        error.name = 'UniswapV3SubgraphApiError';
        log.methodError(this.logger, 'getPoolFeeData', error, { chainId, poolAddress });
        throw error;
      }

      const dayData = pool.poolDayData[0]!; // We checked length above

      // Convert decimal strings to bigint strings (for token amounts)
      // The subgraph returns decimal numbers, but we need them as token units (bigints)
      const token0Decimals = parseInt(pool.token0.decimals);
      const token1Decimals = parseInt(pool.token1.decimals);

      const feeData: PoolFeeData = {
        poolAddress: normalizedAddress,
        chainId,
        feeTier: pool.feeTier,
        poolLiquidity: pool.liquidity,
        sqrtPriceX96: pool.sqrtPrice,
        tvlUSD: dayData.tvlUSD || '0',
        volumeUSD: dayData.volumeUSD || '0',
        feesUSD: dayData.feesUSD || '0',
        token0: {
          address: normalizeAddress(pool.token0.id),
          symbol: pool.token0.symbol,
          decimals: token0Decimals,
          dailyVolume: this.decimalToBigIntString(dayData.volumeToken0, token0Decimals),
          price: this.decimalToBigIntString(dayData.token1Price, token1Decimals),
        },
        token1: {
          address: normalizeAddress(pool.token1.id),
          symbol: pool.token1.symbol,
          decimals: token1Decimals,
          dailyVolume: this.decimalToBigIntString(dayData.volumeToken1, token1Decimals),
          price: this.decimalToBigIntString(dayData.token0Price, token0Decimals),
        },
        calculatedAt: new Date(),
      };

      this.logger.debug(
        { chainId, poolAddress, token0: pool.token0.symbol, token1: pool.token1.symbol },
        'Pool fee data retrieved from subgraph'
      );

      log.methodExit(this.logger, 'getPoolFeeData', { found: true });
      return feeData;
    } catch (error) {
      // Errors already logged
      throw error;
    }
  }

  /**
   * Search pools by token sets
   *
   * Finds all pools where tokens match the provided sets in either direction.
   * Returns pools sorted by TVL descending with calculated 7-day APR.
   *
   * @param chainId - Chain ID to search
   * @param tokenSetA - Array of token addresses (lowercase)
   * @param tokenSetB - Array of token addresses (lowercase)
   * @returns Array of pool search results with metrics and 7-day APR
   *
   * @example
   * ```typescript
   * const pools = await client.searchPoolsByTokenSets(
   *   1, // Ethereum
   *   ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0xdac17f958d2ee523a2206206994597c13d831ec7'], // USDC, USDT
   *   ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'] // WETH
   * );
   * console.log(`Found ${pools.length} pools`);
   * ```
   */
  async searchPoolsByTokenSets(
    chainId: number,
    tokenSetA: string[],
    tokenSetB: string[]
  ): Promise<PoolSearchSubgraphResult[]> {
    log.methodEntry(this.logger, 'searchPoolsByTokenSets', {
      chainId,
      tokenSetA,
      tokenSetB,
    });

    // Graceful degradation for local development chains
    if (isLocalChain(chainId)) {
      this.logger.warn(
        { chainId },
        'Subgraph not available for local chain, returning empty results'
      );
      log.methodExit(this.logger, 'searchPoolsByTokenSets', { reason: 'local_chain' });
      return [];
    }

    // Validate inputs
    if (tokenSetA.length === 0 || tokenSetB.length === 0) {
      this.logger.warn('Empty token set provided, returning empty results');
      log.methodExit(this.logger, 'searchPoolsByTokenSets', { reason: 'empty_input' });
      return [];
    }

    try {
      // Normalize addresses to lowercase for subgraph query
      const token0List = tokenSetA.map((addr) => addr.toLowerCase());
      const token1List = tokenSetB.map((addr) => addr.toLowerCase());

      log.externalApiCall(
        this.logger,
        'UniswapV3Subgraph',
        'POOLS_BY_TOKEN_SETS_QUERY',
        { chainId, token0Count: token0List.length, token1Count: token1List.length }
      );

      const response = await this.query<{ pools: RawPoolSearchData[] }>(
        chainId,
        POOLS_BY_TOKEN_SETS_QUERY,
        { token0List, token1List }
      );

      // Check for GraphQL errors
      if (response.errors && response.errors.length > 0) {
        const error = new Error(
          `Subgraph query failed: ${response.errors.map((e) => e.message).join(', ')}`
        ) as UniswapV3SubgraphApiError;
        error.name = 'UniswapV3SubgraphApiError';
        (error as any).graphqlErrors = response.errors;
        log.methodError(this.logger, 'searchPoolsByTokenSets', error, { chainId });
        throw error;
      }

      // Handle no pools found
      if (!response.data?.pools || response.data.pools.length === 0) {
        this.logger.debug({ chainId }, 'No pools found for token sets');
        log.methodExit(this.logger, 'searchPoolsByTokenSets', { found: 0 });
        return [];
      }

      // Process each pool
      const results: PoolSearchSubgraphResult[] = response.data.pools.map((pool) => {
        // Calculate 7-day fees sum
        const fees7d = pool.poolDayData.reduce((sum, day) => {
          return sum + parseFloat(day.feesUSD || '0');
        }, 0);

        // Get most recent day data for 24h metrics
        const latestDay = pool.poolDayData[0];
        const volume24h = latestDay?.volumeUSD || '0';
        const fees24h = latestDay?.feesUSD || '0';
        const currentTvl = parseFloat(pool.totalValueLockedUSD || '0');

        // Calculate 7-day average APR: (fees7d / 7 * 365) / tvl * 100
        let apr7d = 0;
        if (currentTvl > 0 && fees7d > 0) {
          const avgDailyFees = fees7d / 7;
          apr7d = (avgDailyFees * 365 / currentTvl) * 100;
        }

        return {
          poolAddress: normalizeAddress(pool.id),
          chainId,
          feeTier: parseInt(pool.feeTier),
          token0: {
            address: normalizeAddress(pool.token0.id),
            symbol: pool.token0.symbol,
            decimals: parseInt(pool.token0.decimals),
          },
          token1: {
            address: normalizeAddress(pool.token1.id),
            symbol: pool.token1.symbol,
            decimals: parseInt(pool.token1.decimals),
          },
          tvlUSD: pool.totalValueLockedUSD || '0',
          volume24hUSD: volume24h,
          fees24hUSD: fees24h,
          fees7dUSD: fees7d.toFixed(2),
          apr7d: Math.round(apr7d * 100) / 100, // Round to 2 decimal places
        };
      });

      this.logger.debug(
        { chainId, poolCount: results.length },
        'Pool search completed'
      );

      log.methodExit(this.logger, 'searchPoolsByTokenSets', { found: results.length });
      return results;
    } catch (error) {
      // Errors already logged
      throw error;
    }
  }

  /**
   * Clear all Uniswap V3 subgraph caches
   *
   * @returns Number of cache entries cleared, or -1 on error
   *
   * @example
   * ```typescript
   * const cleared = await client.clearCache();
   * console.log(`Cleared ${cleared} cache entries`);
   * ```
   */
  async clearCache(): Promise<number> {
    return await this.cacheService.clear('subgraph:uniswapv3:');
  }

  /**
   * Check if a chain is supported by Uniswap V3 subgraph
   *
   * @param chainId - Chain ID to check
   * @returns true if subgraph is available
   *
   * @example
   * ```typescript
   * if (client.isChainSupported(1)) {
   *   // Query Ethereum mainnet subgraph
   * }
   * ```
   */
  isChainSupported(chainId: number): boolean {
    return isUniswapV3SubgraphSupported(chainId);
  }

  /**
   * Get all supported chain IDs
   *
   * @returns Array of chain IDs with Uniswap V3 subgraph support
   *
   * @example
   * ```typescript
   * const chains = client.getSupportedChainIds();
   * // [1, 42161, 8453, 10, 137]
   * ```
   */
  getSupportedChainIds(): number[] {
    return getSupportedUniswapV3SubgraphChains();
  }

  // ============================================================================
  // FACTORY VALIDATION
  // ============================================================================

  /**
   * Validate that the subgraph's factory address matches our expected factory.
   *
   * Uses a fixed cache key per chain. On lookup, compares cached config values
   * with current config to detect changes (subgraph ID or factory address).
   *
   * @param chainId - Chain ID to validate
   * @returns true if factory addresses match, false otherwise
   *
   * @example
   * ```typescript
   * const isValid = await client.validateSubgraphFactory(1);
   * if (!isValid) {
   *   console.warn('Subgraph factory mismatch - skipping chain');
   * }
   * ```
   */
  async validateSubgraphFactory(chainId: number): Promise<boolean> {
    const cacheKey = `subgraph:factory-validation:${chainId}`;

    // Get current expected values from config
    const currentSubgraphId = this.extractSubgraphId(chainId);
    const currentExpectedFactory = getFactoryAddress(chainId).toLowerCase();

    // Check cache
    const cached = await this.cacheService.get<FactoryValidationCache>(cacheKey);

    if (cached) {
      // Compare cached config values with current config
      const configChanged =
        cached.subgraphId !== currentSubgraphId ||
        cached.expectedFactory !== currentExpectedFactory;

      if (!configChanged) {
        // Config unchanged, use cached validation result
        this.logger.debug(
          { chainId, isValid: cached.isValid },
          'Using cached factory validation'
        );
        return cached.isValid;
      }

      // Config changed - need to revalidate
      this.logger.info(
        {
          chainId,
          oldSubgraphId: cached.subgraphId,
          newSubgraphId: currentSubgraphId,
          oldFactory: cached.expectedFactory,
          newFactory: currentExpectedFactory,
        },
        'Config changed, revalidating subgraph factory'
      );
    }

    // Query subgraph for factory address
    this.logger.info({ chainId }, 'Validating subgraph factory address');

    try {
      const response = await this.query<{ factories: Array<{ id: string }> }>(
        chainId,
        FACTORY_QUERY,
        {}
      );

      const subgraphFactory = response.data?.factories?.[0]?.id?.toLowerCase() ?? '';
      const isValid = subgraphFactory === currentExpectedFactory;

      if (!isValid) {
        this.logger.error(
          {
            chainId,
            subgraphFactory,
            expectedFactory: currentExpectedFactory,
            subgraphId: currentSubgraphId,
          },
          'Subgraph factory mismatch! Subgraph may be indexing a different protocol.'
        );
      } else {
        this.logger.info(
          { chainId, factory: subgraphFactory },
          'Subgraph factory validation successful'
        );
      }

      // Cache result with all comparison values
      const cacheEntry: FactoryValidationCache = {
        subgraphFactory,
        expectedFactory: currentExpectedFactory,
        subgraphId: currentSubgraphId,
        isValid,
        validatedAt: Date.now(),
      };
      await this.cacheService.set(cacheKey, cacheEntry, this.factoryCacheTtl);

      return isValid;
    } catch (error) {
      this.logger.error(
        { chainId, error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to validate subgraph factory'
      );
      // On error, reject the chain to be safe
      return false;
    }
  }

  /**
   * Extract subgraph deployment ID from endpoint URL.
   *
   * The subgraph ID is part of the cache key to detect when a new
   * subgraph version is deployed.
   *
   * @param chainId - Chain ID
   * @returns Subgraph deployment ID (e.g., "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV")
   * @private
   */
  private extractSubgraphId(chainId: number): string {
    try {
      const endpoint = getUniswapV3SubgraphEndpoint(chainId);
      // Extract ID from URL like: .../subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV
      const match = endpoint.match(/\/id\/([A-Za-z0-9]+)(?:\?|$)/);
      return match?.[1] ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // ============================================================================
  // INTERNAL UTILITIES
  // ============================================================================

  /**
   * Build cache key from query and variables
   *
   * Uses MD5 hash of query + variables for uniqueness while keeping
   * cache keys reasonably short.
   *
   * @param chainId - Chain ID
   * @param query - GraphQL query string
   * @param variables - Query variables
   * @returns Cache key
   * @private
   */
  private buildCacheKey(
    chainId: number,
    query: string,
    variables?: Record<string, unknown>
  ): string {
    const hash = crypto
      .createHash('md5')
      .update(query + JSON.stringify(variables ?? {}))
      .digest('hex');
    return `subgraph:uniswapv3:${chainId}:${hash}`;
  }

  /**
   * Execute GraphQL query with retry logic
   *
   * Retries on network errors (not GraphQL errors) with exponential backoff.
   *
   * @param endpoint - Subgraph endpoint URL
   * @param query - GraphQL query string
   * @param variables - Query variables
   * @returns Subgraph response
   * @throws UniswapV3SubgraphApiError for HTTP/GraphQL errors
   * @throws UniswapV3SubgraphUnavailableError for network errors
   * @private
   */
  private async executeQueryWithRetry<T>(
    endpoint: string,
    query: string,
    variables?: Record<string, unknown>
  ): Promise<SubgraphResponse<T>> {
    const maxRetries = 3;
    const baseDelayMs = 500;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.fetchFn(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
        });

        // HTTP error
        if (!response.ok) {
          const error = new Error(
            `Subgraph HTTP error: ${response.status} ${response.statusText}`
          ) as UniswapV3SubgraphApiError;
          error.name = 'UniswapV3SubgraphApiError';
          (error as any).statusCode = response.status;
          throw error;
        }

        // Parse response
        const data = (await response.json()) as SubgraphResponse<T>;

        // Return even if there are GraphQL errors
        // Caller will handle them appropriately
        return data;
      } catch (error) {
        const isLastAttempt = attempt === maxRetries - 1;

        // Don't retry UniswapV3SubgraphApiError (HTTP errors, not network errors)
        if (error instanceof Error && error.name === 'UniswapV3SubgraphApiError') {
          throw error;
        }

        // Network error - retry with backoff
        if (!isLastAttempt) {
          const delay = baseDelayMs * 2 ** attempt;
          this.logger.warn(
            { attempt: attempt + 1, maxRetries, delay, error },
            'Subgraph query failed, retrying'
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // All retries exhausted
          const unavailableError = new Error(
            `Subgraph unavailable after ${maxRetries} attempts: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          ) as UniswapV3SubgraphUnavailableError;
          unavailableError.name = 'UniswapV3SubgraphUnavailableError';
          (unavailableError as any).cause = error;
          throw unavailableError;
        }
      }
    }

    // Should never reach here
    throw new Error('Unexpected end of retry loop');
  }

  /**
   * Convert decimal string to bigint string
   *
   * The subgraph returns token amounts as decimal numbers (e.g., "1234.567").
   * We need to convert them to bigint strings representing token units
   * (e.g., "1234567000" for a 6-decimal token).
   *
   * Uses string manipulation to avoid precision loss from parseFloat()
   * which can't handle large numbers (>2^53) and converts them to scientific notation.
   *
   * @param decimalStr - Decimal string from subgraph
   * @param decimals - Token decimals
   * @returns BigInt string representing token units
   * @private
   *
   * @example
   * ```typescript
   * decimalToBigIntString("1234.567", 6) // "1234567000"
   * decimalToBigIntString("0.000001", 6) // "1"
   * decimalToBigIntString("38001.234287552940", 18) // "38001234287552940000000"
   * ```
   */
  private decimalToBigIntString(decimalStr: string, decimals: number): string {
    if (!decimalStr || decimalStr === '0') {
      return '0';
    }

    try {
      // Split into integer and fractional parts
      const [integerPart = '0', fractionalPart = ''] = decimalStr.split('.');

      // Pad or truncate fractional part to match token decimals
      const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals);

      // Combine integer and fractional parts
      const combined = integerPart + paddedFractional;

      // Remove leading zeros and return (or '0' if empty)
      const result = combined.replace(/^0+/, '') || '0';

      return result;
    } catch (error) {
      this.logger.warn(
        { decimalStr, decimals, error },
        'Failed to convert decimal to bigint, returning 0'
      );
      return '0';
    }
  }
}
