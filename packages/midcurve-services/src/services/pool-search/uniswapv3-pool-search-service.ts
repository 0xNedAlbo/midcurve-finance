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

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { PoolMetricsBlock } from '@midcurve/api-shared';
import { isAddress, getAddress } from 'viem';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { UniswapV3SubgraphClient } from '../../clients/subgraph/uniswapv3/index.js';
import type { PoolSearchSubgraphResult } from '../../clients/subgraph/uniswapv3/index.js';
import { CoingeckoTokenService } from '../coingecko-token/index.js';
import { EvmConfig } from '../../config/evm.js';
import { PoolSigmaFilterService } from '../volatility/index.js';
import type { PoolSigmaDescriptor, PoolSigmaResult } from '../volatility/index.js';
import type { UniswapV3PoolSearchInput, ResolvedTokenAddress } from '../types/pool-search/index.js';

/**
 * Pool search result.
 *
 * Same shape as `PoolSearchResultItem` from `@midcurve/api-shared` (minus the
 * route-only `isFavorite` flag) — metrics are nested under a single
 * `PoolMetricsBlock` containing TVL/volume/fees alongside σ-filter verdict.
 */
export interface PoolSearchResult {
  /** Pool contract address (EIP-55 checksummed). */
  poolAddress: string;
  /** Chain ID. */
  chainId: number;
  /** Human-readable chain name (e.g., "Ethereum", "Arbitrum One"). */
  chainName: string;
  /** Fee tier in basis points. */
  feeTier: number;
  /** Token0 information. */
  token0: PoolSearchSubgraphResult['token0'];
  /** Token1 information. */
  token1: PoolSearchSubgraphResult['token1'];
  /** Pool metrics — TVL, volume, fees, fee-APR, volatility, σ-filter verdict. */
  metrics: PoolMetricsBlock;
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
  /** σ-filter enrichment service */
  poolSigmaFilterService?: PoolSigmaFilterService;
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
  private readonly poolSigmaFilterService: PoolSigmaFilterService;
  private readonly logger: ServiceLogger;

  constructor(dependencies: UniswapV3PoolSearchServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.subgraphClient = dependencies.subgraphClient ?? UniswapV3SubgraphClient.getInstance();
    this.coingeckoTokenService = dependencies.coingeckoTokenService ?? new CoingeckoTokenService({ prisma: this.prisma });
    this.evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this.poolSigmaFilterService = dependencies.poolSigmaFilterService ?? PoolSigmaFilterService.getInstance();
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

      // Validate subgraph factory before querying
      const isValidFactory = await this.subgraphClient.validateSubgraphFactory(chainId);
      if (!isValidFactory) {
        this.logger.warn(
          { chainId },
          'Skipping chain - subgraph factory mismatch'
        );
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

    // Step 3: Merge and attach chain name. Track each pool's chainName for
    // later assembly; sigma enrichment runs over the dedup'd list.
    interface PendingResult {
      subgraph: PoolSearchSubgraphResult;
      chainName: string;
    }
    const allPending: PendingResult[] = [];
    for (let i = 0; i < input.chainIds.length; i++) {
      const chainId = input.chainIds[i]!;
      const pools = chainResults[i] ?? [];

      let chainName = 'Unknown';
      try {
        const config = this.evmConfig.getChainConfig(chainId);
        chainName = config.name;
      } catch {
        chainName = `Chain ${chainId}`;
      }

      for (const pool of pools) {
        allPending.push({ subgraph: pool, chainName });
      }
    }

    // Step 4: Deduplicate (same pool might match multiple token combinations)
    const seen = new Set<string>();
    const uniquePending = allPending.filter(({ subgraph }) => {
      const key = `${subgraph.chainId}:${subgraph.poolAddress}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Step 5: σ-filter enrichment (PRD §3.2-§3.4). Token dedup (PRD §6.3)
    // happens inside enrichPools. Failure is non-fatal — the result map will
    // simply be empty, and per-pool buildPoolMetricsBlock falls back to
    // INSUFFICIENT_DATA defaults.
    let sigmaResults = new Map<string, PoolSigmaResult>();
    if (uniquePending.length > 0) {
      const descriptors: PoolSigmaDescriptor[] = uniquePending.map(({ subgraph }) => ({
        poolHash: `uniswapv3/${subgraph.chainId}/${subgraph.poolAddress}`,
        token0Hash: `erc20/${subgraph.chainId}/${subgraph.token0.address}`,
        token1Hash: `erc20/${subgraph.chainId}/${subgraph.token1.address}`,
        tvlUSD: subgraph.tvlUSD,
        fees24hUSD: subgraph.fees24hUSD,
        fees7dAvgUSD: subgraph.fees7dAvgUSD,
      }));
      try {
        sigmaResults = await this.poolSigmaFilterService.enrichPools(descriptors);
      } catch (error) {
        this.logger.warn({ error }, 'Sigma-filter enrichment failed; returning results without sigma data');
      }
    }

    const uniquePools: PoolSearchResult[] = uniquePending.map(({ subgraph, chainName }) =>
      this.assembleResult(subgraph, chainName, sigmaResults),
    );

    // Step 6: Sort
    const sortedPools = this.sortPools(uniquePools, sortBy, sortDirection);

    // Step 7: Apply limit
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
   * Assemble a PoolSearchResult from raw subgraph data + (optional) σ-filter
   * result. Lives as a private helper so the same logic is reused if other
   * batch paths are added in the future.
   */
  private assembleResult(
    subgraph: PoolSearchSubgraphResult,
    chainName: string,
    sigmaResults: ReadonlyMap<string, PoolSigmaResult>,
  ): PoolSearchResult {
    const poolHash = `uniswapv3/${subgraph.chainId}/${subgraph.poolAddress}`;
    const sigma = sigmaResults.get(poolHash);

    const metrics: PoolMetricsBlock = sigma
      ? {
          tvlUSD: subgraph.tvlUSD,
          volume24hUSD: subgraph.volume24hUSD,
          fees24hUSD: subgraph.fees24hUSD,
          fees7dUSD: subgraph.fees7dUSD,
          volume7dAvgUSD: subgraph.volume7dAvgUSD,
          fees7dAvgUSD: subgraph.fees7dAvgUSD,
          apr7d: subgraph.apr7d,
          feeApr24h: sigma.feeApr24h,
          feeApr7dAvg: sigma.feeApr7dAvg,
          feeAprPrimary: sigma.feeAprPrimary,
          feeAprSource: sigma.feeAprSource,
          volatility: sigma.volatility,
          sigmaFilter: sigma.sigmaFilter,
        }
      : {
          tvlUSD: subgraph.tvlUSD,
          volume24hUSD: subgraph.volume24hUSD,
          fees24hUSD: subgraph.fees24hUSD,
          fees7dUSD: subgraph.fees7dUSD,
          volume7dAvgUSD: subgraph.volume7dAvgUSD,
          fees7dAvgUSD: subgraph.fees7dAvgUSD,
          apr7d: subgraph.apr7d,
          feeApr24h: null,
          feeApr7dAvg: null,
          feeAprPrimary: null,
          feeAprSource: 'unavailable',
          volatility: {
            token0: { ref: '', sigma60d: { status: 'insufficient_history' }, sigma365d: { status: 'insufficient_history' } },
            token1: { ref: '', sigma60d: { status: 'insufficient_history' }, sigma365d: { status: 'insufficient_history' } },
            pair: { sigma60d: { status: 'insufficient_history' }, sigma365d: { status: 'insufficient_history' } },
            velocity: null,
            pivotCurrency: 'usd',
            computedAt: new Date(0).toISOString(),
          },
          sigmaFilter: {
            feeApr: null,
            sigmaSqOver8_365d: null,
            sigmaSqOver8_60d: null,
            marginLongTerm: null,
            marginShortTerm: null,
            verdictLongTerm: 'INSUFFICIENT_DATA',
            verdictShortTerm: 'INSUFFICIENT_DATA',
            verdictAgreement: 'INSUFFICIENT_DATA',
          },
        };

    return {
      poolAddress: subgraph.poolAddress,
      chainId: subgraph.chainId,
      chainName,
      feeTier: subgraph.feeTier,
      token0: subgraph.token0,
      token1: subgraph.token1,
      metrics,
    };
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
    sortBy:
      | 'tvlUSD'
      | 'volume24hUSD'
      | 'fees24hUSD'
      | 'volume7dAvgUSD'
      | 'fees7dAvgUSD'
      | 'apr7d',
    sortDirection: 'asc' | 'desc'
  ): PoolSearchResult[] {
    const multiplier = sortDirection === 'desc' ? -1 : 1;

    return pools.sort((a, b) => {
      let valueA: number;
      let valueB: number;

      switch (sortBy) {
        case 'tvlUSD':
          valueA = parseFloat(a.metrics.tvlUSD);
          valueB = parseFloat(b.metrics.tvlUSD);
          break;
        case 'volume24hUSD':
          valueA = parseFloat(a.metrics.volume24hUSD);
          valueB = parseFloat(b.metrics.volume24hUSD);
          break;
        case 'fees24hUSD':
          valueA = parseFloat(a.metrics.fees24hUSD);
          valueB = parseFloat(b.metrics.fees24hUSD);
          break;
        case 'volume7dAvgUSD':
          valueA = parseFloat(a.metrics.volume7dAvgUSD);
          valueB = parseFloat(b.metrics.volume7dAvgUSD);
          break;
        case 'fees7dAvgUSD':
          valueA = parseFloat(a.metrics.fees7dAvgUSD);
          valueB = parseFloat(b.metrics.fees7dAvgUSD);
          break;
        case 'apr7d':
          valueA = a.metrics.apr7d;
          valueB = b.metrics.apr7d;
          break;
        default:
          valueA = parseFloat(a.metrics.tvlUSD);
          valueB = parseFloat(b.metrics.tvlUSD);
      }

      return (valueA - valueB) * multiplier;
    });
  }
}
