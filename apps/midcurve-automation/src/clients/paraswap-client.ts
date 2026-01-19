/**
 * Paraswap Client Re-exports
 *
 * Re-exports the shared ParaswapClient and MockParaswapClient from @midcurve/services.
 * The services package provides:
 * - ParaswapClient: Real ParaSwap API client for production chains
 * - MockParaswapClient: Mock client for local chain testing
 * - getSwapClient: Factory function that selects the appropriate client
 */

import {
  getParaswapClient,
  getSwapClient as getSwapClientFromServices,
  getMockParaswapClient,
  type ParaswapSwapParams,
  type ParaswapQuoteRequest,
  type SwapClient,
  type MockParaswapClient,
} from '@midcurve/services';
import { PARASWAP_SUPPORTED_CHAIN_IDS, LOCAL_CHAIN_ID } from '@midcurve/api-shared';

// Re-export types and constants from shared packages
export { PARASWAP_SUPPORTED_CHAIN_IDS as PARASWAP_SUPPORTED_CHAINS };
export { LOCAL_CHAIN_ID };
export type { ParaswapSwapParams, ParaswapQuoteRequest, SwapClient, MockParaswapClient };

// Re-export factory functions from services
export { getParaswapClient, getMockParaswapClient };

/**
 * Get the appropriate swap client for a chain
 *
 * Returns MockParaswapClient for local chain (31337), ParaswapClient otherwise.
 * This allows seamless local testing with mockUSD while using real Paraswap
 * in production.
 */
export function getSwapClient(chainId: number): SwapClient {
  return getSwapClientFromServices(chainId);
}
