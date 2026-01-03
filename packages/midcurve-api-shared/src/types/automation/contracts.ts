/**
 * Automation Shared Contract Endpoint Types
 *
 * Types for querying pre-deployed shared automation contracts.
 * In the shared contract model, contracts are deployed once per chain
 * and shared by all users.
 */

import type { ApiResponse } from '../common/index.js';

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Protocol type for shared contracts
 */
export const SHARED_CONTRACT_PROTOCOLS = ['uniswapv3'] as const;
export type SharedContractProtocol = (typeof SHARED_CONTRACT_PROTOCOLS)[number];

/**
 * Shared contract info for a specific chain
 */
export interface SharedContractInfo {
  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Shared contract address
   */
  contractAddress: string;

  /**
   * Position manager (NFPM) address for this chain
   */
  positionManager: string;
}

// =============================================================================
// GET SHARED CONTRACT BY CHAIN
// =============================================================================

/**
 * GET /api/v1/automation/shared-contracts/[chainId] - Response
 *
 * Returns the shared contract configuration for a specific chain.
 */
export type GetSharedContractResponse = ApiResponse<SharedContractInfo>;

// =============================================================================
// LIST SHARED CONTRACTS
// =============================================================================

/**
 * Response data for listing all shared contracts
 */
export interface ListSharedContractsResponseData {
  /**
   * UniswapV3 shared contracts per chain
   */
  uniswapv3: SharedContractInfo[];
}

/**
 * GET /api/v1/automation/shared-contracts - Response
 *
 * Returns all shared contract configurations grouped by protocol.
 */
export type ListSharedContractsResponse = ApiResponse<ListSharedContractsResponseData>;
