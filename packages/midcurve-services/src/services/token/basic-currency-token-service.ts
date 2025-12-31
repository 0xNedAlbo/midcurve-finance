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
import type { BasicCurrencyToken, BasicCurrencyConfig } from '@midcurve/shared';
import { BASIC_CURRENCY_DECIMALS } from '@midcurve/shared';
import { TokenService } from './token-service.js';
import type { TokenServiceDependencies } from './token-service.js';
import type {
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
export class BasicCurrencyTokenService extends TokenService<'basic-currency'> {
  private readonly coinGeckoClient: CoinGeckoClient;

  constructor(dependencies: BasicCurrencyTokenServiceDependencies = {}) {
    super(dependencies);
    this.coinGeckoClient = dependencies.coinGeckoClient ?? CoinGeckoClient.getInstance();
  }

  // ============================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ============================================================================

  /**
   * Parse config from database JSON to application type
   */
  parseConfig(configDB: unknown): BasicCurrencyConfig {
    const db = configDB as { currencyCode: string; coingeckoCurrency: string };
    return {
      currencyCode: db.currencyCode,
      coingeckoCurrency: db.coingeckoCurrency,
    };
  }

  /**
   * Serialize config from application type to database JSON
   */
  serializeConfig(config: BasicCurrencyConfig): unknown {
    return {
      currencyCode: config.currencyCode,
      coingeckoCurrency: config.coingeckoCurrency,
    };
  }

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
        (t) => !input.currencyCode || t.config.currencyCode === input.currencyCode
      )
      .map((t) => ({
        currencyCode: t.config.currencyCode,
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

      const token = this.mapToToken(result);

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

      const tokens = results.map((r) => this.mapToToken(r));

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
}
