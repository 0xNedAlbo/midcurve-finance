/**
 * BasicCurrencyTokenService
 *
 * Specialized service for basic currency token management.
 * Basic currencies are platform-agnostic units (USD, ETH, BTC) used for
 * cross-platform metrics aggregation.
 *
 * Basic currencies:
 * - Are pre-defined (not discovered on-chain)
 * - Use 18 decimals for consistent precision
 * - Serve as normalization targets for platform-specific tokens
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

// =============================================================================
// PRE-DEFINED BASIC CURRENCIES
// =============================================================================

/**
 * Pre-defined basic currency definitions
 *
 * These are the canonical units for cross-platform metrics aggregation.
 * Each basic currency represents a stable value unit that platform-specific
 * tokens can link to.
 */
export const BASIC_CURRENCIES = {
  USD: {
    currencyCode: 'USD',
    name: 'US Dollar',
    symbol: 'USD',
  },
  ETH: {
    currencyCode: 'ETH',
    name: 'Ethereum',
    symbol: 'ETH',
  },
  BTC: {
    currencyCode: 'BTC',
    name: 'Bitcoin',
    symbol: 'BTC',
  },
} as const;

/**
 * Type for valid basic currency codes
 */
export type BasicCurrencyCode = keyof typeof BASIC_CURRENCIES;

/**
 * Array of all basic currency codes
 */
export const BASIC_CURRENCY_CODES = Object.keys(
  BASIC_CURRENCIES
) as BasicCurrencyCode[];

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
}

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

/**
 * BasicCurrencyTokenService
 *
 * Manages basic currency tokens. Basic currencies are pre-defined and not
 * discovered on-chain. They serve as normalization targets for platform-specific
 * tokens during cross-platform metrics aggregation.
 *
 * Key features:
 * - Pre-defined currencies (USD, ETH, BTC)
 * - All use 18 decimals for precision
 * - ensureBasicCurrency() for idempotent creation
 * - seed() for seeding all pre-defined currencies
 */
export class BasicCurrencyTokenService extends TokenService<'basic-currency'> {
  constructor(dependencies: BasicCurrencyTokenServiceDependencies = {}) {
    super(dependencies);
  }

  // ============================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ============================================================================

  /**
   * Parse config from database JSON to application type
   */
  parseConfig(configDB: unknown): BasicCurrencyConfig {
    const db = configDB as { currencyCode: string };
    return {
      currencyCode: db.currencyCode,
    };
  }

  /**
   * Serialize config from application type to database JSON
   */
  serializeConfig(config: BasicCurrencyConfig): unknown {
    return {
      currencyCode: config.currencyCode,
    };
  }

  /**
   * Discover a basic currency token
   *
   * Basic currencies are not discovered on-chain. Use ensureBasicCurrency()
   * or seed() instead.
   *
   * @throws Error - Basic currencies are pre-defined, not discoverable
   */
  async discover(
    _params: BasicCurrencyDiscoverInput
  ): Promise<BasicCurrencyToken> {
    throw new Error(
      'Basic currencies are not discoverable on-chain. ' +
        'Use ensureBasicCurrency() to get or create a basic currency.'
    );
  }

  /**
   * Search for basic currency tokens
   *
   * Returns pre-defined basic currency candidates matching the filter.
   *
   * @param input - Search filter (optional currencyCode)
   * @returns Array of matching basic currency candidates
   */
  async searchTokens(
    input: BasicCurrencySearchInput
  ): Promise<BasicCurrencySearchCandidate[]> {
    log.methodEntry(this.logger, 'searchTokens', { input });

    const candidates: BasicCurrencySearchCandidate[] = [];

    for (const code of BASIC_CURRENCY_CODES) {
      const def = BASIC_CURRENCIES[code];

      // Filter by currency code if provided
      if (input.currencyCode && input.currencyCode !== code) {
        continue;
      }

      candidates.push({
        currencyCode: def.currencyCode,
        name: def.name,
        symbol: def.symbol,
      });
    }

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
   * Ensure a basic currency exists, creating it if necessary.
   *
   * This is the primary method for getting basic currency tokens.
   * Safe to call multiple times (idempotent).
   *
   * @param currencyCode - Currency code from BASIC_CURRENCIES
   * @returns The existing or newly created basic currency token
   * @throws Error if currencyCode is not a valid basic currency
   */
  async ensureBasicCurrency(
    currencyCode: BasicCurrencyCode
  ): Promise<BasicCurrencyToken> {
    log.methodEntry(this.logger, 'ensureBasicCurrency', { currencyCode });

    try {
      // Validate currency code
      if (!BASIC_CURRENCY_CODES.includes(currencyCode)) {
        throw new Error(
          `Invalid basic currency code: ${currencyCode}. ` +
            `Valid codes are: ${BASIC_CURRENCY_CODES.join(', ')}`
        );
      }

      // Check if already exists
      const existing = await this.findByCurrencyCode(currencyCode);
      if (existing) {
        this.logger.debug(
          { id: existing.id, currencyCode },
          'Basic currency already exists'
        );
        log.methodExit(this.logger, 'ensureBasicCurrency', {
          id: existing.id,
          existed: true,
        });
        return existing;
      }

      // Create new basic currency
      const currencyDef = BASIC_CURRENCIES[currencyCode];
      const token = await this.create({
        tokenType: 'basic-currency',
        name: currencyDef.name,
        symbol: currencyDef.symbol,
        decimals: BASIC_CURRENCY_DECIMALS, // Always 18
        config: {
          currencyCode: currencyDef.currencyCode,
        },
      });

      this.logger.info(
        { id: token.id, currencyCode },
        'Basic currency created'
      );
      log.methodExit(this.logger, 'ensureBasicCurrency', {
        id: token.id,
        created: true,
      });
      return token;
    } catch (error) {
      log.methodError(this.logger, 'ensureBasicCurrency', error as Error, {
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
}
