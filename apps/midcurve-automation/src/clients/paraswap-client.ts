/**
 * Paraswap Client Re-exports
 *
 * Re-exports the shared ParaswapClient from @midcurve/services and provides
 * a factory function to select between real ParaSwap API and mock client
 * for local chain testing.
 *
 * The real ParaswapClient is implemented in @midcurve/services for sharing
 * between midcurve-api and midcurve-automation.
 */

import {
  getParaswapClient,
  type ParaswapSwapParams,
  type ParaswapQuoteRequest,
} from '@midcurve/services';
import { PARASWAP_SUPPORTED_CHAIN_IDS } from '@midcurve/api-shared';
import { getMockParaswapClient, type MockParaswapClient } from './mock-paraswap-client';

const LOCAL_CHAIN_ID = 31337;

// Re-export types and constants from shared packages
export { PARASWAP_SUPPORTED_CHAIN_IDS as PARASWAP_SUPPORTED_CHAINS };
export type { ParaswapSwapParams };

/**
 * Interface that both ParaswapClient and MockParaswapClient implement
 */
export interface SwapClient {
  isChainSupported(chainId: number): boolean;
  getSwapParams(request: ParaswapQuoteRequest): Promise<ParaswapSwapParams>;
}

/**
 * Get the appropriate swap client for a chain
 *
 * Returns MockParaswapClient for local chain (31337), ParaswapClient otherwise.
 * This allows seamless local testing with mockUSD while using real Paraswap
 * in production.
 */
export function getSwapClient(chainId: number): SwapClient {
  if (chainId === LOCAL_CHAIN_ID) {
    return getMockParaswapClient() as SwapClient;
  }
  return getParaswapClient();
}

export type { MockParaswapClient };
