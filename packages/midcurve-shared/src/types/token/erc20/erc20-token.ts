import { BaseToken } from '../base-token';
import type { BaseTokenParams, TokenType, TokenJSON } from '../token.types';
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
  tokenHash: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Serialized shape of an Erc20Token as it travels over JSON.
 *
 * The concrete counterpart to {@link TokenJSON}: `tokenType` is narrowed to the
 * discriminator this class answers to, and `config` is the real config shape
 * instead of `Record<string, unknown>`. `TokenJSON` stays loose on purpose —
 * it describes *any* token — so it cannot express either of those, which is why
 * deserializing a concrete wire payload through it needs a cast.
 *
 * Lives here rather than in `@midcurve/api-shared` because a class's serialized
 * shape is a fact about the class, not about the transport that happens to
 * carry it. `@midcurve/api-shared` re-exports it as `Erc20TokenWire`.
 *
 * @see Erc20Token.fromWire
 */
export interface Erc20TokenJSON
  extends Omit<TokenJSON, 'tokenType' | 'config'> {
  tokenType: 'erc20';
  config: Erc20TokenConfigJSON;
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
      tokenHash: row.tokenHash,
      config: Erc20TokenConfig.fromJSON(
        row.config as unknown as Erc20TokenConfigJSON
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  /**
   * Create Erc20Token from JSON (API response).
   *
   * Deserializes a TokenJSON object back into an Erc20Token instance.
   * Converts ISO date strings back to Date objects.
   *
   * @param json - JSON data from API response
   * @returns Erc20Token instance
   * @throws Error if tokenType is not 'erc20'
   *
   * @example
   * ```typescript
   * const response = await fetch('/api/v1/tokens/erc20/...');
   * const json = await response.json();
   * const token = Erc20Token.fromJSON(json.data);
   * console.log(token.address); // '0x...'
   * ```
   */
  static fromJSON(json: TokenJSON): Erc20Token {
    if (json.tokenType !== 'erc20') {
      throw new Error(`Expected tokenType 'erc20', got '${json.tokenType}'`);
    }

    return new Erc20Token({
      id: json.id,
      name: json.name,
      symbol: json.symbol,
      decimals: json.decimals,
      logoUrl: json.logoUrl,
      coingeckoId: json.coingeckoId,
      marketCap: json.marketCap,
      tokenHash: json.tokenHash,
      config: Erc20TokenConfig.fromJSON(json.config as unknown as Erc20TokenConfigJSON),
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
    });
  }

  /**
   * Create Erc20Token from its wire shape (API response).
   *
   * The typed door that {@link Erc20Token.fromJSON} cannot be: `Erc20TokenJSON`
   * names the concrete config shape, so no cast is needed to reach it. Prefer
   * this over `fromJSON` whenever the payload came from `apiClient` or another
   * JSON boundary and is known to be an ERC-20 token.
   *
   * @param json - Wire payload, as produced by `serializeErc20Token`
   * @returns Erc20Token instance
   * @throws Error if tokenType is not 'erc20'
   *
   * @example
   * ```typescript
   * const { data } = await apiClient.get('/api/v1/tokens/erc20/...');
   * const token = Erc20Token.fromWire(data);
   * console.log(token.address); // '0x...'
   * ```
   */
  static fromWire(json: Erc20TokenJSON): Erc20Token {
    // Statically dead given the literal type, but this is a JSON boundary —
    // the type is a claim about the payload, not a guarantee.
    if (json.tokenType !== 'erc20') {
      throw new Error(`Expected tokenType 'erc20', got '${json.tokenType}'`);
    }

    return new Erc20Token({
      id: json.id,
      name: json.name,
      symbol: json.symbol,
      decimals: json.decimals,
      logoUrl: json.logoUrl,
      coingeckoId: json.coingeckoId,
      marketCap: json.marketCap,
      tokenHash: json.tokenHash,
      config: Erc20TokenConfig.fromJSON(json.config),
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
    });
  }
}
