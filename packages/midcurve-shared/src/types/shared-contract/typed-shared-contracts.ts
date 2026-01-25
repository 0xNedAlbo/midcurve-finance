// ============================================================================
// Typed Shared Contract Aliases
// ============================================================================

import type { SharedContractData, SharedContractJSON } from './shared-contract.types';
import type {
  EvmSmartContractConfigData,
  EvmSmartContractConfigJSON,
} from './evm/evm-smart-contract-config';

/**
 * EVM Shared Contract with typed config
 */
export type EvmSharedContract = SharedContractData<EvmSmartContractConfigData>;
export type EvmSharedContractJSON = SharedContractJSON<EvmSmartContractConfigJSON>;

/**
 * UniswapV3PositionCloser contract on EVM chains
 */
export type UniswapV3PositionCloserContract = EvmSharedContract;
export type UniswapV3PositionCloserContractJSON = EvmSharedContractJSON;
