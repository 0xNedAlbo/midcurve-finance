/**
 * UniswapV3 Automation Types
 *
 * Exports all UniswapV3-specific automation types.
 */

// Close Order
export {
  UniswapV3CloseOrderConfig,
  type UniswapV3CloseOrderConfigData,
  type UniswapV3CloseOrderConfigJSON,
  type TriggerMode,
} from './uniswapv3-close-order-config.js';

export {
  UniswapV3CloseOrderState,
  type UniswapV3CloseOrderStateData,
  type UniswapV3CloseOrderStateJSON,
} from './uniswapv3-close-order-state.js';

export {
  UniswapV3CloseOrder,
  type UniswapV3CloseOrderParams,
  type UniswapV3CloseOrderRow,
} from './uniswapv3-close-order.js';

// Contract
export {
  UniswapV3ContractConfig,
  type UniswapV3ContractConfigData,
  type UniswapV3ContractConfigJSON,
} from './uniswapv3-contract-config.js';

export {
  UniswapV3ContractState,
  type UniswapV3ContractStateData,
  type UniswapV3ContractStateJSON,
} from './uniswapv3-contract-state.js';

export {
  UniswapV3AutomationContract,
  type UniswapV3AutomationContractParams,
  type UniswapV3AutomationContractRow,
} from './uniswapv3-automation-contract.js';
