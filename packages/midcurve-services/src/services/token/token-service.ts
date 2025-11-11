/**
 * Abstract Token Service
 *
 * Base class for token-type-specific services.
 * Handles serialization/deserialization of config between
 * database JSON format and application types.
 *
 * Token type implementations (e.g., Erc20TokenService) must implement
 * abstract serialization methods.
 *
 * Note: Unlike Position, Token has no mutable state - only immutable config.
 */

import { PrismaClient } from '@midcurve/database';
import type { Token, TokenConfigMap } from '@midcurve/shared';
import type {
  CreateTokenInput,
  UpdateTokenInput,
  TokenDiscoverInput,
  TokenSearchInput,
  TokenSearchCandidate,
} from '../types/token/token-input.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for TokenService
 * All dependencies are optional and will use defaults if not provided
 */
export interface TokenServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Generic token result from database (before deserialization)
 */
interface TokenDbResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tokenType: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl: string | null;
  coingeckoId: string | null;
  marketCap: number | null;
  config: unknown;
}

/**
 * Abstract TokenService
 *
 * Provides base functionality for token management.
 * Token-type-specific services must extend this class and implement
 * serialization methods for config.
 *
 * @template T - Token type key from TokenConfigMap ('erc20', etc.)
 */
export abstract class TokenService<T extends keyof TokenConfigMap> {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;

  /**
   * Creates a new TokenService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   */
  constructor(dependencies: TokenServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger(this.constructor.name);
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  // ============================================================================
  // ABSTRACT SERIALIZATION METHODS
  // Token type implementations MUST implement these methods
  // ============================================================================

  /**
   * Parse config from database JSON to application type
   *
   * Converts serialized values (if any) to native types.
   * For configs with only primitives, this may be a pass-through.
   *
   * @param configDB - Config object from database (JSON)
   * @returns Parsed config with native types
   */
  abstract parseConfig(configDB: unknown): TokenConfigMap[T];

  /**
   * Serialize config from application type to database JSON
   *
   * Converts native values (if any) to serializable types.
   * For configs with only primitives, this may be a pass-through.
   *
   * @param config - Application config with native types
   * @returns Serialized config for database storage
   */
  abstract serializeConfig(config: TokenConfigMap[T]): unknown;

  // ============================================================================
  // ABSTRACT DISCOVERY METHOD
  // Protocol implementations MUST implement this method
  // ============================================================================

  /**
   * Discover and create a token from on-chain data
   *
   * Checks the database first for an existing token. If not found, reads
   * token metadata from on-chain sources and creates a new token entry.
   *
   * Implementation note: Each protocol defines its own discovery input type
   * via TokenDiscoverInputMap. For example, ERC-20 uses { address: string, chainId: number }.
   *
   * @param params - Discovery parameters (type-safe via TokenDiscoverInputMap[T])
   * @returns The discovered or existing token
   * @throws Error if discovery fails (protocol-specific errors)
   */
  abstract discover(params: TokenDiscoverInput<T>): Promise<Token<T>>;

  // ============================================================================
  // ABSTRACT SEARCH METHOD
  // Protocol implementations MUST implement this method
  // ============================================================================

  /**
   * Search for tokens in external catalogs (e.g., CoinGecko) by criteria
   *
   * Searches external data sources for tokens matching the specified criteria.
   * Returns lightweight candidate objects (not full Token objects from database).
   *
   * Implementation note: Each protocol defines its own search input type
   * via TokenSearchInputMap. For example, ERC-20 uses { chainId: number, symbol?: string, name?: string }.
   *
   * The search results are candidates that can be discovered/added to the database
   * using the discover() method.
   *
   * @param input - Search parameters (type-safe via TokenSearchInputMap[T])
   * @returns Array of matching token candidates (max 10)
   * @throws Error if search fails (protocol-specific errors)
   */
  abstract searchTokens(input: TokenSearchInput<T>): Promise<TokenSearchCandidate<T>[]>;

  // ============================================================================
  // PROTECTED HELPERS
  // ============================================================================

  /**
   * Map database result to Token type
   *
   * Calls parseConfig for config deserialization.
   *
   * @param dbResult - Raw database result
   * @returns Token with native types
   */
  protected mapToToken(dbResult: TokenDbResult): Token<T> {
    return {
      id: dbResult.id,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      tokenType: dbResult.tokenType as T,
      name: dbResult.name,
      symbol: dbResult.symbol,
      decimals: dbResult.decimals,
      logoUrl: dbResult.logoUrl ?? undefined,
      coingeckoId: dbResult.coingeckoId ?? undefined,
      marketCap: dbResult.marketCap ?? undefined,
      config: this.parseConfig(dbResult.config),
    };
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Find a token by its database ID
   *
   * Base implementation that retrieves from database.
   * Derived classes should override to add type filtering.
   *
   * @param id - Token database ID
   * @returns The token if found, null otherwise
   */
  async findById(id: string): Promise<Token<T> | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      log.dbOperation(this.logger, 'findUnique', 'Token', { id });

      const result = await this.prisma.token.findUnique({
        where: { id },
      });

      if (!result) {
        this.logger.debug({ id }, 'Token not found');
        log.methodExit(this.logger, 'findById', { found: false });
        return null;
      }

      const token = this.mapToToken(result);

      this.logger.debug(
        { id, symbol: token.symbol, tokenType: token.tokenType },
        'Token found'
      );
      log.methodExit(this.logger, 'findById', { id });
      return token;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Create a new token
   *
   * Base implementation that handles database operations.
   * Derived classes should override this method to add validation,
   * normalization, and duplicate checking logic.
   *
   * @param input - Token data to create (omits id, createdAt, updatedAt)
   * @returns The created token with generated id and timestamps
   */
  async create(input: CreateTokenInput<T>): Promise<Token<T>> {
    log.methodEntry(this.logger, 'create', {
      tokenType: input.tokenType,
      symbol: input.symbol,
      name: input.name,
    });

    try {
      // Serialize config for database storage
      const configDB = this.serializeConfig(input.config);

      log.dbOperation(this.logger, 'create', 'Token', {
        tokenType: input.tokenType,
        symbol: input.symbol,
      });

      const result = await this.prisma.token.create({
        data: {
          tokenType: input.tokenType,
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: input.logoUrl,
          coingeckoId: input.coingeckoId,
          marketCap: input.marketCap,
          config: configDB as object,
        },
      });

      const token = this.mapToToken(result);

      this.logger.info(
        {
          id: token.id,
          tokenType: token.tokenType,
          symbol: token.symbol,
          name: token.name,
        },
        'Token created successfully'
      );

      log.methodExit(this.logger, 'create', { id: token.id });
      return token;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, {
        tokenType: input.tokenType,
        symbol: input.symbol,
      });
      throw error;
    }
  }

  /**
   * Update an existing token
   *
   * Base implementation that handles database operations.
   * Derived classes should override this method to add validation
   * and type-specific checks.
   *
   * @param id - Token database ID
   * @param input - Partial token data to update
   * @returns The updated token
   * @throws Error if token not found
   */
  async update(id: string, input: UpdateTokenInput<T>): Promise<Token<T>> {
    log.methodEntry(this.logger, 'update', {
      id,
      fields: Object.keys(input),
    });

    try {
      // Verify token exists
      log.dbOperation(this.logger, 'findUnique', 'Token', { id });

      const existing = await this.prisma.token.findUnique({
        where: { id },
      });

      if (!existing) {
        const error = new Error(`Token with id ${id} not found`);
        log.methodError(this.logger, 'update', error, { id });
        throw error;
      }

      // Serialize config if provided
      const configDB = input.config ? this.serializeConfig(input.config) : undefined;

      // Update token
      log.dbOperation(this.logger, 'update', 'Token', {
        id,
        fields: Object.keys(input),
      });

      const result = await this.prisma.token.update({
        where: { id },
        data: {
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: input.logoUrl,
          coingeckoId: input.coingeckoId,
          marketCap: input.marketCap,
          config: configDB as object | undefined,
        },
      });

      const token = this.mapToToken(result);

      this.logger.info(
        {
          id: token.id,
          symbol: token.symbol,
        },
        'Token updated successfully'
      );

      log.methodExit(this.logger, 'update', { id });
      return token;
    } catch (error) {
      // Only log if not already logged
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'update', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Delete a token
   *
   * Base implementation that handles database operations.
   * Derived classes should override this method to add type-specific
   * safeguards.
   *
   * This operation is idempotent - deleting a non-existent token
   * returns silently without error.
   *
   * @param id - Token database ID
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      // Verify token exists
      log.dbOperation(this.logger, 'findUnique', 'Token', { id });

      const existing = await this.prisma.token.findUnique({
        where: { id },
      });

      if (!existing) {
        this.logger.debug({ id }, 'Token not found, nothing to delete');
        log.methodExit(this.logger, 'delete', { id, found: false });
        return; // Idempotent: silently return if token doesn't exist
      }

      // Delete token
      log.dbOperation(this.logger, 'delete', 'Token', { id });

      await this.prisma.token.delete({
        where: { id },
      });

      this.logger.info(
        {
          id,
          symbol: existing.symbol,
          tokenType: existing.tokenType,
        },
        'Token deleted successfully'
      );

      log.methodExit(this.logger, 'delete', { id });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }
}
