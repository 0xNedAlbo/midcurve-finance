/**
 * Router Supported Chains API Types
 *
 * Types for querying which chains have the MidcurveSwapRouter deployed.
 */

import type { ApiResponse } from '../common/index.js';

/**
 * Info about a chain that supports MidcurveSwapRouter
 */
export interface RouterSupportedChainInfo {
  /** EVM chain ID */
  chainId: number;

  /** MidcurveSwapRouter contract address on this chain */
  swapRouterAddress: string;
}

/**
 * GET /api/v1/swap/router-supported-chains - Response data
 */
export type RouterSupportedChainsData = RouterSupportedChainInfo[];

/**
 * GET /api/v1/swap/router-supported-chains - Response
 */
export type GetRouterSupportedChainsResponse = ApiResponse<RouterSupportedChainsData>;
