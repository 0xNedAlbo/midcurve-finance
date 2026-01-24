/**
 * Pool Discovery Service
 *
 * Abstract base class for protocol-specific pool discovery services.
 * Handles discovery of pools for token pairs and enrichment with indexer metrics.
 */

import { PrismaClient } from '@midcurve/database';
import type { PoolInterface, Protocol, PoolDiscoveryResult } from '@midcurve/shared';
import type { PoolDiscoveryInput } from '../types/pool-discovery/pool-discovery-input.js';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for PoolDiscoveryService
 *
 * All dependencies are optional and will use defaults if not provided.
 * Dependency injection enables testing with mocked dependencies.
 */
export interface PoolDiscoveryServiceDependencies {
  /**
   * Prisma client for database operations
   *
   * If not provided, a new PrismaClient instance will be created.
   * In tests, provide a mocked Prisma client for isolation.
   */
  prisma?: PrismaClient;
}

/**
 * Abstract PoolDiscoveryService
 *
 * Base class for protocol-specific pool discovery services.
 * Handles discovery of pools for token pairs and enrichment with subgraph/indexer metrics.
 *
 * Protocol implementations MUST implement:
 * - findPoolsForTokenPair() - Discover and return pools with metrics
 * - createPoolName() - Generate human-readable pool names
 *
 * @example
 * ```typescript
 * // Uniswap V3 implementation
 * class UniswapV3PoolDiscoveryService extends PoolDiscoveryService {
 *   protected readonly protocol: Protocol = 'uniswapv3';
 *
 *   async findPoolsForTokenPair(
 *     input: UniswapV3PoolDiscoveryInput
 *   ): Promise<PoolDiscoveryResult<'uniswapv3'>[]> {
 *     // 1. Query factory for all fee tiers
 *     // 2. Discover/fetch pools via PoolService
 *     // 3. Enrich with subgraph metrics
 *     // 4. Sort by TVL descending
 *     return results;
 *   }
 *
 *   createPoolName(pool: UniswapV3Pool): string {
 *     return `CL${pool.tickSpacing}-${pool.token0.symbol}/${pool.token1.symbol}`;
 *   }
 * }
 * ```
 */
export abstract class PoolDiscoveryService {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;
  protected abstract readonly protocol: Protocol;

  /**
   * Creates a new PoolDiscoveryService instance
   *
   * @param dependencies - Optional dependencies object
   */
  constructor(dependencies: PoolDiscoveryServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger(this.constructor.name);
    this.logger.info('PoolDiscoveryService initialized');
  }

  /**
   * Get the Prisma client instance
   *
   * Protected accessor for use by subclasses.
   * Ensures consistent access to the Prisma client across all pool discovery services.
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  // ============================================================================
  // ABSTRACT METHODS
  // Protocol implementations MUST implement these methods
  // ============================================================================

  /**
   * Find all pools for a token pair
   *
   * Protocol implementations must:
   * 1. Query factory/program for all available fee tiers
   * 2. Fetch pool state for existing pools
   * 3. Create/update pools in database via PoolService
   * 4. Enrich with subgraph/indexer metrics (tvlUSD, volumeUSD, feesUSD)
   * 5. Generate protocol-specific pool names
   * 6. Return sorted results (by TVL descending)
   *
   * Error Handling Requirements:
   * - MUST fail if subgraph/indexer returns errors (not just unavailable)
   * - MAY return default "0" values if subgraph/indexer is unavailable (network issues)
   * - MUST validate input parameters (addresses, chain IDs)
   * - MUST handle non-existent pools gracefully (return empty array or skip)
   *
   * @param input - Discovery parameters (protocol-specific)
   * @returns Array of pool discovery results, sorted by TVL descending
   * @throws Error if subgraph/indexer query fails with errors
   * @throws Error if input validation fails
   * @throws Error if on-chain queries fail
   *
   * @example
   * ```typescript
   * // Uniswap V3 implementation
   * const results = await service.findPoolsForTokenPair({
   *   chainId: 1,
   *   tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
   *   tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
   * });
   *
   * // Results sorted by TVL descending:
   * // [
   * //   { poolName: "CL60-WETH/USDC", fee: 3000, tvlUSD: "234M", ... },
   * //   { poolName: "CL10-WETH/USDC", fee: 500, tvlUSD: "123M", ... },
   * //   { poolName: "CL1-WETH/USDC", fee: 100, tvlUSD: "45M", ... }
   * // ]
   * ```
   */
  abstract findPoolsForTokenPair(
    input: PoolDiscoveryInput
  ): Promise<PoolDiscoveryResult[]>;

  /**
   * Create protocol-specific pool name
   *
   * Generates a human-readable pool name for display in UI.
   * Format varies by protocol to reflect protocol-specific parameters.
   *
   * Format examples:
   * - Uniswap V3: "CL10-WETH/USDC" (CL = Concentrated Liquidity, 10 = tick spacing)
   * - Orca: "WHIRLPOOL-SOL/USDC"
   * - Raydium: "CLMM-SOL/USDC"
   *
   * @param pool - Pool object with tokens and configuration
   * @returns Human-readable pool name
   *
   * @example
   * ```typescript
   * // Uniswap V3
   * createPoolName(pool) {
   *   const tickSpacing = pool.tickSpacing;
   *   return `CL${tickSpacing}-${pool.token0.symbol}/${pool.token1.symbol}`;
   * }
   * // Returns: "CL10-WETH/USDC", "CL60-DAI/USDC", etc.
   * ```
   */
  abstract createPoolName(pool: PoolInterface): string;
}
