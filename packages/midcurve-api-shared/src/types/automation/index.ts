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

// Gas Readiness (per-chain close-order execution funding)
export {
  GAS_READINESS_STATUSES,
  type GasReadinessStatus,
  GAS_READINESS_UNAVAILABLE_REASONS,
  type GasReadinessUnavailableReason,
  type SerializedTreasuryDeployTransaction,
  type SerializedOperatorFundingTransaction,
  type SerializedGasReadinessTreasury,
  type GasReadinessData,
  type GetGasReadinessResponse,
  GasReadinessQuerySchema,
  type GasReadinessQuery,
  RegisterTreasuryBodySchema,
  type RegisterTreasuryBody,
  type RegisterTreasuryResponseData,
  type RegisterTreasuryResponse,
} from './gas-readiness.js';

// Close Orders
export {
  CLOSE_ORDER_TYPES,
  type CloseOrderType,
  AUTOMATION_STATES,
  type AutomationState,
  TRIGGER_MODES,
  type TriggerMode,
  SWAP_DIRECTIONS,
  type SwapDirection,
  type SwapConfig,
  type SerializedCloseOrder,
  CloseOrderHashSchema,
  type ListCloseOrdersResponse,
  type GetCloseOrderResponse,
  SetAutomationStateBodySchema,
  type SetAutomationStateBody,
  type SetAutomationStateResponse,
} from './close-orders.js';

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
