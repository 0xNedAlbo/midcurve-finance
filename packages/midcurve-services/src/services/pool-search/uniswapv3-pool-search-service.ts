/**
 * Uniswap V3 Pool Search Service
 *
 * Searches for Uniswap V3 pools by token sets across multiple chains.
 * Combines token resolution (via CoingeckoTokenService) with pool discovery
 * (via UniswapV3SubgraphClient) to find pools matching user criteria.
 *
 * Features:
 * - Search by token symbols or addresses
 * - Multi-chain search (parallel queries)
 * - 7-day average APR calculation
 * - Sorting and limiting results
 *
 * @example
 * ```typescript
 * const service = new UniswapV3PoolSearchService();
 * const results = await service.searchPools({
 *   tokenSetA: ['WETH', 'stETH'],
 *   tokenSetB: ['USDC', 'USDT'],
 *   chainIds: [1, 42161],
 *   sortBy: 'apr7d',
 *   limit: 20,
 * });
 * ```
 */

import { PrismaClient } from '@midcurve/database';
import { isAddress, getAddress } from 'viem';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { UniswapV3SubgraphClient } from '../../clients/subgraph/uniswapv3/index.js';
import type { PoolSearchSubgraphResult } from '../../clients/subgraph/uniswapv3/index.js';
import { CoingeckoTokenService } from '../coingecko-token/index.js';
import { EvmConfig } from '../../config/evm.js';
import type { UniswapV3PoolSearchInput, ResolvedTokenAddress } from '../types/pool-search/index.js';

/**
 * Pool search result with chain name
 *
 * Extends the subgraph result with human-readable chain name.
 */
export interface PoolSearchResult extends PoolSearchSubgraphResult {
  /** Human-readable chain name (e.g., "Ethereum", "Arbitrum One") */
  chainName: string;
}

/**
 * Dependencies for UniswapV3PoolSearchService
 */
export interface UniswapV3PoolSearchServiceDependencies {
  /** Prisma client for database operations */
  prisma?: PrismaClient;
  /** Subgraph client for pool queries */
  subgraphClient?: UniswapV3SubgraphClient;
  /** CoinGecko token service for symbol resolution */
  coingeckoTokenService?: CoingeckoTokenService;
  /** EVM configuration for chain metadata */
  evmConfig?: EvmConfig;
}

/**
 * Uniswap V3 Pool Search Service
 *
 * Searches for pools by token sets across multiple chains.
 */
export class UniswapV3PoolSearchService {
  private readonly prisma: PrismaClient;
  private readonly subgraphClient: UniswapV3SubgraphClient;
  private readonly coingeckoTokenService: CoingeckoTokenService;
  private readonly evmConfig: EvmConfig;
  private readonly logger: ServiceLogger;

  constructor(dependencies: UniswapV3PoolSearchServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.subgraphClient = dependencies.subgraphClient ?? UniswapV3SubgraphClient.getInstance();
    this.coingeckoTokenService = dependencies.coingeckoTokenService ?? new CoingeckoTokenService({ prisma: this.prisma });
    this.evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this.logger = createServiceLogger('UniswapV3PoolSearchService');
  }

  /**
   * Search for pools matching the given token sets
   *
   * @param input - Search parameters
   * @returns Array of matching pools sorted by the specified field
   */
  async searchPools(input: UniswapV3PoolSearchInput): Promise<PoolSearchResult[]> {
    log.methodEntry(this.logger, 'searchPools', {
      tokenSetA: input.tokenSetA,
      tokenSetB: input.tokenSetB,
      chainIds: input.chainIds,
      sortBy: input.sortBy,
      limit: input.limit,
    });

    const sortBy = input.sortBy ?? 'tvlUSD';
    const sortDirection = input.sortDirection ?? 'desc';
    const limit = Math.min(input.limit ?? 20, 100);

    // Validate inputs
    if (input.tokenSetA.length === 0 || input.tokenSetB.length === 0) {
      this.logger.warn('Empty token set provided, returning empty results');
      log.methodExit(this.logger, 'searchPools', { reason: 'empty_input' });
      return [];
    }

    if (input.chainIds.length === 0) {
      this.logger.warn('No chain IDs provided, returning empty results');
      log.methodExit(this.logger, 'searchPools', { reason: 'no_chains' });
      return [];
    }

    // Step 1: Resolve token symbols to addresses for each chain
    const resolvedTokensA = await this.resolveTokens(input.tokenSetA, input.chainIds);
    const resolvedTokensB = await this.resolveTokens(input.tokenSetB, input.chainIds);

    this.logger.debug(
      {
        resolvedTokensA: resolvedTokensA.length,
        resolvedTokensB: resolvedTokensB.length,
      },
      'Tokens resolved'
    );

    // Group resolved tokens by chain
    const tokensByChain = this.groupTokensByChain(resolvedTokensA, resolvedTokensB);

    // Step 2: Query each chain in parallel
    const chainQueries = input.chainIds.map(async (chainId) => {
      const chainTokens = tokensByChain.get(chainId);
      if (!chainTokens || chainTokens.setA.length === 0 || chainTokens.setB.length === 0) {
        this.logger.debug({ chainId }, 'No tokens for chain, skipping');
        return [];
      }

      try {
        return await this.subgraphClient.searchPoolsByTokenSets(
          chainId,
          chainTokens.setA,
          chainTokens.setB
        );
      } catch (error) {
        this.logger.error(
          { chainId, error },
          'Failed to query chain, skipping'
        );
        return [];
      }
    });

    const chainResults = await Promise.all(chainQueries);

    // Step 3: Merge and add chain names
    const allPools: PoolSearchResult[] = [];
    for (let i = 0; i < input.chainIds.length; i++) {
      const chainId = input.chainIds[i]!;
      const pools = chainResults[i] ?? [];

      // Get chain name
      let chainName = 'Unknown';
      try {
        const config = this.evmConfig.getChainConfig(chainId);
        chainName = config.name;
      } catch {
        // Chain not configured, use default
        chainName = `Chain ${chainId}`;
      }

      for (const pool of pools) {
        allPools.push({
          ...pool,
          chainName,
        });
      }
    }

    // Step 4: Deduplicate (same pool might match multiple token combinations)
    const seen = new Set<string>();
    const uniquePools = allPools.filter((pool) => {
      const key = `${pool.chainId}:${pool.poolAddress}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    // Step 5: Sort
    const sortedPools = this.sortPools(uniquePools, sortBy, sortDirection);

    // Step 6: Apply limit
    const limitedPools = sortedPools.slice(0, limit);

    this.logger.info(
      {
        totalFound: uniquePools.length,
        returned: limitedPools.length,
        sortBy,
        sortDirection,
      },
      'Pool search completed'
    );

    log.methodExit(this.logger, 'searchPools', { count: limitedPools.length });
    return limitedPools;
  }

  /**
   * Resolve token symbols to addresses
   *
   * If input is already an address, normalizes it.
   * If input is a symbol, looks it up in CoingeckoTokenService.
   *
   * @param tokens - Array of token symbols or addresses
   * @param chainIds - Chain IDs to resolve for
   * @returns Array of resolved token addresses
   */
  private async resolveTokens(
    tokens: string[],
    chainIds: number[]
  ): Promise<ResolvedTokenAddress[]> {
    const results: ResolvedTokenAddress[] = [];

    for (const token of tokens) {
      // Check if it's an address
      if (isAddress(token)) {
        // It's an address - normalize and add for all chains
        const normalizedAddress = getAddress(token);
        for (const chainId of chainIds) {
          results.push({
            input: token,
            chainId,
            address: normalizedAddress,
            symbol: token.slice(0, 8) + '...', // Placeholder symbol
          });
        }
      } else {
        // It's a symbol - look up in CoinGecko token table
        try {
          const tokenSymbols = await this.coingeckoTokenService.searchByTextAndChains(
            token,
            chainIds,
            50 // Get up to 50 matches
          );

          // Filter for exact symbol matches (case-insensitive)
          const exactMatches = tokenSymbols.filter(
            (t) => t.symbol.toUpperCase() === token.toUpperCase()
          );

          // Each TokenSymbolResult has an addresses array with chainId and address
          for (const tokenSymbol of exactMatches) {
            for (const addr of tokenSymbol.addresses) {
              results.push({
                input: token,
                chainId: addr.chainId,
                address: addr.address,
                symbol: tokenSymbol.symbol,
              });
            }
          }

          if (exactMatches.length === 0) {
            this.logger.debug(
              { symbol: token, chainIds },
              'No exact symbol match found'
            );
          }
        } catch (error) {
          this.logger.warn(
            { symbol: token, error },
            'Failed to resolve token symbol'
          );
        }
      }
    }

    return results;
  }

  /**
   * Group resolved tokens by chain ID
   */
  private groupTokensByChain(
    tokensA: ResolvedTokenAddress[],
    tokensB: ResolvedTokenAddress[]
  ): Map<number, { setA: string[]; setB: string[] }> {
    const result = new Map<number, { setA: string[]; setB: string[] }>();

    // Group setA by chain
    for (const token of tokensA) {
      let entry = result.get(token.chainId);
      if (!entry) {
        entry = { setA: [], setB: [] };
        result.set(token.chainId, entry);
      }
      // Add lowercase address (subgraph uses lowercase)
      if (!entry.setA.includes(token.address.toLowerCase())) {
        entry.setA.push(token.address.toLowerCase());
      }
    }

    // Group setB by chain
    for (const token of tokensB) {
      let entry = result.get(token.chainId);
      if (!entry) {
        entry = { setA: [], setB: [] };
        result.set(token.chainId, entry);
      }
      // Add lowercase address (subgraph uses lowercase)
      if (!entry.setB.includes(token.address.toLowerCase())) {
        entry.setB.push(token.address.toLowerCase());
      }
    }

    return result;
  }

  /**
   * Sort pools by the specified field
   */
  private sortPools(
    pools: PoolSearchResult[],
    sortBy: 'tvlUSD' | 'volume24hUSD' | 'fees24hUSD' | 'apr7d',
    sortDirection: 'asc' | 'desc'
  ): PoolSearchResult[] {
    const multiplier = sortDirection === 'desc' ? -1 : 1;

    return pools.sort((a, b) => {
      let valueA: number;
      let valueB: number;

      switch (sortBy) {
        case 'tvlUSD':
          valueA = parseFloat(a.tvlUSD);
          valueB = parseFloat(b.tvlUSD);
          break;
        case 'volume24hUSD':
          valueA = parseFloat(a.volume24hUSD);
          valueB = parseFloat(b.volume24hUSD);
          break;
        case 'fees24hUSD':
          valueA = parseFloat(a.fees24hUSD);
          valueB = parseFloat(b.fees24hUSD);
          break;
        case 'apr7d':
          valueA = a.apr7d;
          valueB = b.apr7d;
          break;
        default:
          valueA = parseFloat(a.tvlUSD);
          valueB = parseFloat(b.tvlUSD);
      }

      return (valueA - valueB) * multiplier;
    });
  }
}
