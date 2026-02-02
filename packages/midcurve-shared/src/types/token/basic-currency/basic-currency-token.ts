import { BaseToken } from '../base-token';
import type { BaseTokenParams, TokenType, TokenJSON } from '../token.types';
import {
  BasicCurrencyConfig,
  type BasicCurrencyConfigJSON,
} from './basic-currency-config';

/**
 * Parameters for constructing a BasicCurrencyToken.
 */
export interface BasicCurrencyTokenParams extends BaseTokenParams {
  config: BasicCurrencyConfig;
}

/**
 * Database row interface for BasicCurrencyToken factory method.
 * Maps to Prisma Token model output with tokenType narrowed to 'basic-currency'.
 */
export interface BasicCurrencyTokenRow {
  id: string;
  tokenType: 'basic-currency';
  name: string;
  symbol: string;
  decimals: number;
  logoUrl: string | null;
  coingeckoId: string | null;
  marketCap: number | null;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Basic currency token implementation.
 *
 * Represents a platform-agnostic currency reference (USD, ETH, BTC).
 * Used for quote token determination and cross-platform value calculations.
 *
 * @example
 * ```typescript
 * const usd = BasicCurrencyToken.fromDB(row);
 * console.log(usd.currencyCode);      // 'USD'
 * console.log(usd.coingeckoCurrency); // 'usd'
 *
 * // For API response:
 * return createSuccessResponse(usd.toJSON());
 * ```
 */
export class BasicCurrencyToken extends BaseToken {
  readonly tokenType: TokenType = 'basic-currency';

  private readonly _config: BasicCurrencyConfig;

  constructor(params: BasicCurrencyTokenParams) {
    super(params);
    this._config = params.config;
  }

  // ============================================================================
  // Config Accessors
  // ============================================================================

  /**
   * Get config as generic Record (for TokenInterface compliance).
   */
  get config(): Record<string, unknown> {
    return this._config.toJSON() as unknown as Record<string, unknown>;
  }

  /**
   * Get strongly-typed config for internal use.
   */
  get typedConfig(): BasicCurrencyConfig {
    return this._config;
  }

  // ============================================================================
  // Convenience Accessors
  // ============================================================================

  /** Currency code (e.g., 'USD', 'ETH', 'BTC') */
  get currencyCode(): string {
    return this._config.currencyCode;
  }

  /** CoinGecko currency identifier */
  get coingeckoCurrency(): string {
    return this._config.coingeckoCurrency;
  }

  // ============================================================================
  // Factory
  // ============================================================================

  /**
   * Create BasicCurrencyToken from database row.
   *
   * @param row - Database row from Prisma
   * @returns BasicCurrencyToken instance
   */
  static fromDB(row: BasicCurrencyTokenRow): BasicCurrencyToken {
    return new BasicCurrencyToken({
      id: row.id,
      name: row.name,
      symbol: row.symbol,
      decimals: row.decimals,
      logoUrl: row.logoUrl ?? undefined,
      coingeckoId: row.coingeckoId ?? undefined,
      marketCap: row.marketCap ?? undefined,
      config: BasicCurrencyConfig.fromJSON(
        row.config as unknown as BasicCurrencyConfigJSON
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  /**
   * Create BasicCurrencyToken from JSON (API response).
   *
   * Deserializes a TokenJSON object back into a BasicCurrencyToken instance.
   * Converts ISO date strings back to Date objects.
   *
   * @param json - JSON data from API response
   * @returns BasicCurrencyToken instance
   * @throws Error if tokenType is not 'basic-currency'
   */
  static fromJSON(json: TokenJSON): BasicCurrencyToken {
    if (json.tokenType !== 'basic-currency') {
      throw new Error(`Expected tokenType 'basic-currency', got '${json.tokenType}'`);
    }

    return new BasicCurrencyToken({
      id: json.id,
      name: json.name,
      symbol: json.symbol,
      decimals: json.decimals,
      logoUrl: json.logoUrl,
      coingeckoId: json.coingeckoId,
      marketCap: json.marketCap,
      config: BasicCurrencyConfig.fromJSON(json.config as unknown as BasicCurrencyConfigJSON),
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
    });
  }
}
