/**
 * UniswapV3PoolDiscoveryService
 *
 * Discovers Uniswap V3 pools for token pairs across all fee tiers.
 * Enriches results with subgraph metrics (TVL, volume, fees).
 */

import { PrismaClient } from '@midcurve/database';
import type { Address } from 'viem';
import { PoolDiscoveryService } from './pool-discovery-service.js';
import type { PoolDiscoveryResult, Protocol } from '@midcurve/shared';
import type { UniswapV3PoolDiscoveryInput } from '../types/pool-discovery/pool-discovery-input.js';
import type { UniswapV3Pool } from '@midcurve/shared';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import { UniswapV3SubgraphClient } from '../../clients/subgraph/uniswapv3/uniswapv3-subgraph-client.js';
import {
  UniswapV3SubgraphApiError,
  UniswapV3SubgraphUnavailableError,
  PoolNotFoundInSubgraphError,
} from '../../clients/subgraph/uniswapv3/types.js';
import { EvmConfig } from '../../config/evm.js';
import {
  isValidAddress,
  normalizeAddress,
  compareAddresses,
} from '@midcurve/shared';
import {
  getFactoryAddress,
  UNISWAP_V3_FACTORY_ABI,
} from '../../config/uniswapv3.js';
import { FEE_TIERS } from '@midcurve/shared';
import { log } from '../../logging/index.js';

/**
 * Uniswap V3 supported fee tiers (in basis points)
 *
 * Each fee tier has a corresponding tick spacing:
 * - 100 (0.01%) → tick spacing 1
 * - 500 (0.05%) → tick spacing 10
 * - 3000 (0.3%) → tick spacing 60
 * - 10000 (1%) → tick spacing 200
 */
const SUPPORTED_FEE_TIERS = [...FEE_TIERS]; // [100, 500, 3000, 10000]

/**
 * Dependencies for UniswapV3PoolDiscoveryService
 *
 * All dependencies are optional and will use defaults if not provided.
 */
export interface UniswapV3PoolDiscoveryServiceDependencies {
  /**
   * Prisma client for database operations
   */
  prisma?: PrismaClient;

  /**
   * Uniswap V3 pool service for pool discovery
   */
  poolService?: UniswapV3PoolService;

  /**
   * Uniswap V3 subgraph client for metrics
   */
  subgraphClient?: UniswapV3SubgraphClient;

  /**
   * EVM configuration for RPC access
   */
  evmConfig?: EvmConfig;
}

/**
 * UniswapV3PoolDiscoveryService
 *
 * Discovers Uniswap V3 pools for token pairs across all fee tiers.
 * Enriches results with subgraph metrics (TVL, volume, fees).
 *
 * @example
 * ```typescript
 * const service = new UniswapV3PoolDiscoveryService();
 *
 * const results = await service.findPoolsForTokenPair({
 *   chainId: 1,
 *   tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
 *   tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
 * });
 *
 * // Results sorted by TVL descending:
 * // [
 * //   { poolName: "CL60-USDC/WETH", fee: 3000, tvlUSD: "234M", ... },
 * //   { poolName: "CL10-USDC/WETH", fee: 500, tvlUSD: "123M", ... },
 * //   { poolName: "CL1-USDC/WETH", fee: 100, tvlUSD: "45M", ... }
 * // ]
 * ```
 */
export class UniswapV3PoolDiscoveryService extends PoolDiscoveryService {
  protected readonly protocol: Protocol = 'uniswapv3';
  private readonly _poolService: UniswapV3PoolService;
  private readonly _subgraphClient: UniswapV3SubgraphClient;
  private readonly _evmConfig: EvmConfig;

  constructor(
    dependencies: UniswapV3PoolDiscoveryServiceDependencies = {}
  ) {
    super(dependencies);
    this._poolService =
      dependencies.poolService ??
      new UniswapV3PoolService({ prisma: this.prisma });
    this._subgraphClient =
      dependencies.subgraphClient ?? UniswapV3SubgraphClient.getInstance();
    this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
  }

  /**
   * Get pool service instance
   */
  protected get poolService(): UniswapV3PoolService {
    return this._poolService;
  }

  /**
   * Get subgraph client instance
   */
  protected get subgraphClient(): UniswapV3SubgraphClient {
    return this._subgraphClient;
  }

  /**
   * Get EVM config instance
   */
  protected get evmConfig(): EvmConfig {
    return this._evmConfig;
  }

  /**
   * Find all pools for a token pair on Uniswap V3
   *
   * Discovery process:
   * 1. Validate and normalize token addresses
   * 2. Sort addresses to ensure token0 < token1 (Uniswap V3 convention)
   * 3. Query factory contract for all fee tiers in parallel
   * 4. Discover/fetch pools via UniswapV3PoolService
   * 5. Enrich with subgraph metrics (TVL, volume, fees)
   * 6. Sort by TVL descending
   *
   * @param input - Token pair and chain ID
   * @returns Array of pool discovery results, sorted by TVL descending
   * @throws Error if addresses are invalid
   * @throws Error if chain is not supported
   * @throws UniswapV3SubgraphApiError if subgraph returns errors
   */
  async findPoolsForTokenPair(
    input: UniswapV3PoolDiscoveryInput
  ): Promise<PoolDiscoveryResult<'uniswapv3'>[]> {
    const { chainId, tokenA, tokenB } = input;

    log.methodEntry(this.logger, 'findPoolsForTokenPair', {
      chainId,
      tokenA,
      tokenB,
    });

    try {
      // 1. Validate inputs
      if (!isValidAddress(tokenA)) {
        throw new Error(`Invalid tokenA address: ${tokenA}`);
      }
      if (!isValidAddress(tokenB)) {
        throw new Error(`Invalid tokenB address: ${tokenB}`);
      }
      if (!this.evmConfig.isChainSupported(chainId)) {
        throw new Error(`Chain ${chainId} is not supported`);
      }

      // 2. Normalize and sort token addresses (Uniswap V3 convention: token0 < token1)
      const normalizedTokenA = normalizeAddress(tokenA);
      const normalizedTokenB = normalizeAddress(tokenB);
      const [token0, token1] =
        compareAddresses(normalizedTokenA, normalizedTokenB) < 0
          ? [normalizedTokenA, normalizedTokenB]
          : [normalizedTokenB, normalizedTokenA];

      this.logger.debug(
        { token0, token1, chainId },
        'Token addresses normalized and sorted'
      );

      // 3. Query factory for all fee tiers in parallel
      const poolAddresses = await Promise.all(
        SUPPORTED_FEE_TIERS.map((fee) =>
          this.queryPoolAddress(chainId, token0, token1, fee)
        )
      );

      this.logger.debug(
        { poolAddresses, feeCount: SUPPORTED_FEE_TIERS.length },
        'Pool addresses queried from factory'
      );

      // 4. Process pools (discover/fetch from database)
      const results: PoolDiscoveryResult<'uniswapv3'>[] = [];

      for (let i = 0; i < SUPPORTED_FEE_TIERS.length; i++) {
        const fee = SUPPORTED_FEE_TIERS[i]!;
        const poolAddress = poolAddresses[i];

        if (
          poolAddress &&
          poolAddress !== '0x0000000000000000000000000000000000000000'
        ) {
          // Pool exists - discover/fetch via PoolService
          const pool = await this.poolService.discover({
            poolAddress,
            chainId,
          });

          // Create pool name
          const poolName = this.createPoolName(pool);

          // Initialize with default metrics (will be enriched later)
          results.push({
            poolName,
            fee,
            protocol: 'uniswapv3',
            tvlUSD: '0',
            volumeUSD: '0',
            feesUSD: '0',
            pool,
          });

          this.logger.debug(
            { poolAddress, fee, poolName },
            'Pool discovered and added to results'
          );
        }
      }

      // 5. Enrich with subgraph metrics (REQUIRED - must fail on errors)
      await this.enrichWithSubgraphMetrics(results, chainId);

      // 6. Sort by TVL descending
      results.sort((a, b) => {
        const tvlA = parseFloat(a.tvlUSD);
        const tvlB = parseFloat(b.tvlUSD);
        return tvlB - tvlA;
      });

      this.logger.info(
        { poolCount: results.length, chainId, token0, token1 },
        'Pool discovery completed'
      );

      log.methodExit(this.logger, 'findPoolsForTokenPair', {
        poolCount: results.length,
      });
      return results;
    } catch (error) {
      log.methodError(
        this.logger,
        'findPoolsForTokenPair',
        error as Error,
        { chainId, tokenA, tokenB }
      );
      throw error;
    }
  }

  /**
   * Create pool name in format: CL{tickSpacing}-{token0Symbol}/{token1Symbol}
   *
   * Format explanation:
   * - CL = Concentrated Liquidity
   * - {tickSpacing} = tick spacing for the fee tier (1, 10, 60, 200)
   * - {token0Symbol}/{token1Symbol} = token symbols in canonical order
   *
   * @param pool - Uniswap V3 pool object
   * @returns Pool name (e.g., "CL10-USDC/WETH", "CL60-DAI/USDC")
   *
   * @example
   * ```typescript
   * // Fee 500 (0.05%) → Tick spacing 10
   * createPoolName(pool); // "CL10-USDC/WETH"
   *
   * // Fee 3000 (0.3%) → Tick spacing 60
   * createPoolName(pool); // "CL60-DAI/USDC"
   * ```
   */
  createPoolName(pool: UniswapV3Pool): string {
    const token0Symbol = pool.token0.symbol;
    const token1Symbol = pool.token1.symbol;
    const tickSpacing = pool.config.tickSpacing;
    return `CL${tickSpacing}-${token0Symbol}/${token1Symbol}`;
  }

  /**
   * Query factory contract for pool address
   *
   * Calls factory.getPool(token0, token1, fee) to get the pool address.
   * Returns null if pool doesn't exist (address is zero address).
   *
   * @param chainId - Chain ID
   * @param token0 - First token address (normalized, sorted)
   * @param token1 - Second token address (normalized, sorted)
   * @param fee - Fee tier in basis points
   * @returns Pool address or null if doesn't exist
   */
  private async queryPoolAddress(
    chainId: number,
    token0: string,
    token1: string,
    fee: number
  ): Promise<string | null> {
    const client = this.evmConfig.getPublicClient(chainId);
    const factoryAddress = getFactoryAddress(chainId);

    this.logger.debug(
      { factoryAddress, token0, token1, fee, chainId },
      'Querying factory for pool address'
    );

    const poolAddress = (await client.readContract({
      address: factoryAddress,
      abi: UNISWAP_V3_FACTORY_ABI,
      functionName: 'getPool',
      args: [token0 as Address, token1 as Address, fee],
    })) as Address;

    this.logger.debug({ poolAddress, fee }, 'Factory returned pool address');

    return poolAddress &&
      poolAddress !== '0x0000000000000000000000000000000000000000'
      ? normalizeAddress(poolAddress)
      : null;
  }

  /**
   * Enrich pool results with subgraph metrics
   *
   * Queries the Uniswap V3 subgraph for TVL, volume, and fees.
   *
   * Error Handling:
   * - MUST fail if subgraph returns API errors (UniswapV3SubgraphApiError)
   * - MAY use default "0" values if subgraph is unavailable (UniswapV3SubgraphUnavailableError)
   * - MAY use default "0" values if pool not found in subgraph (PoolNotFoundInSubgraphError)
   *
   * Rationale:
   * - API errors indicate a problem with the query or subgraph → fail fast
   * - Unavailable errors are transient network issues → graceful degradation
   * - Not found errors mean pool is too new or not indexed → use defaults
   *
   * @param results - Pool discovery results to enrich
   * @param chainId - Chain ID
   * @throws UniswapV3SubgraphApiError if subgraph returns errors
   */
  private async enrichWithSubgraphMetrics(
    results: PoolDiscoveryResult<'uniswapv3'>[],
    chainId: number
  ): Promise<void> {
    if (results.length === 0) {
      return;
    }

    this.logger.debug(
      { poolCount: results.length, chainId },
      'Enriching pools with subgraph metrics'
    );

    try {
      // Query subgraph for all pools in parallel
      const metricsPromises = results.map(async (result) => {
        const poolAddress = result.pool.address;

        try {
          // Use getPoolFeeData() instead of getPoolMetrics() to get token-specific volumes
          const feeData = await this.subgraphClient.getPoolFeeData(
            chainId,
            poolAddress
          );

          // Update result with aggregate metrics
          result.tvlUSD = feeData.tvlUSD;
          result.volumeUSD = feeData.volumeUSD;
          result.feesUSD = feeData.feesUSD;

          // Update result with token-specific metrics (for accurate APR calculations)
          result.volumeToken0 = feeData.token0.dailyVolume;
          result.volumeToken1 = feeData.token1.dailyVolume;
          result.token0Price = feeData.token0.price;
          result.token1Price = feeData.token1.price;

          this.logger.debug(
            {
              poolAddress,
              tvlUSD: feeData.tvlUSD,
              volumeToken0: feeData.token0.dailyVolume,
              volumeToken1: feeData.token1.dailyVolume,
            },
            'Pool enriched with subgraph metrics and token-specific data'
          );
        } catch (error) {
          // Check error type to determine if we should fail or use defaults
          if (error instanceof UniswapV3SubgraphApiError) {
            // Subgraph returned errors - MUST fail
            this.logger.error(
              { error, poolAddress },
              'Subgraph returned API error'
            );
            throw error;
          } else if (
            error instanceof UniswapV3SubgraphUnavailableError ||
            error instanceof PoolNotFoundInSubgraphError
          ) {
            // Subgraph unavailable or pool not found - use defaults
            this.logger.warn(
              { error: error.message, poolAddress },
              'Subgraph unavailable or pool not found, using default metrics'
            );
            // Result already has default "0" values
          } else {
            // Unknown error - rethrow
            throw error;
          }
        }
      });

      await Promise.all(metricsPromises);

      this.logger.info(
        { poolCount: results.length, chainId },
        'Subgraph enrichment completed'
      );
    } catch (error) {
      this.logger.error({ error, chainId }, 'Subgraph enrichment failed');
      throw error;
    }
  }
}
