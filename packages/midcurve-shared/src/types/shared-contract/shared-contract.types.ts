// ============================================================================
// Shared Contract Types
// ============================================================================

/**
 * Platform discriminator for shared contracts
 * Enables platform-independent contract registry
 */
export const SharedContractType = {
  EVM_SMART_CONTRACT: 'evm-smart-contract',
} as const;

export type SharedContractType =
  (typeof SharedContractType)[keyof typeof SharedContractType];

/**
 * Known shared contract names
 * Each name maps to a specific contract implementation
 */
export const SharedContractName = {
  UNISWAP_V3_POSITION_CLOSER: 'UniswapV3PositionCloser',
  MIDCURVE_SWAP_ROUTER: 'MidcurveSwapRouter',
} as const;

export type SharedContractName =
  (typeof SharedContractName)[keyof typeof SharedContractName];

/**
 * Shared contract status for lifecycle management
 */
export type SharedContractStatus = 'active' | 'deprecated' | 'disabled';

/**
 * Base data interface for all shared contracts (JSON-serializable)
 */
export interface SharedContractData<TConfig = unknown> {
  id: string;
  sharedContractType: SharedContractType;
  sharedContractName: SharedContractName;
  interfaceVersionMajor: number;
  interfaceVersionMinor: number;
  sharedContractHash: string;
  config: TConfig;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * JSON representation of SharedContractData (for API serialization)
 */
export interface SharedContractJSON<TConfigJSON = unknown> {
  id: string;
  sharedContractType: SharedContractType;
  sharedContractName: SharedContractName;
  interfaceVersionMajor: number;
  interfaceVersionMinor: number;
  sharedContractHash: string;
  config: TConfigJSON;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
