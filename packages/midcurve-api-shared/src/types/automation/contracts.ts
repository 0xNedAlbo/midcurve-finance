/**
 * Automation Shared Contract Endpoint Types
 *
 * Types for querying pre-deployed shared automation contracts.
 * In the shared contract model, contracts are deployed once per chain
 * and shared by all users.
 */

import type { ApiResponse } from '../common/index.js';

// =============================================================================
// NEW TYPES (Database-backed versioned contracts)
// =============================================================================

/**
 * Contract version information
 */
export interface ContractVersion {
  major: number;
  minor: number;
}

/**
 * Shared contract info with version (new DB-backed model)
 *
 * Note: positionManager is NOT included - UI has this locally
 * in apps/midcurve-ui/src/config/contracts/nonfungible-position-manager.ts
 */
export interface VersionedSharedContractInfo {
  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Shared contract address (EIP-55 checksummed)
   */
  contractAddress: string;

  /**
   * Contract interface version
   */
  version: ContractVersion;

  /**
   * Semantic hash for lookups (e.g., 'evm/uniswap-v3-position-closer/1/0')
   */
  sharedContractHash: string;
}

/**
 * Map of contract name to contract info
 * Keyed by SharedContractName values (e.g., 'UniswapV3PositionCloser')
 */
export type SharedContractsMap = {
  [contractName: string]: VersionedSharedContractInfo;
};

/**
 * GET /api/v1/positions/uniswapv3/[chainId]/[nftId]/close-orders/shared-contracts - Response Data
 *
 * Returns shared contracts available for a position's chain.
 * Map structure enables lookup by contract name and future extensibility.
 */
export interface GetPositionSharedContractsResponseData {
  /**
   * Map of contract name to contract info
   */
  contracts: SharedContractsMap;
}

/**
 * GET /api/v1/positions/uniswapv3/[chainId]/[nftId]/close-orders/shared-contracts - Response
 */
export type GetPositionSharedContractsResponse =
  ApiResponse<GetPositionSharedContractsResponseData>;

// =============================================================================
// DEPRECATED TYPES (JSON-config-based, to be removed)
// =============================================================================

/**
 * Protocol type for shared contracts
 * @deprecated Use SharedContractName from @midcurve/shared instead
 */
export const SHARED_CONTRACT_PROTOCOLS = ['uniswapv3'] as const;
/**
 * @deprecated Use SharedContractName from @midcurve/shared instead
 */
export type SharedContractProtocol = (typeof SHARED_CONTRACT_PROTOCOLS)[number];

/**
 * Shared contract info for a specific chain
 * @deprecated Use VersionedSharedContractInfo instead
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

/**
 * GET /api/v1/automation/shared-contracts/[chainId] - Response
 *
 * Returns the shared contract configuration for a specific chain.
 * @deprecated Use GetPositionSharedContractsResponse instead
 */
export type GetSharedContractResponse = ApiResponse<SharedContractInfo>;

/**
 * Response data for listing all shared contracts
 * @deprecated Use GetPositionSharedContractsResponseData instead
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
 * @deprecated Use GetPositionSharedContractsResponse instead
 */
export type ListSharedContractsResponse = ApiResponse<ListSharedContractsResponseData>;
