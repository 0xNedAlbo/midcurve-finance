import { BaseToken } from '../base-token';
import type { BaseTokenParams, TokenType } from '../token.types';
import {
  Erc20TokenConfig,
  type Erc20TokenConfigJSON,
} from './erc20-token-config';

/**
 * Parameters for constructing an Erc20Token.
 */
export interface Erc20TokenParams extends BaseTokenParams {
  config: Erc20TokenConfig;
}

/**
 * Database row interface for Erc20Token factory method.
 * Maps to Prisma Token model output with tokenType narrowed to 'erc20'.
 */
export interface Erc20TokenRow {
  id: string;
  tokenType: 'erc20';
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
 * ERC-20 token implementation.
 *
 * Represents an ERC-20 token on an EVM-compatible chain.
 * Provides type-safe access to chain-specific configuration.
 *
 * @example
 * ```typescript
 * const usdc = Erc20Token.fromDB(row);
 * console.log(usdc.address);  // '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
 * console.log(usdc.chainId);  // 1
 * console.log(usdc.symbol);   // 'USDC'
 *
 * // For API response:
 * return createSuccessResponse(usdc.toJSON());
 * ```
 */
export class Erc20Token extends BaseToken {
  readonly tokenType: TokenType = 'erc20';

  private readonly _config: Erc20TokenConfig;

  constructor(params: Erc20TokenParams) {
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
  get typedConfig(): Erc20TokenConfig {
    return this._config;
  }

  // ============================================================================
  // Convenience Accessors
  // ============================================================================

  /** Contract address (EIP-55 checksummed) */
  get address(): string {
    return this._config.address;
  }

  /** Chain ID */
  get chainId(): number {
    return this._config.chainId;
  }

  /** Optional basic currency link */
  get basicCurrencyId(): string | undefined {
    return this._config.basicCurrencyId;
  }

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Get display name with shortened address.
   * @returns "SYMBOL (0x1234...5678)"
   */
  override getDisplayName(): string {
    const shortAddress = `${this.address.slice(0, 6)}...${this.address.slice(-4)}`;
    return `${this.symbol} (${shortAddress})`;
  }

  // ============================================================================
  // Factory
  // ============================================================================

  /**
   * Create Erc20Token from database row.
   *
   * @param row - Database row from Prisma
   * @returns Erc20Token instance
   */
  static fromDB(row: Erc20TokenRow): Erc20Token {
    return new Erc20Token({
      id: row.id,
      name: row.name,
      symbol: row.symbol,
      decimals: row.decimals,
      logoUrl: row.logoUrl ?? undefined,
      coingeckoId: row.coingeckoId ?? undefined,
      marketCap: row.marketCap ?? undefined,
      config: Erc20TokenConfig.fromJSON(
        row.config as unknown as Erc20TokenConfigJSON
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
