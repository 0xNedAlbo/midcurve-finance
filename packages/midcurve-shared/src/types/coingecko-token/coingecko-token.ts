/**
 * CoingeckoToken - Lookup entity mapping ERC-20 addresses to CoinGecko IDs
 *
 * This is a lookup service entity, NOT part of the Token entity hierarchy.
 * Used for token enrichment and price discovery.
 */

import {
  CoingeckoTokenConfig,
  type CoingeckoTokenConfigJSON,
} from './coingecko-token-config.js';

/**
 * Parameters for constructing a CoingeckoToken
 */
export interface CoingeckoTokenParams {
  id: string;
  coingeckoId: string;
  name: string;
  symbol: string;
  config: CoingeckoTokenConfig;
  createdAt: Date;
  updatedAt: Date;
  // Enrichment data from /coins/markets endpoint
  enrichedAt?: Date | null;
  imageUrl?: string | null;
  marketCapUsd?: number | null;
}

/**
 * Database row interface
 * Matches the Prisma-generated type for database queries
 */
export interface CoingeckoTokenRow {
  id: string;
  coingeckoId: string;
  name: string;
  symbol: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  // Enrichment data from /coins/markets endpoint
  enrichedAt: Date | null;
  imageUrl: string | null;
  marketCapUsd: number | null;
}

/**
 * JSON representation for API responses
 */
export interface CoingeckoTokenJSON {
  id: string;
  coingeckoId: string;
  name: string;
  symbol: string;
  config: CoingeckoTokenConfigJSON;
  createdAt: string;
  updatedAt: string;
  // Enrichment data from /coins/markets endpoint
  enrichedAt: string | null;
  imageUrl: string | null;
  marketCapUsd: number | null;
}

/**
 * CoingeckoToken class
 *
 * Represents a mapping from an ERC-20 token address on a specific chain
 * to its CoinGecko identifier for price discovery and enrichment.
 */
export class CoingeckoToken {
  readonly id: string;
  readonly coingeckoId: string;
  readonly name: string;
  readonly symbol: string;
  readonly typedConfig: CoingeckoTokenConfig;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  // Enrichment data from /coins/markets endpoint
  readonly enrichedAt: Date | null;
  readonly imageUrl: string | null;
  readonly marketCapUsd: number | null;

  constructor(params: CoingeckoTokenParams) {
    this.id = params.id;
    this.coingeckoId = params.coingeckoId;
    this.name = params.name;
    this.symbol = params.symbol;
    this.typedConfig = params.config;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
    // Enrichment data (optional, defaults to null)
    this.enrichedAt = params.enrichedAt ?? null;
    this.imageUrl = params.imageUrl ?? null;
    this.marketCapUsd = params.marketCapUsd ?? null;
  }

  // ============================================================================
  // Convenience Accessors
  // ============================================================================

  /**
   * Chain ID where the token exists
   */
  get chainId(): number {
    return this.typedConfig.chainId;
  }

  /**
   * Token contract address (EIP-55 checksummed)
   */
  get tokenAddress(): string {
    return this.typedConfig.tokenAddress;
  }

  /**
   * Config as plain object (for generic access)
   */
  get config(): Record<string, unknown> {
    return this.typedConfig.toJSON() as unknown as Record<string, unknown>;
  }

  // ============================================================================
  // Serialization
  // ============================================================================

  /**
   * Serialize to JSON for API responses
   */
  toJSON(): CoingeckoTokenJSON {
    return {
      id: this.id,
      coingeckoId: this.coingeckoId,
      name: this.name,
      symbol: this.symbol,
      config: this.typedConfig.toJSON(),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      enrichedAt: this.enrichedAt?.toISOString() ?? null,
      imageUrl: this.imageUrl,
      marketCapUsd: this.marketCapUsd,
    };
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create from database row
   */
  static fromDB(row: CoingeckoTokenRow): CoingeckoToken {
    return new CoingeckoToken({
      id: row.id,
      coingeckoId: row.coingeckoId,
      name: row.name,
      symbol: row.symbol,
      config: CoingeckoTokenConfig.fromJSON(
        row.config as unknown as CoingeckoTokenConfigJSON
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      enrichedAt: row.enrichedAt,
      imageUrl: row.imageUrl,
      marketCapUsd: row.marketCapUsd,
    });
  }

  /**
   * Create composite ID from chainId and address
   * Format: "erc20:{chainId}:{normalizedTokenAddress}"
   *
   * @param chainId - Chain ID (1, 42161, 8453, 56, 137, 10)
   * @param tokenAddress - Token contract address (should be normalized/checksummed)
   * @returns Composite ID string
   */
  static createId(chainId: number, tokenAddress: string): string {
    return `erc20:${chainId}:${tokenAddress.toLowerCase()}`;
  }

  /**
   * Parse composite ID to extract chainId and tokenAddress
   *
   * @param id - Composite ID string
   * @returns Object with chainId and tokenAddress, or null if invalid format
   */
  static parseId(
    id: string
  ): { chainId: number; tokenAddress: string } | null {
    const parts = id.split(':');
    if (parts.length !== 3 || parts[0] !== 'erc20') {
      return null;
    }

    const chainIdStr = parts[1];
    const tokenAddress = parts[2];

    // TypeScript guard - these should always be defined after length check
    if (chainIdStr === undefined || tokenAddress === undefined) {
      return null;
    }

    const chainId = parseInt(chainIdStr, 10);
    if (isNaN(chainId)) {
      return null;
    }

    return {
      chainId,
      tokenAddress,
    };
  }
}
