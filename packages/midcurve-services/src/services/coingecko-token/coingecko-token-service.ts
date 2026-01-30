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
   * Search tokens by text and filter by chain IDs
   *
   * Performs case-insensitive substring matching on both name and symbol fields,
   * filtered to only include tokens on the specified chains.
   *
   * @param query - Text to search for in name or symbol
   * @param chainIds - Array of chain IDs to filter by (e.g., [1, 42161])
   * @param limit - Maximum results to return (default: 10)
   * @returns Array of matching CoingeckoToken entries
   */
  async searchByTextAndChains(
    query: string,
    chainIds: number[],
    limit: number = 10
  ): Promise<CoingeckoToken[]> {
    log.methodEntry(this.logger, 'searchByTextAndChains', {
      query,
      chainIds,
      limit,
    });

    if (chainIds.length === 0) {
      log.methodExit(this.logger, 'searchByTextAndChains', { count: 0 });
      return [];
    }

    // Use raw query to filter by chainId in JSON config field
    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        coingeckoId: string;
        name: string;
        symbol: string;
        config: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      SELECT id, "coingeckoId", name, symbol, config, "createdAt", "updatedAt"
      FROM coingecko_tokens
      WHERE (config->>'chainId')::int = ANY(${chainIds})
        AND (
          symbol ILIKE ${'%' + query + '%'}
          OR name ILIKE ${'%' + query + '%'}
        )
      ORDER BY symbol ASC, name ASC
      LIMIT ${limit}
    `;

    const tokens = results.map((row) =>
      CoingeckoToken.fromDB(row as unknown as CoingeckoTokenRow)
    );
    log.methodExit(this.logger, 'searchByTextAndChains', {
      count: tokens.length,
    });
    return tokens;
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
