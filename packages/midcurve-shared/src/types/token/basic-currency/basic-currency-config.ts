/**
 * Data interface for basic currency configuration.
 * Describes the shape of config data.
 */
export interface BasicCurrencyConfigData {
  /** Currency code (e.g., 'USD', 'ETH', 'BTC') */
  currencyCode: string;

  /** CoinGecko currency identifier (e.g., 'usd', 'eth', 'btc') */
  coingeckoCurrency: string;
}

/**
 * JSON interface for serialization.
 * Matches the database JSON column format.
 */
export interface BasicCurrencyConfigJSON {
  currencyCode: string;
  coingeckoCurrency: string;
}

/**
 * Basic currency configuration class.
 *
 * Immutable configuration for platform-agnostic currency references.
 * Used for quote token determination and value calculations.
 *
 * @example
 * ```typescript
 * const usdConfig = new BasicCurrencyConfig({
 *   currencyCode: 'USD',
 *   coingeckoCurrency: 'usd',
 * });
 *
 * console.log(usdConfig.currencyCode);      // 'USD'
 * console.log(usdConfig.coingeckoCurrency); // 'usd'
 * ```
 */
export class BasicCurrencyConfig implements BasicCurrencyConfigData {
  readonly currencyCode: string;
  readonly coingeckoCurrency: string;

  constructor(data: BasicCurrencyConfigData) {
    this.currencyCode = data.currencyCode;
    this.coingeckoCurrency = data.coingeckoCurrency;
  }

  /**
   * Serialize config to JSON format.
   */
  toJSON(): BasicCurrencyConfigJSON {
    return {
      currencyCode: this.currencyCode,
      coingeckoCurrency: this.coingeckoCurrency,
    };
  }

  /**
   * Deserialize config from JSON format.
   */
  static fromJSON(json: BasicCurrencyConfigJSON): BasicCurrencyConfig {
    return new BasicCurrencyConfig({
      currencyCode: json.currencyCode,
      coingeckoCurrency: json.coingeckoCurrency,
    });
  }
}
