/**
 * Data interface for ERC-20 token configuration.
 * Describes the shape of config data.
 */
export interface Erc20TokenConfigData {
  /** Contract address (EIP-55 checksummed) */
  address: string;

  /** Chain ID (1 = Ethereum, 56 = BSC, etc.) */
  chainId: number;

  /** Optional link to a basic currency (USD, ETH, BTC) */
  basicCurrencyId?: string;
}

/**
 * JSON interface for serialization.
 * Matches the database JSON column format.
 */
export interface Erc20TokenConfigJSON {
  address: string;
  chainId: number;
  basicCurrencyId?: string;
}

/**
 * ERC-20 token configuration class.
 *
 * Immutable configuration for ERC-20 tokens on EVM chains.
 * Provides type-safe access and serialization methods.
 *
 * @example
 * ```typescript
 * const config = new Erc20TokenConfig({
 *   address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
 *   chainId: 1,
 * });
 *
 * console.log(config.address); // '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
 * console.log(config.toJSON()); // { address: '0x...', chainId: 1 }
 * ```
 */
export class Erc20TokenConfig implements Erc20TokenConfigData {
  readonly address: string;
  readonly chainId: number;
  readonly basicCurrencyId?: string;

  constructor(data: Erc20TokenConfigData) {
    this.address = data.address;
    this.chainId = data.chainId;
    this.basicCurrencyId = data.basicCurrencyId;
  }

  /**
   * Serialize config to JSON format.
   */
  toJSON(): Erc20TokenConfigJSON {
    return {
      address: this.address,
      chainId: this.chainId,
      basicCurrencyId: this.basicCurrencyId,
    };
  }

  /**
   * Deserialize config from JSON format.
   */
  static fromJSON(json: Erc20TokenConfigJSON): Erc20TokenConfig {
    return new Erc20TokenConfig({
      address: json.address,
      chainId: json.chainId,
      basicCurrencyId: json.basicCurrencyId,
    });
  }
}
