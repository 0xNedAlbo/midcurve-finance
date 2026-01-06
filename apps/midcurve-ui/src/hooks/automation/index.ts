/**
 * Automation Hooks
 *
 * React hooks for managing close orders, shared contracts, and wallets.
 *
 * Transaction Signing Architecture:
 * - registerClose, cancelClose, setClose* - User signs via Wagmi (msg.sender == owner)
 * - executeClose - Automation wallet signs (msg.sender == operator)
 *
 * Flow:
 * 1. User initiates action in UI
 * 2. User signs transaction via Wagmi (connected wallet)
 * 3. Wait for on-chain confirmation
 * 4. Notify API to update database / start monitoring
 */

// Close Orders - User signing via Wagmi
export {
  useCreateCloseOrder,
  type RegisterCloseOrderParams,
  type CreateCloseOrderResult,
  type UseCreateCloseOrderResult,
} from './useCreateCloseOrder';

export {
  useCancelCloseOrder,
  type CancelCloseOrderParams,
  type CancelCloseOrderResult,
  type UseCancelCloseOrderResult,
} from './useCancelCloseOrder';

export {
  useUpdateCloseOrder,
  type UpdateType,
  type UpdateBoundsParams,
  type UpdateSlippageParams,
  type UpdatePayoutParams,
  type UpdateValidUntilParams,
  type UpdateCloseOrderParams,
  type UpdateCloseOrderResult,
  type UseUpdateCloseOrderResult,
} from './useUpdateCloseOrder';

// Close Orders - Read only
export { useCloseOrders, useCloseOrder } from './useCloseOrders';

// Automation Logs
export {
  useAutomationLogs,
  type AutomationLogData,
  type ListAutomationLogsResponseData,
} from './useAutomationLogs';

// Shared Contracts
export { useSharedContract } from './useSharedContract';

// Operator Approval (setApprovalForAll on NFPM)
export { useOperatorApproval, type UseOperatorApprovalResult } from './useOperatorApproval';

// Wallet (autowallet)
export {
  useAutowallet,
  useCreateAutowallet,
  useRefundAutowallet,
  useRefundStatus,
  autowalletQueryKey,
} from './useAutowallet';
