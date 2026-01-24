/**
 * BasicCurrencyTokenService
 *
 * Specialized service for basic currency token management.
 * Basic currencies are CoinGecko-validated units used for cross-platform
 * metrics aggregation.
 *
 * Basic currencies:
 * - Are validated against CoinGecko's supported vs_currencies
 * - Use 18 decimals for consistent precision
 * - Serve as normalization targets for platform-specific tokens
 *
 * Key features:
 * - All currencies validated against CoinGecko's vs_currencies API
 * - All use 18 decimals for precision
 * - findOrCreateBySymbol() for idempotent creation with CoinGecko validation
 */

import { PrismaClient } from '@midcurve/database';
import {
  BasicCurrencyToken,
  BasicCurrencyConfig,
  BASIC_CURRENCY_DECIMALS,
} from '@midcurve/shared';
import type { BasicCurrencyConfigData } from '@midcurve/shared';
import { TokenService } from './token-service.js';
import type { TokenServiceDependencies } from './token-service.js';
import type {
  CreateBasicCurrencyTokenInput,
  BasicCurrencyDiscoverInput,
  BasicCurrencySearchInput,
  BasicCurrencySearchCandidate,
} from '../types/token/token-input.js';
import { log } from '../../logging/index.js';
import { CoinGeckoClient } from '../../clients/coingecko/index.js';

// =============================================================================
// SERVICE DEPENDENCIES
// =============================================================================

/**
 * Dependencies for BasicCurrencyTokenService
 */
export interface BasicCurrencyTokenServiceDependencies
  extends TokenServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;

  /**
   * CoinGecko client for currency validation
   * If not provided, the singleton instance will be used
   */
  coinGeckoClient?: CoinGeckoClient;
}

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

/**
 * BasicCurrencyTokenService
 *
 * Manages basic currency tokens. Basic currencies are CoinGecko-validated
 * currencies used for cross-platform metrics aggregation.
 *
 * Key features:
 * - All currencies validated against CoinGecko's vs_currencies API
 * - All use 18 decimals for precision
 * - findOrCreateBySymbol() for idempotent creation with CoinGecko validation
 */
export class BasicCurrencyTokenService extends TokenService {
  protected readonly tokenType = 'basic-currency' as const;
  private readonly coinGeckoClient: CoinGeckoClient;

  constructor(dependencies: BasicCurrencyTokenServiceDependencies = {}) {
    super(dependencies);
    this.coinGeckoClient = dependencies.coinGeckoClient ?? CoinGeckoClient.getInstance();
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Convert database result to BasicCurrencyToken class instance.
   *
   * @param dbResult - Raw database result from Prisma
   * @returns BasicCurrencyToken class instance
   */
  private mapToBasicCurrencyToken(dbResult: {
    id: string;
    tokenType: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    coingeckoId: string | null;
    marketCap: number | null;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): BasicCurrencyToken {
    return BasicCurrencyToken.fromDB({
      id: dbResult.id,
      tokenType: 'basic-currency',
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
  // DISCOVERY & SEARCH
  // ============================================================================

  /**
   * Discover a basic currency token
   *
   * Basic currencies are not discovered on-chain. Use findOrCreateBySymbol()
   * instead.
   *
   * @throws Error - Basic currencies are not discoverable on-chain
   */
  async discover(
    _params: BasicCurrencyDiscoverInput
  ): Promise<BasicCurrencyToken> {
    throw new Error(
      'Basic currencies are not discoverable on-chain. ' +
        'Use findOrCreateBySymbol() to get or create a basic currency.'
    );
  }

  /**
   * Search for basic currency tokens
   *
   * Returns existing basic currency candidates from the database matching the filter.
   *
   * @param input - Search filter (optional currencyCode)
   * @returns Array of matching basic currency candidates
   */
  async searchTokens(
    input: BasicCurrencySearchInput
  ): Promise<BasicCurrencySearchCandidate[]> {
    log.methodEntry(this.logger, 'searchTokens', { input });

    // Query database for existing basic currencies
    const tokens = await this.findAll();

    const candidates = tokens
      .filter(
        (t) => !input.currencyCode || t.typedConfig.currencyCode === input.currencyCode
      )
      .map((t) => ({
        currencyCode: t.typedConfig.currencyCode,
        name: t.name,
        symbol: t.symbol,
      }));

    log.methodExit(this.logger, 'searchTokens', { count: candidates.length });
    return candidates;
  }

  // ============================================================================
  // BASIC CURRENCY SPECIFIC METHODS
  // ============================================================================

  /**
   * Find a basic currency by its currency code
   *
   * @param currencyCode - Currency code (e.g., 'USD', 'ETH', 'BTC')
   * @returns The basic currency token if found, null otherwise
   */
  async findByCurrencyCode(
    currencyCode: string
  ): Promise<BasicCurrencyToken | null> {
    log.methodEntry(this.logger, 'findByCurrencyCode', { currencyCode });

    try {
      const normalizedCode = currencyCode.toUpperCase();

      log.dbOperation(this.logger, 'findFirst', 'Token', {
        tokenType: 'basic-currency',
        currencyCode: normalizedCode,
      });

      const result = await this.prisma.token.findFirst({
        where: {
          tokenType: 'basic-currency',
          config: {
            path: ['currencyCode'],
            equals: normalizedCode,
          },
        },
      });

      if (!result) {
        this.logger.debug(
          { currencyCode: normalizedCode },
          'Basic currency not found'
        );
        log.methodExit(this.logger, 'findByCurrencyCode', { found: false });
        return null;
      }

      const token = this.mapToBasicCurrencyToken(result);

      this.logger.debug(
        { id: token.id, currencyCode: normalizedCode },
        'Basic currency found'
      );
      log.methodExit(this.logger, 'findByCurrencyCode', { id: token.id });
      return token;
    } catch (error) {
      log.methodError(this.logger, 'findByCurrencyCode', error as Error, {
        currencyCode,
      });
      throw error;
    }
  }

  /**
   * Get all existing basic currencies from the database.
   *
   * @returns Array of basic currency tokens currently in the database
   */
  async findAll(): Promise<BasicCurrencyToken[]> {
    log.methodEntry(this.logger, 'findAll', {});

    try {
      log.dbOperation(this.logger, 'findMany', 'Token', {
        tokenType: 'basic-currency',
      });

      const results = await this.prisma.token.findMany({
        where: {
          tokenType: 'basic-currency',
        },
      });

      const tokens = results.map((r) => this.mapToBasicCurrencyToken(r));

      this.logger.debug({ count: tokens.length }, 'Found basic currencies');
      log.methodExit(this.logger, 'findAll', { count: tokens.length });
      return tokens;
    } catch (error) {
      log.methodError(this.logger, 'findAll', error as Error, {});
      throw error;
    }
  }

  /**
   * Find or create a basic currency by symbol with CoinGecko validation.
   *
   * This is the primary method for getting basic currency tokens.
   * Safe to call multiple times (idempotent).
   *
   * 1. First checks the database for an existing token with matching currencyCode
   * 2. If not found, validates the symbol against CoinGecko's supported_vs_currencies
   * 3. If valid, creates a new basic currency token with the CoinGecko currency ID
   *
   * This enables manifest authors to use any CoinGecko-supported currency as a quote token.
   *
   * @param symbol - Currency symbol (e.g., 'USD', 'EUR', 'JPY', 'ETH', 'BTC')
   * @returns The existing or newly created basic currency token
   * @throws Error if the symbol is not supported by CoinGecko
   */
  async findOrCreateBySymbol(symbol: string): Promise<BasicCurrencyToken> {
    log.methodEntry(this.logger, 'findOrCreateBySymbol', { symbol });

    try {
      const normalizedSymbol = symbol.toUpperCase();

      // 1. Check if already exists in database
      const existing = await this.findByCurrencyCode(normalizedSymbol);
      if (existing) {
        this.logger.debug(
          { id: existing.id, symbol: normalizedSymbol },
          'Basic currency already exists in database'
        );
        log.methodExit(this.logger, 'findOrCreateBySymbol', {
          id: existing.id,
          existed: true,
        });
        return existing;
      }

      // 2. Validate against CoinGecko supported_vs_currencies
      const coingeckoCurrency = await this.coinGeckoClient.validateVsCurrency(symbol);
      if (!coingeckoCurrency) {
        throw new Error(
          `Currency symbol "${symbol}" is not supported by CoinGecko. ` +
          `Use a supported currency from CoinGecko's vs_currencies list.`
        );
      }

      // 3. Create new basic currency with CoinGecko data
      const token = await this.create({
        tokenType: 'basic-currency',
        name: normalizedSymbol,
        symbol: normalizedSymbol,
        decimals: BASIC_CURRENCY_DECIMALS, // Always 18
        config: {
          currencyCode: normalizedSymbol,
          coingeckoCurrency: coingeckoCurrency,
        },
      });

      this.logger.info(
        {
          id: token.id,
          symbol: normalizedSymbol,
          coingeckoCurrency,
        },
        'Created new basic currency from CoinGecko validation'
      );

      log.methodExit(this.logger, 'findOrCreateBySymbol', {
        id: token.id,
        created: true,
      });
      return token;
    } catch (error) {
      log.methodError(this.logger, 'findOrCreateBySymbol', error as Error, {
        symbol,
      });
      throw error;
    }
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new basic currency token
   *
   * @param input - Basic currency token data to create
   * @returns The created token
   */
  async create(input: CreateBasicCurrencyTokenInput): Promise<BasicCurrencyToken> {
    log.methodEntry(this.logger, 'create', {
      tokenType: input.tokenType,
      symbol: input.symbol,
      name: input.name,
    });

    try {
      // Create config class for serialization
      const config = new BasicCurrencyConfig(input.config);

      log.dbOperation(this.logger, 'create', 'Token', {
        tokenType: 'basic-currency',
        symbol: input.symbol,
      });

      const result = await this.prisma.token.create({
        data: {
          tokenType: 'basic-currency',
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: input.logoUrl,
          coingeckoId: input.coingeckoId,
          marketCap: input.marketCap,
          config: config.toJSON() as object,
        },
      });

      const token = this.mapToBasicCurrencyToken(result);

      this.logger.info(
        {
          id: token.id,
          tokenType: token.tokenType,
          symbol: token.symbol,
          name: token.name,
        },
        'Basic currency token created successfully'
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
   * Find a basic currency token by its database ID
   *
   * @param id - Token database ID
   * @returns The token if found and is basic-currency type, null otherwise
   */
  override async findById(id: string): Promise<BasicCurrencyToken | null> {
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

      // Type filter: Only return if it's a basic-currency token
      if (result.tokenType !== 'basic-currency') {
        this.logger.debug(
          { id, tokenType: result.tokenType },
          'Token is not basic-currency type'
        );
        log.methodExit(this.logger, 'findById', {
          found: false,
          wrongType: true,
        });
        return null;
      }

      const token = this.mapToBasicCurrencyToken(result);

      this.logger.debug({ id, symbol: token.symbol }, 'Basic currency token found');
      log.methodExit(this.logger, 'findById', { id });
      return token;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }
}
