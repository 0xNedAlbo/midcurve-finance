/**
 * Automation Endpoint Types
 *
 * Types for position automation features (contracts, close orders).
 */

// Contracts
export {
  CONTRACT_TYPES,
  type ContractType,
  type SerializedAutomationContract,
  type SerializedUniswapV3ContractConfig,
  type SerializedUniswapV3ContractState,
  // Deploy
  type DeployContractRequest,
  DeployContractRequestSchema,
  type DeployContractInput,
  type DeployContractResponseData,
  type DeployContractResponse,
  // List
  type ListContractsRequest,
  ListContractsQuerySchema,
  type ListContractsInput,
  type ListContractsResponse,
  // Get by chain
  type GetContractByChainParams,
  type GetContractByChainRequest,
  GetContractByChainQuerySchema,
  type GetContractByChainInput,
  type GetContractByChainResponse,
  // Status
  type ContractDeploymentStatus,
  type GetContractStatusResponse,
  // Bytecode (user-signed deployment)
  type GetContractBytecodeRequest,
  GetContractBytecodeQuerySchema,
  type GetContractBytecodeInput,
  type GetContractBytecodeResponseData,
  type GetContractBytecodeResponse,
  // Notify Contract Deployed (user signed on-chain)
  type NotifyContractDeployedRequest,
  NotifyContractDeployedRequestSchema,
  type NotifyContractDeployedInput,
  type NotifyContractDeployedResponse,
} from './contracts.js';

// Close Orders
export {
  CLOSE_ORDER_TYPES,
  type CloseOrderType,
  CLOSE_ORDER_STATUSES,
  type CloseOrderStatus,
  TRIGGER_MODES,
  type TriggerMode,
  type SerializedCloseOrder,
  type SerializedUniswapV3CloseOrderConfig,
  type SerializedUniswapV3CloseOrderState,
  // Register
  type RegisterCloseOrderRequest,
  RegisterCloseOrderRequestSchema,
  type RegisterCloseOrderInput,
  type RegisterCloseOrderResponseData,
  type RegisterCloseOrderResponse,
  // List
  type ListCloseOrdersRequest,
  ListCloseOrdersQuerySchema,
  type ListCloseOrdersInput,
  type ListCloseOrdersResponse,
  // Get
  type GetCloseOrderResponse,
  // Update
  type UpdateCloseOrderRequest,
  UpdateCloseOrderRequestSchema,
  type UpdateCloseOrderInput,
  type UpdateCloseOrderResponse,
  // Cancel
  type CancelCloseOrderResponse,
  // Status
  type CloseOrderRegistrationStatus,
  type GetCloseOrderStatusResponse,
  // Notify Order Registered (user signed on-chain)
  type NotifyOrderRegisteredRequest,
  NotifyOrderRegisteredRequestSchema,
  type NotifyOrderRegisteredInput,
  type NotifyOrderRegisteredResponse,
  // Notify Order Cancelled (user signed on-chain)
  type NotifyOrderCancelledRequest,
  NotifyOrderCancelledRequestSchema,
  type NotifyOrderCancelledInput,
  type NotifyOrderCancelledResponse,
} from './close-orders.js';

// Wallet
export {
  type AutowalletChainBalance,
  type AutowalletActivity,
  // Get
  type GetAutowalletResponseData,
  type GetAutowalletResponse,
  // Refund
  type RefundAutowalletRequest,
  RefundAutowalletRequestSchema,
  type RefundAutowalletInput,
  type RefundAutowalletResponseData,
  type RefundAutowalletResponse,
  // Refund Status
  type RefundOperationStatus,
  type GetRefundStatusResponse,
} from './wallet.js';
