/**
 * CoingeckoTokenService
 *
 * Manages the CoingeckoToken lookup table for mapping ERC-20 addresses to CoinGecko IDs.
 * This is a separate lookup service, NOT part of the Token entity.
 *
 * Features:
 * - Fetch token mappings from CoinGecko API
 * - Persist mappings to database
 * - Query by chain/address or coingeckoId
 * - Search by partial coingeckoId
 *
 * Use Cases:
 * - Token enrichment (find CoinGecko ID for price discovery)
 * - Pool discovery (identify tokens in pools)
 * - Token search (find tokens by CoinGecko ID)
 */

import { PrismaClient } from '@midcurve/database';
import {
  CoingeckoToken,
  CoingeckoTokenConfig,
  type CoingeckoTokenRow,
} from '@midcurve/shared';
import type { TokenSymbolResult } from '@midcurve/api-shared';
import { CoinGeckoClient } from '../../clients/coingecko/index.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { isAddress, getAddress } from 'viem';

// Supported chain IDs (same as CoinGeckoClient)
const SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 56, 137, 10] as const;
type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

// Chain ID to CoinGecko platform ID mapping
const CHAIN_TO_PLATFORM: Record<SupportedChainId, string> = {
  1: 'ethereum',
  42161: 'arbitrum-one',
  8453: 'base',
  56: 'binance-smart-chain',
  137: 'polygon-pos',
  10: 'optimistic-ethereum',
};

/**
 * Token mapping from CoinGecko API
 */
export interface CoingeckoTokenMapping {
  coingeckoId: string;
  name: string;
  symbol: string;
  chainId: number;
  tokenAddress: string;
}

export interface CoingeckoTokenServiceDependencies {
  prisma?: PrismaClient;
  coinGeckoClient?: CoinGeckoClient;
}

/**
 * CoingeckoTokenService
 *
 * Manages the CoingeckoToken lookup table for token enrichment and discovery.
 */
export class CoingeckoTokenService {
  private readonly prisma: PrismaClient;
  private readonly coinGeckoClient: CoinGeckoClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: CoingeckoTokenServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.coinGeckoClient =
      dependencies.coinGeckoClient ?? CoinGeckoClient.getInstance();
    this.logger = createServiceLogger('CoingeckoTokenService');
  }

  // ============================================================================
  // FETCH OPERATIONS (Read from CoinGecko)
  // ============================================================================

  /**
   * Fetch all token mappings from CoinGecko API
   *
   * Uses the cached token list from CoinGeckoClient (1-hour TTL).
   * Returns mappings for all supported chains where the token has an address.
   *
   * @returns Array of token mappings (coingeckoId, chainId, tokenAddress)
   */
  async fetchAll(): Promise<CoingeckoTokenMapping[]> {
    log.methodEntry(this.logger, 'fetchAll');

    const tokens = await this.coinGeckoClient.getAllTokens();
    const results: CoingeckoTokenMapping[] = [];

    for (const token of tokens) {
      for (const chainId of SUPPORTED_CHAIN_IDS) {
        const platformId = CHAIN_TO_PLATFORM[chainId];
        const address = token.platforms[platformId];

        if (address && address.trim() !== '' && isAddress(address)) {
          // Normalize address to EIP-55 checksum format
          let normalizedAddress: string;
          try {
            normalizedAddress = getAddress(address);
          } catch {
            // Skip invalid addresses
            this.logger.warn(
              { coingeckoId: token.id, chainId, address },
              'Skipping invalid address from CoinGecko'
            );
            continue;
          }

          results.push({
            coingeckoId: token.id,
            name: token.name,
            symbol: token.symbol.toUpperCase(),
            chainId,
            tokenAddress: normalizedAddress,
          });
        }
      }
    }

    this.logger.info(
      { totalTokens: tokens.length, mappingsCount: results.length },
      'Fetched token mappings from CoinGecko'
    );

    log.methodExit(this.logger, 'fetchAll', { count: results.length });
    return results;
  }

  // ============================================================================
  // UPDATE OPERATIONS (Persist to database)
  // ============================================================================

  /**
   * Update the database with fetched token mappings
   *
   * Uses upsert for efficient updates - creates new records or updates existing.
   * Processes in batches to avoid overwhelming the database.
   *
   * @param mappings - Array of token mappings to persist
   * @returns Number of records upserted
   */
  async update(mappings: CoingeckoTokenMapping[]): Promise<number> {
    log.methodEntry(this.logger, 'update', { count: mappings.length });

    let upsertedCount = 0;

    // Process in batches to avoid overwhelming the database
    const BATCH_SIZE = 100;
    for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
      const batch = mappings.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (mapping) => {
          const id = CoingeckoToken.createId(
            mapping.chainId,
            mapping.tokenAddress
          );
          const config = new CoingeckoTokenConfig({
            chainId: mapping.chainId,
            tokenAddress: mapping.tokenAddress,
          });

          await this.prisma.coingeckoToken.upsert({
            where: { id },
            create: {
              id,
              coingeckoId: mapping.coingeckoId,
              name: mapping.name,
              symbol: mapping.symbol,
              config: config.toJSON() as object,
            },
            update: {
              coingeckoId: mapping.coingeckoId,
              name: mapping.name,
              symbol: mapping.symbol,
              config: config.toJSON() as object,
            },
          });
          upsertedCount++;
        })
      );

      this.logger.debug(
        {
          processed: Math.min(i + BATCH_SIZE, mappings.length),
          total: mappings.length,
        },
        'Processing batch'
      );
    }

    this.logger.info(
      { upsertedCount },
      'Database updated with CoinGecko mappings'
    );
    log.methodExit(this.logger, 'update', { upsertedCount });
    return upsertedCount;
  }

  // ============================================================================
  // REFRESH OPERATIONS (Fetch + Update combined)
  // ============================================================================

  /**
   * Refresh the entire CoingeckoToken table
   *
   * Fetches from CoinGecko and updates the database.
   * Uses cached data from CoinGeckoClient (1-hour TTL).
   *
   * @returns Object with added count and total mappings
   */
  async refresh(): Promise<{ added: number; total: number }> {
    log.methodEntry(this.logger, 'refresh');

    const mappings = await this.fetchAll();
    const upsertedCount = await this.update(mappings);

    const result = { added: upsertedCount, total: mappings.length };
    this.logger.info(result, 'Refresh completed');
    log.methodExit(this.logger, 'refresh', result);
    return result;
  }

  /**
   * Refresh token details (imageUrl, marketCapUsd) for unenriched tokens
   *
   * Finds tokens where enrichedAt is null or older than 24 hours,
   * fetches market data from CoinGecko, and updates the database.
   *
   * @param limit - Maximum tokens to process (default: 100)
   * @returns Number of tokens updated
   */
  async refreshTokenDetails(limit: number = 100): Promise<number> {
    log.methodEntry(this.logger, 'refreshTokenDetails', { limit });

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Step 1: Find unenriched tokens
    // Where enrichedAt IS NULL OR enrichedAt < 24 hours ago
    // Order by enrichedAt ASC (NULL first in PostgreSQL)
    const tokensToEnrich = await this.prisma.coingeckoToken.findMany({
      where: {
        OR: [{ enrichedAt: null }, { enrichedAt: { lt: twentyFourHoursAgo } }],
      },
      take: limit,
      orderBy: [
        // NULL values first (never enriched), then oldest enrichedAt
        { enrichedAt: 'asc' },
      ],
    });

    if (tokensToEnrich.length === 0) {
      this.logger.info('No tokens need enrichment');
      log.methodExit(this.logger, 'refreshTokenDetails', { updated: 0 });
      return 0;
    }

    this.logger.info(
      { count: tokensToEnrich.length },
      'Found tokens needing enrichment'
    );

    // Step 2: Extract unique coingeckoIds (multiple rows may share same coingeckoId)
    const coingeckoIds = [...new Set(tokensToEnrich.map((t) => t.coingeckoId))];

    this.logger.debug(
      { uniqueCoingeckoIds: coingeckoIds.length },
      'Unique CoinGecko IDs to fetch'
    );

    // Step 3: Fetch market data from CoinGecko (single batch API call)
    const marketData =
      await this.coinGeckoClient.getCoinsMarketData(coingeckoIds);

    // Create lookup map for O(1) access
    const marketDataMap = new Map(marketData.map((m) => [m.id, m]));

    this.logger.debug(
      { received: marketData.length, expected: coingeckoIds.length },
      'Market data received'
    );

    // Step 4: Update tokens in database
    let updatedCount = 0;
    const now = new Date();

    for (const token of tokensToEnrich) {
      const data = marketDataMap.get(token.coingeckoId);

      if (data) {
        // Token found in market data - update with enrichment
        await this.prisma.coingeckoToken.update({
          where: { id: token.id },
          data: {
            imageUrl: data.image,
            marketCapUsd: data.market_cap,
            enrichedAt: now,
          },
        });
        updatedCount++;
      } else {
        // Token not found in market data - mark as enriched anyway
        // to avoid re-fetching tokens that CoinGecko doesn't have market data for
        this.logger.warn(
          { coingeckoId: token.coingeckoId, tokenId: token.id },
          'Token not found in CoinGecko market data'
        );
        await this.prisma.coingeckoToken.update({
          where: { id: token.id },
          data: {
            enrichedAt: now,
            // Leave imageUrl and marketCapUsd as null
          },
        });
        updatedCount++;
      }
    }

    this.logger.info(
      { updated: updatedCount, total: tokensToEnrich.length },
      'Token enrichment completed'
    );

    log.methodExit(this.logger, 'refreshTokenDetails', { updated: updatedCount });
    return updatedCount;
  }

  // ============================================================================
  // QUERY OPERATIONS
  // ============================================================================

  /**
   * Find CoinGecko token by chain and address
   *
   * @param chainId - Chain ID (1, 42161, 8453, 56, 137, 10)
   * @param tokenAddress - Token contract address (case-insensitive)
   * @returns CoingeckoToken if found, null otherwise
   */
  async findByChainAndAddress(
    chainId: number,
    tokenAddress: string
  ): Promise<CoingeckoToken | null> {
    log.methodEntry(this.logger, 'findByChainAndAddress', {
      chainId,
      tokenAddress,
    });

    if (!isAddress(tokenAddress)) {
      this.logger.warn(
        { chainId, tokenAddress },
        'Invalid address format'
      );
      log.methodExit(this.logger, 'findByChainAndAddress', { found: false });
      return null;
    }

    // Normalize address for lookup
    let normalizedAddress: string;
    try {
      normalizedAddress = getAddress(tokenAddress);
    } catch {
      log.methodExit(this.logger, 'findByChainAndAddress', { found: false });
      return null;
    }

    const id = CoingeckoToken.createId(chainId, normalizedAddress);

    const result = await this.prisma.coingeckoToken.findUnique({
      where: { id },
    });

    if (!result) {
      log.methodExit(this.logger, 'findByChainAndAddress', { found: false });
      return null;
    }

    const token = CoingeckoToken.fromDB(result as unknown as CoingeckoTokenRow);
    log.methodExit(this.logger, 'findByChainAndAddress', {
      found: true,
      coingeckoId: token.coingeckoId,
    });
    return token;
  }

  /**
   * Search for a token by address across multiple chains
   *
   * Performs parallel lookups across all specified chains to find tokens
   * with the given address. Uses the CoingeckoToken lookup table.
   *
   * @param address - Token contract address (will be normalized)
   * @param chainIds - Optional chain IDs to search (defaults to all supported)
   * @returns Array of tokens found (one per chain where token exists)
   */
  async searchByAddressAcrossChains(
    address: string,
    chainIds?: number[]
  ): Promise<CoingeckoToken[]> {
    log.methodEntry(this.logger, 'searchByAddressAcrossChains', {
      address,
      chainIds,
    });

    // Validate address format
    if (!isAddress(address)) {
      this.logger.warn({ address }, 'Invalid address format');
      log.methodExit(this.logger, 'searchByAddressAcrossChains', { found: 0 });
      return [];
    }

    // Normalize address
    let normalizedAddress: string;
    try {
      normalizedAddress = getAddress(address);
    } catch {
      log.methodExit(this.logger, 'searchByAddressAcrossChains', { found: 0 });
      return [];
    }

    const chainsToSearch = chainIds ?? [...SUPPORTED_CHAIN_IDS];

    // Parallel search across all chains using existing findByChainAndAddress
    const results = await Promise.all(
      chainsToSearch.map((chainId) =>
        this.findByChainAndAddress(chainId, normalizedAddress)
      )
    );

    // Filter out nulls (chains where address wasn't found)
    const foundTokens = results.filter(
      (t): t is CoingeckoToken => t !== null
    );

    this.logger.info(
      {
        address: normalizedAddress.slice(0, 10) + '...',
        chainsSearched: chainsToSearch.length,
        found: foundTokens.length,
      },
      'Address search completed'
    );

    log.methodExit(this.logger, 'searchByAddressAcrossChains', {
      found: foundTokens.length,
      chains: foundTokens.map((t) => t.config.chainId),
    });

    return foundTokens;
  }

  /**
   * Find all addresses for a given CoinGecko ID
   *
   * Returns all chain+address mappings for a single CoinGecko token.
   * Useful for finding the same token across multiple chains.
   *
   * @param coingeckoId - CoinGecko coin ID (e.g., 'usd-coin')
   * @returns Array of CoingeckoToken entries
   */
  async findByCoingeckoId(coingeckoId: string): Promise<CoingeckoToken[]> {
    log.methodEntry(this.logger, 'findByCoingeckoId', { coingeckoId });

    const results = await this.prisma.coingeckoToken.findMany({
      where: { coingeckoId },
    });

    const tokens = results.map((row) =>
      CoingeckoToken.fromDB(row as unknown as CoingeckoTokenRow)
    );
    log.methodExit(this.logger, 'findByCoingeckoId', { count: tokens.length });
    return tokens;
  }

  /**
   * Search for tokens by partial CoinGecko ID match
   *
   * Performs case-insensitive substring matching on coingeckoId.
   *
   * @param query - Search query (partial coingeckoId)
   * @param limit - Maximum results to return (default: 10)
   * @returns Array of matching CoingeckoToken entries
   */
  async search(query: string, limit: number = 10): Promise<CoingeckoToken[]> {
    log.methodEntry(this.logger, 'search', { query, limit });

    const results = await this.prisma.coingeckoToken.findMany({
      where: {
        coingeckoId: {
          contains: query.toLowerCase(),
          mode: 'insensitive',
        },
      },
      take: limit,
      orderBy: { coingeckoId: 'asc' },
    });

    const tokens = results.map((row) =>
      CoingeckoToken.fromDB(row as unknown as CoingeckoTokenRow)
    );
    log.methodExit(this.logger, 'search', { count: tokens.length });
    return tokens;
  }

  /**
   * Find tokens by symbol (partial match)
   *
   * Performs case-insensitive substring matching on symbol.
   *
   * @param symbol - Symbol to search for (partial match, e.g., 'USD' matches 'USDC', 'USDT')
   * @param limit - Maximum results to return (default: 10)
   * @returns Array of matching CoingeckoToken entries
   */
  async findBySymbol(
    symbol: string,
    limit: number = 10
  ): Promise<CoingeckoToken[]> {
    log.methodEntry(this.logger, 'findBySymbol', { symbol, limit });

    const results = await this.prisma.coingeckoToken.findMany({
      where: {
        symbol: {
          contains: symbol.toUpperCase(),
          mode: 'insensitive',
        },
      },
      take: limit,
      orderBy: { symbol: 'asc' },
    });

    const tokens = results.map((row) =>
      CoingeckoToken.fromDB(row as unknown as CoingeckoTokenRow)
    );
    log.methodExit(this.logger, 'findBySymbol', { count: tokens.length });
    return tokens;
  }

  /**
   * Find tokens by name (partial match)
   *
   * Performs case-insensitive substring matching on name.
   *
   * @param name - Name to search for (partial match, e.g., 'coin' matches 'USD Coin', 'Bitcoin')
   * @param limit - Maximum results to return (default: 10)
   * @returns Array of matching CoingeckoToken entries
   */
  async findByName(name: string, limit: number = 10): Promise<CoingeckoToken[]> {
    log.methodEntry(this.logger, 'findByName', { name, limit });

    const results = await this.prisma.coingeckoToken.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive',
        },
      },
      take: limit,
      orderBy: { name: 'asc' },
    });

    const tokens = results.map((row) =>
      CoingeckoToken.fromDB(row as unknown as CoingeckoTokenRow)
    );
    log.methodExit(this.logger, 'findByName', { count: tokens.length });
    return tokens;
  }

  /**
   * Search tokens by text (searches both name and symbol)
   *
   * Performs case-insensitive substring matching on both name and symbol fields.
   * Returns tokens where either field matches the query.
   *
   * @param query - Text to search for in name or symbol
   * @param limit - Maximum results to return (default: 10)
   * @returns Array of matching CoingeckoToken entries
   */
  async searchByText(
    query: string,
    limit: number = 10
  ): Promise<CoingeckoToken[]> {
    log.methodEntry(this.logger, 'searchByText', { query, limit });

    const results = await this.prisma.coingeckoToken.findMany({
      where: {
        OR: [
          {
            symbol: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            name: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
      },
      take: limit,
      orderBy: [{ symbol: 'asc' }, { name: 'asc' }],
    });

    const tokens = results.map((row) =>
      CoingeckoToken.fromDB(row as unknown as CoingeckoTokenRow)
    );
    log.methodExit(this.logger, 'searchByText', { count: tokens.length });
    return tokens;
  }

  /**
   * Search tokens by symbol and filter by chain IDs
   *
   * Performs case-insensitive substring matching on symbol field,
   * filtered to only include tokens on the specified chains.
   * Results are grouped by symbol with all addresses across chains.
   *
   * @param query - Text to search for in symbol (case-insensitive partial match)
   * @param chainIds - Array of chain IDs to filter by (e.g., [1, 42161])
   * @param limit - Maximum unique symbols to return (default: 10)
   * @returns Array of TokenSymbolResult entries grouped by symbol, sorted by market cap
   */
  async searchByTextAndChains(
    query: string,
    chainIds: number[],
    limit: number = 10
  ): Promise<TokenSymbolResult[]> {
    log.methodEntry(this.logger, 'searchByTextAndChains', {
      query,
      chainIds,
      limit,
    });

    if (chainIds.length === 0) {
      log.methodExit(this.logger, 'searchByTextAndChains', { count: 0 });
      return [];
    }

    // Raw SQL query that groups by symbol and aggregates addresses
    // Uses MAX for name, coingeckoId, imageUrl, marketCapUsd (picks one per symbol)
    // Uses JSON_AGG to collect all addresses per symbol
    // Sorts by MAX(marketCapUsd) descending (highest market cap first)
    const results = await this.prisma.$queryRaw<
      Array<{
        symbol: string;
        name: string;
        coingeckoId: string;
        logoUrl: string | null;
        marketCap: number | null;
        addresses: Array<{ chainId: number; address: string }>;
      }>
    >`
      SELECT
        symbol,
        MAX(name) as name,
        MAX("coingeckoId") as "coingeckoId",
        MAX("imageUrl") as "logoUrl",
        MAX("marketCapUsd") as "marketCap",
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'chainId', (config->>'chainId')::int,
            'address', config->>'tokenAddress'
          )
        ) as addresses
      FROM coingecko_tokens
      WHERE (config->>'chainId')::int = ANY(${chainIds})
        AND symbol ILIKE ${'%' + query + '%'}
      GROUP BY symbol
      ORDER BY MAX("marketCapUsd") DESC NULLS LAST
      LIMIT ${limit}
    `;

    // Map to TokenSymbolResult format
    const tokenSymbols: TokenSymbolResult[] = results.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      coingeckoId: row.coingeckoId,
      logoUrl: row.logoUrl ?? undefined,
      marketCap: row.marketCap ?? undefined,
      addresses: row.addresses,
    }));

    log.methodExit(this.logger, 'searchByTextAndChains', {
      count: tokenSymbols.length,
    });
    return tokenSymbols;
  }

  /**
   * Get statistics about the CoingeckoToken table
   *
   * @returns Object with total mappings, unique coingecko IDs, and chain distribution
   */
  async getStats(): Promise<{
    totalMappings: number;
    uniqueCoingeckoIds: number;
    chainDistribution: Record<number, number>;
  }> {
    log.methodEntry(this.logger, 'getStats');

    const [totalMappings, uniqueIds, chainCounts] = await Promise.all([
      this.prisma.coingeckoToken.count(),
      this.prisma.coingeckoToken.groupBy({
        by: ['coingeckoId'],
        _count: true,
      }),
      this.prisma.$queryRaw<Array<{ chainId: number; count: bigint }>>`
        SELECT (config->>'chainId')::int as "chainId", COUNT(*) as count
        FROM coingecko_tokens
        GROUP BY config->>'chainId'
      `,
    ]);

    const chainDistribution: Record<number, number> = {};
    for (const row of chainCounts) {
      chainDistribution[row.chainId] = Number(row.count);
    }

    const result = {
      totalMappings,
      uniqueCoingeckoIds: uniqueIds.length,
      chainDistribution,
    };

    log.methodExit(this.logger, 'getStats', result);
    return result;
  }

  /**
   * Upsert a single token's CoinGecko data
   *
   * Used by Erc20TokenService.discover() to cache enrichment data
   * after fetching from CoinGecko API. This enables data sharing
   * between the on-demand discovery flow and batch refresh flow.
   *
   * @param params - Token data to upsert
   * @param params.chainId - Chain ID where token exists
   * @param params.address - Token contract address (will be normalized)
   * @param params.coingeckoId - CoinGecko coin ID
   * @param params.symbol - Token symbol
   * @param params.name - Token name
   * @param params.logoUrl - Token logo URL from CoinGecko
   * @param params.marketCapUsd - Market cap in USD
   */
  async upsertToken(params: {
    chainId: number;
    address: string;
    coingeckoId: string;
    symbol: string;
    name: string;
    logoUrl: string | null;
    marketCapUsd: number | null;
  }): Promise<void> {
    const { chainId, address, coingeckoId, symbol, name, logoUrl, marketCapUsd } = params;
    log.methodEntry(this.logger, 'upsertToken', { chainId, address: address.slice(0, 10) + '...' });

    // Normalize address
    let normalizedAddress: string;
    try {
      normalizedAddress = getAddress(address);
    } catch {
      this.logger.warn({ chainId, address }, 'Invalid address format, skipping upsert');
      log.methodExit(this.logger, 'upsertToken', { success: false });
      return;
    }

    const id = CoingeckoToken.createId(chainId, normalizedAddress);
    const config = new CoingeckoTokenConfig({
      chainId,
      tokenAddress: normalizedAddress,
    });

    await this.prisma.coingeckoToken.upsert({
      where: { id },
      create: {
        id,
        coingeckoId,
        name,
        symbol: symbol.toUpperCase(),
        config: config.toJSON() as object,
        imageUrl: logoUrl,
        marketCapUsd: marketCapUsd,
        enrichedAt: new Date(),
      },
      update: {
        coingeckoId,
        name,
        symbol: symbol.toUpperCase(),
        imageUrl: logoUrl,
        marketCapUsd: marketCapUsd,
        enrichedAt: new Date(),
      },
    });

    this.logger.info(
      { chainId, address: normalizedAddress.slice(0, 10) + '...', coingeckoId },
      'Token upserted to coingecko_tokens cache'
    );
    log.methodExit(this.logger, 'upsertToken', { success: true });
  }

  /**
   * Delete all CoingeckoToken records
   *
   * Useful for testing or resetting the lookup table.
   *
   * @returns Number of deleted records
   */
  async deleteAll(): Promise<number> {
    log.methodEntry(this.logger, 'deleteAll');

    const result = await this.prisma.coingeckoToken.deleteMany();

    this.logger.info({ count: result.count }, 'Deleted all CoingeckoToken records');
    log.methodExit(this.logger, 'deleteAll', { count: result.count });
    return result.count;
  }
}
