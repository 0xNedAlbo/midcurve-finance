/**
 * Quote Token Result Types
 *
 * Types for quote token determination results.
 * Used when determining which token in a pool pair is the quote token.
 */

// ============================================================================
// PROTOCOL TYPE
// ============================================================================

/**
 * Supported protocols for quote token results
 */
export type QuoteTokenResultProtocol = 'uniswapv3';

// ============================================================================
// MATCH TYPE
// ============================================================================

/**
 * How the quote token was determined
 */
export type QuoteTokenMatchType = 'user_preference' | 'default' | 'fallback';

// ============================================================================
// QUOTE TOKEN RESULT INTERFACE
// ============================================================================

/**
 * QuoteTokenResult
 *
 * Result of determining which token is the quote token in a pool pair.
 *
 * @example
 * ```typescript
 * const result: QuoteTokenResult = {
 *   protocol: 'uniswapv3',
 *   isToken0Quote: true,
 *   quoteTokenId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
 *   baseTokenId: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',  // WETH
 *   quoteTokenSymbol: 'USDC',
 *   baseTokenSymbol: 'WETH',
 *   matchedBy: 'default',
 * };
 * ```
 */
export interface QuoteTokenResult {
  /**
   * Protocol identifier
   */
  protocol: QuoteTokenResultProtocol;

  /**
   * Whether token0 is the quote token
   * - true: token0 = quote, token1 = base
   * - false: token1 = quote, token0 = base
   */
  isToken0Quote: boolean;

  /**
   * Quote token identifier (protocol-specific)
   * - EVM: normalized address (0x...)
   * - Solana: mint address (base58)
   */
  quoteTokenId: string;

  /**
   * Base token identifier (protocol-specific)
   */
  baseTokenId: string;

  /**
   * Optional: Quote token symbol for display
   */
  quoteTokenSymbol?: string;

  /**
   * Optional: Base token symbol for display
   */
  baseTokenSymbol?: string;

  /**
   * How the quote token was determined
   */
  matchedBy: QuoteTokenMatchType;
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

/**
 * QuoteTokenResultJSON
 *
 * JSON representation for API responses.
 * (Same as QuoteTokenResult since no Date or bigint fields)
 */
export interface QuoteTokenResultJSON {
  protocol: QuoteTokenResultProtocol;
  isToken0Quote: boolean;
  quoteTokenId: string;
  baseTokenId: string;
  quoteTokenSymbol?: string;
  baseTokenSymbol?: string;
  matchedBy: QuoteTokenMatchType;
}

// ============================================================================
// PROTOCOL-SPECIFIC TYPES
// ============================================================================

/**
 * UniswapV3QuoteTokenResult
 *
 * Quote token result with protocol narrowed to 'uniswapv3'.
 */
export interface UniswapV3QuoteTokenResult extends QuoteTokenResult {
  protocol: 'uniswapv3';
}

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

/**
 * Convert QuoteTokenResult to JSON.
 * (Identity function since no conversion needed)
 */
export function quoteTokenResultToJSON(
  result: QuoteTokenResult
): QuoteTokenResultJSON {
  return { ...result };
}

/**
 * Create QuoteTokenResult from JSON.
 * (Identity function since no conversion needed)
 */
export function quoteTokenResultFromJSON(
  json: QuoteTokenResultJSON
): QuoteTokenResult {
  return { ...json };
}

// ============================================================================
// FACTORY HELPERS
// ============================================================================

/**
 * Check if a protocol is supported.
 */
export function isQuoteTokenResultProtocolSupported(
  protocol: string
): protocol is QuoteTokenResultProtocol {
  return ['uniswapv3'].includes(protocol);
}

/**
 * Create a UniswapV3 quote token result.
 */
export function createUniswapV3QuoteTokenResult(
  params: Omit<UniswapV3QuoteTokenResult, 'protocol'>
): UniswapV3QuoteTokenResult {
  return {
    protocol: 'uniswapv3',
    ...params,
  };
}
