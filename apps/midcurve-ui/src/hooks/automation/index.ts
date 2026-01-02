/**
 * Automation Hooks
 *
 * React Query hooks for managing close orders and automation contracts.
 */

// Close Orders
export { useCloseOrders, useCloseOrder } from './useCloseOrders';
export { useCreateCloseOrder, type CreateCloseOrderResult } from './useCreateCloseOrder';
export { useCancelCloseOrder } from './useCancelCloseOrder';
export { useUpdateCloseOrder } from './useUpdateCloseOrder';

// Contracts
export { useAutomationContract, useAutomationContracts } from './useAutomationContract';
