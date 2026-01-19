/**
 * Swap Client Factory
 *
 * Returns the appropriate swap client based on chain ID:
 * - Local chain (31337): MockParaswapClient
 * - Production chains: ParaswapClient
 *
 * This allows the API routes to use a single interface for both
 * production ParaSwap and local mock swaps.
 */

import { isLocalChain } from '../../config/evm.js';
import { getParaswapClient, type ParaswapClient } from './paraswap-client.js';
import { getMockParaswapClient, type MockParaswapClient } from './mock-paraswap-client.js';

/**
 * Union type for swap clients
 * Both clients implement the same core methods: getQuote, buildTransaction, getSwapParams
 */
export type SwapClient = ParaswapClient | MockParaswapClient;

/**
 * Get the appropriate swap client for a chain
 *
 * @param chainId - The chain ID to get a client for
 * @returns ParaswapClient for production chains, MockParaswapClient for local chain
 * @throws Error if local chain is requested but env vars are not set
 */
export function getSwapClient(chainId: number): SwapClient {
  if (isLocalChain(chainId)) {
    return getMockParaswapClient();
  }
  return getParaswapClient();
}
