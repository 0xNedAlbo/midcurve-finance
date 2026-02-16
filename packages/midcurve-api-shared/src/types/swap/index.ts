/**
 * Swap API Types
 *
 * Types for token swapping functionality.
 * Includes ParaSwap (legacy, used by SwapWidget) and MidcurveSwapRouter (SwapDialog).
 */

// Token list types (shared)
export {
  PARASWAP_SUPPORTED_CHAIN_IDS,
  type ParaswapSupportedChainId,
  LOCAL_CHAIN_ID,
  isParaswapSupportedChain,
  isSwapSupportedChain,
  type GetSwapTokensQuery,
  GetSwapTokensQuerySchema,
  type SwapToken,
  type GetSwapTokensData,
  type GetSwapTokensResponse,
} from './tokens.js';

// ParaSwap quote types (used by SwapWidget)
export {
  type SwapSide,
  type GetSwapQuoteQuery,
  GetSwapQuoteQuerySchema,
  type ParaswapPriceRoute,
  type SwapQuoteData,
  type GetSwapQuoteResponse,
} from './quote.js';

// ParaSwap transaction types (used by SwapWidget)
export {
  type BuildSwapTransactionRequest,
  BuildSwapTransactionRequestSchema,
  type SwapTransactionData,
  type BuildSwapTransactionResponse,
} from './transaction.js';

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
