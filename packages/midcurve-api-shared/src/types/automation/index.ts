/**
 * Automation Endpoint Types
 *
 * Types for position automation features (shared contracts, close orders, wallet).
 */

// Shared Contracts (new DB-backed types)
export {
  type ContractVersion,
  type VersionedSharedContractInfo,
  type SharedContractsMap,
  type GetPositionSharedContractsResponseData,
  type GetPositionSharedContractsResponse,
  type GetChainSharedContractsResponseData,
  type GetChainSharedContractsResponse,
  // Deprecated (JSON-config-based)
  SHARED_CONTRACT_PROTOCOLS,
  type SharedContractProtocol,
  type SharedContractInfo,
  type GetSharedContractResponse,
  type ListSharedContractsResponseData,
  type ListSharedContractsResponse,
} from './contracts.js';

// Close Orders
export {
  CLOSE_ORDER_TYPES,
  type CloseOrderType,
  CLOSE_ORDER_STATUSES,
  type CloseOrderStatus,
  MONITORING_STATES,
  type MonitoringState,
  TRIGGER_MODES,
  type TriggerMode,
  SWAP_DIRECTIONS,
  type SwapDirection,
  type SwapConfig,
  type SerializedCloseOrder,
  CloseOrderHashSchema,
  type ListCloseOrdersResponse,
  type GetCloseOrderResponse,
} from './close-orders.js';

// Wallet
export {
  type AutowalletChainBalance,
  type AutowalletActivity,
  // Get
  type GetAutowalletResponseData,
  type GetAutowalletResponse,
  // Create
  type CreateAutowalletResponseData,
  type CreateAutowalletResponse,
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

// Logs
export {
  AUTOMATION_LOG_LEVELS,
  type AutomationLogLevel,
  AUTOMATION_LOG_LEVEL_NAMES,
  type AutomationLogLevelName,
  AUTOMATION_LOG_TYPES,
  type AutomationLogType,
  type AutomationPlatform,
  type AutomationLogContextBase,
  type AutomationLogContextEvm,
  type AutomationLogContext,
  type AutomationLogData,
  // List
  ListAutomationLogsQuerySchema,
  type ListAutomationLogsQuery,
  type ListAutomationLogsResponseData,
  type ListAutomationLogsResponse,
  // Get
  type GetAutomationLogResponse,
  // Utils
  getAutomationLogLevelName,
} from './logs.js';
