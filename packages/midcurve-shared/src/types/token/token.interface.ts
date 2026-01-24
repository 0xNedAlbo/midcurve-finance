import type { TokenJSON, TokenType } from './token.types';

/**
 * Token interface - defines the contract for all token implementations.
 *
 * This interface uses generic `Record<string, unknown>` for config to allow
 * polymorphic handling of tokens across different protocols. Use the concrete
 * classes (Erc20Token, BasicCurrencyToken) for type-safe config access.
 */
export interface TokenInterface {
  // ============================================================================
  // Identity
  // ============================================================================

  /** Database-generated unique identifier (CUID) */
  readonly id: string;

  /** Token type discriminator for factory pattern */
  readonly tokenType: TokenType;

  // ============================================================================
  // Common Fields
  // ============================================================================

  /** Human-readable token name (e.g., "USD Coin") */
  readonly name: string;

  /** Token symbol (e.g., "USDC") */
  readonly symbol: string;

  /** Number of decimal places (e.g., 6 for USDC, 18 for ETH) */
  readonly decimals: number;

  /** Optional URL to token logo image */
  readonly logoUrl?: string;

  /** Optional CoinGecko identifier for price data */
  readonly coingeckoId?: string;

  /** Optional market capitalization in USD */
  readonly marketCap?: number;

  // ============================================================================
  // Type-Specific Configuration
  // ============================================================================

  /**
   * Protocol-specific configuration as generic Record.
   * Use typedConfig getter on concrete classes for type-safe access.
   */
  readonly config: Record<string, unknown>;

  // ============================================================================
  // Timestamps
  // ============================================================================

  /** When the token was first discovered/created */
  readonly createdAt: Date;

  /** When the token was last updated */
  readonly updatedAt: Date;

  // ============================================================================
  // Methods
  // ============================================================================

  /**
   * Serialize token to JSON format suitable for API responses.
   * Converts Date objects to ISO 8601 strings.
   */
  toJSON(): TokenJSON;

  /**
   * Get a human-readable display name for the token.
   * Default: "Name (SYMBOL)"
   */
  getDisplayName(): string;
}
