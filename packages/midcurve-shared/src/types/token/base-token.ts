import type { TokenInterface } from './token.interface';
import type { BaseTokenParams, TokenJSON, TokenType } from './token.types';

/**
 * Abstract base class for all token implementations.
 *
 * Provides common field storage and the toJSON() implementation.
 * Subclasses must implement tokenType and config accessors.
 *
 * @example
 * ```typescript
 * class Erc20Token extends BaseToken {
 *   readonly tokenType: TokenType = 'erc20';
 *   private readonly _config: Erc20TokenConfig;
 *
 *   get config(): Record<string, unknown> {
 *     return this._config.toJSON();
 *   }
 * }
 * ```
 */
export abstract class BaseToken implements TokenInterface {
  // ============================================================================
  // Concrete Properties (stored in all instances)
  // ============================================================================

  readonly id: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly logoUrl?: string;
  readonly coingeckoId?: string;
  readonly marketCap?: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  // ============================================================================
  // Abstract Properties (implemented by subclasses)
  // ============================================================================

  /** Token type discriminator - must be set by subclass */
  abstract readonly tokenType: TokenType;

  /** Protocol-specific configuration - must be implemented by subclass */
  abstract get config(): Record<string, unknown>;

  // ============================================================================
  // Constructor
  // ============================================================================

  constructor(params: BaseTokenParams) {
    this.id = params.id;
    this.name = params.name;
    this.symbol = params.symbol;
    this.decimals = params.decimals;
    this.logoUrl = params.logoUrl;
    this.coingeckoId = params.coingeckoId;
    this.marketCap = params.marketCap;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Serialize token to JSON format for API responses.
   *
   * Output format matches CreateErc20TokenData in @midcurve/api-shared
   * for seamless API compatibility.
   */
  toJSON(): TokenJSON {
    return {
      id: this.id,
      tokenType: this.tokenType,
      name: this.name,
      symbol: this.symbol,
      decimals: this.decimals,
      logoUrl: this.logoUrl,
      coingeckoId: this.coingeckoId,
      marketCap: this.marketCap,
      config: this.config,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Get human-readable display name.
   * Can be overridden by subclasses for protocol-specific formatting.
   */
  getDisplayName(): string {
    return `${this.name} (${this.symbol})`;
  }
}
