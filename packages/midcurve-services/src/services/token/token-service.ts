/**
 * Abstract Token Service
 *
 * Base class for token-type-specific services.
 * Provides shared infrastructure (Prisma client, logging) and common patterns.
 *
 * Subclasses (Erc20TokenService, BasicCurrencyTokenService) implement:
 * - Type-specific CRUD operations returning concrete class instances
 * - Discovery and search methods
 * - Config serialization using the class-based pattern from @midcurve/shared
 *
 * Design: Services return class instances (Erc20Token, BasicCurrencyToken)
 * for type-safe config access via .typedConfig and convenience accessors.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { TokenInterface, TokenType } from '@midcurve/shared';
import { TokenFactory } from '@midcurve/shared';
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
 * Generic token result from database (before conversion to class instance)
 * Matches Prisma Token model output
 */
export interface TokenDbResult {
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
 * Token-type-specific services extend this class and implement
 * their own CRUD, discovery, and search methods.
 */
export abstract class TokenService {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;

  /**
   * Token type discriminator for this service
   * Must be implemented by subclasses
   */
  protected abstract readonly tokenType: TokenType;

  /**
   * Creates a new TokenService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   */
  constructor(dependencies: TokenServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger(this.constructor.name);
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  // ============================================================================
  // POLYMORPHIC HELPERS
  // ============================================================================

  /**
   * Convert database result to TokenInterface using the factory pattern.
   *
   * This method uses TokenFactory.fromDB() which routes to the correct
   * concrete class (Erc20Token or BasicCurrencyToken) based on tokenType.
   *
   * Subclasses should override findById/create/update to return their
   * specific type using their own factory method (e.g., Erc20Token.fromDB).
   *
   * @param dbResult - Raw database result from Prisma
   * @returns Token class instance implementing TokenInterface
   */
  protected mapToToken(dbResult: TokenDbResult): TokenInterface {
    return TokenFactory.fromDB({
      id: dbResult.id,
      tokenType: dbResult.tokenType,
      name: dbResult.name,
      symbol: dbResult.symbol,
      decimals: dbResult.decimals,
      logoUrl: dbResult.logoUrl,
      coingeckoId: dbResult.coingeckoId,
      marketCap: dbResult.marketCap,
      config: dbResult.config as Record<string, unknown>,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
    });
  }

  // ============================================================================
  // BASE CRUD OPERATIONS
  // ============================================================================

  /**
   * Find a token by its database ID (polymorphic)
   *
   * Returns a TokenInterface that can be narrowed based on tokenType.
   * Subclasses override this to return their specific type.
   *
   * @param id - Token database ID
   * @returns The token if found, null otherwise
   */
  async findById(id: string): Promise<TokenInterface | null> {
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
   * Delete a token
   *
   * Base implementation that handles database operations.
   * Subclasses should override this method to add type-specific
   * safeguards and validation.
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
