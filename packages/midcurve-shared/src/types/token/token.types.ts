/**
 * Token type discriminator - identifies the token protocol/platform.
 *
 * - 'erc20': ERC-20 tokens on EVM-compatible chains
 * - 'basic-currency': Platform-agnostic currency references (USD, ETH, BTC)
 */
export type TokenType = 'erc20' | 'basic-currency';

/**
 * JSON representation of a token for API responses.
 *
 * This format matches the expected shape in @midcurve/api-shared
 * (CreateErc20TokenData, etc.) for API compatibility.
 */
export interface TokenJSON {
  id: string;
  tokenType: TokenType;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  coingeckoId?: string;
  marketCap?: number;
  config: Record<string, unknown>;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * Base parameters for constructing any token.
 * Used by BaseToken constructor and extended by concrete token params.
 */
export interface BaseTokenParams {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  coingeckoId?: string;
  marketCap?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Generic database row interface for token factory.
 * Maps to Prisma Token model output.
 */
export interface TokenRow {
  id: string;
  tokenType: string;
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
