// ============================================================================
// Shared Contract API Types
// ============================================================================

import type {
  SharedContractJSON,
  EvmSmartContractConfigJSON,
} from '@midcurve/shared';

// ============================================================================
// Request Types
// ============================================================================

/**
 * Query parameters for listing shared contracts
 */
export interface ListSharedContractsQuery {
  /** Filter by contract type (e.g., "evm-smart-contract") */
  type?: string;
  /** Filter by contract name (e.g., "UniswapV3PositionCloser") */
  name?: string;
  /** Filter by interface version major */
  versionMajor?: number;
  /** Filter by interface version minor */
  versionMinor?: number;
  /** Filter by chain ID (for EVM contracts) */
  chainId?: number;
  /** Filter by active status (default: true) */
  isActive?: boolean;
}

/**
 * Path parameters for getting a shared contract by hash
 */
export interface GetSharedContractByHashParams {
  /** Semantic hash (e.g., "evm/uniswap-v3-position-closer/1/0") */
  hash: string;
}

/**
 * Path parameters for getting a shared contract by chain
 */
export interface GetSharedContractByChainParams {
  /** Contract name (e.g., "UniswapV3PositionCloser") */
  name: string;
  /** Interface version major */
  versionMajor: number;
  /** Interface version minor */
  versionMinor: number;
  /** Chain ID */
  chainId: number;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Shared contract response data (EVM)
 */
export type EvmSharedContractResponse = SharedContractJSON<EvmSmartContractConfigJSON>;

/**
 * List shared contracts response data
 */
export interface SharedContractListResponseData {
  contracts: EvmSharedContractResponse[];
  total: number;
}

/**
 * Get shared contract response
 */
export type GetSharedContractResponseData = EvmSharedContractResponse;

// ============================================================================
// Convenience Types for Common Queries
// ============================================================================

/**
 * Query to find the contract for a specific order
 * Used when UI needs to interact with an existing order
 */
export interface FindContractForOrderQuery {
  /** Contract name */
  name: string;
  /** Version major from order's automationContractConfig */
  versionMajor: number;
  /** Version minor from order's automationContractConfig */
  versionMinor: number;
  /** Chain ID from order's automationContractConfig */
  chainId: number;
}

/**
 * Query to find the latest active contract version
 * Used when registering new orders
 */
export interface FindLatestContractQuery {
  /** Contract name */
  name: string;
  /** Chain ID */
  chainId: number;
}
