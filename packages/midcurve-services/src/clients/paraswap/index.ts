/**
 * ParaSwap Client Exports
 */

// Production ParaSwap client
export {
  ParaswapClient,
  getParaswapClient,
  ParaswapApiError,
  ParaswapChainNotSupportedError,
  type ParaswapQuoteRequest,
  type ParaswapQuoteResult,
  type ParaswapBuildTxRequest,
  type ParaswapTransactionData,
  type ParaswapTransactionResult,
  type ParaswapSwapParams,
} from './paraswap-client.js';

// Mock ParaSwap client for local chain testing
export {
  MockParaswapClient,
  getMockParaswapClient,
  resetMockParaswapClient,
  type MockParaswapQuoteRequest,
} from './mock-paraswap-client.js';

// Swap client factory (selects real or mock based on chain)
export { getSwapClient, type SwapClient } from './swap-client-factory.js';
