/**
 * Swap API Types
 *
 * Types for token swapping functionality via MidcurveSwapRouter.
 */

// Token types
export {
  LOCAL_CHAIN_ID,
  type SwapToken,
  type GetSwapTokensData,
  type GetSwapTokensResponse,
} from './tokens.js';

// MidcurveSwapRouter quote types (used by SwapDialog)
export {
  type RouterSwapHop,
  type EncodedSwapHop,
  type RouterQuoteDiagnostics,
  type RouterSwapQuoteData,
  type GetRouterSwapQuoteResponse,
  type GetRouterSwapQuoteQuery,
  GetRouterSwapQuoteQuerySchema,
} from './router-quote.js';

// MidcurveSwapRouter supported chains types
export {
  type RouterSupportedChainInfo,
  type RouterSupportedChainsData,
  type GetRouterSupportedChainsResponse,
} from './router-supported-chains.js';
