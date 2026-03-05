/**
 * Close Order Domain Event Types and Serialization
 *
 * Re-exports from @midcurve/services where the canonical implementation now lives.
 * This file preserves backward compatibility for existing consumers within onchain-data.
 */

export {
  // Functions
  buildCloseOrderEvent,
  serializeCloseOrderEvent,
  triggerModeToString,
  swapDirectionToString,
  // Constants
  CLOSER_LIFECYCLE_EVENT_ABIS,
} from '@midcurve/services';

export type {
  // Event types
  CloseOrderOnChainEventType as CloseOrderEventType,
  TriggerModeString,
  SwapDirectionString,
  // Event envelope
  CloseOrderDomainEvent,
  // Payload types
  CloseOrderRegisteredOnChainPayload as OrderRegisteredPayload,
  CloseOrderCancelledOnChainPayload as OrderCancelledPayload,
  CloseOrderExecutedOnChainPayload as OrderExecutedPayload,
  OrderOperatorUpdatedPayload,
  OrderPayoutUpdatedPayload,
  OrderTriggerTickUpdatedPayload,
  OrderValidUntilUpdatedPayload,
  OrderSlippageUpdatedPayload,
  OrderSwapIntentUpdatedPayload,
  // Typed events
  OrderRegisteredEvent,
  OrderCancelledEvent,
  OrderExecutedEvent,
  OrderOperatorUpdatedEvent,
  OrderPayoutUpdatedEvent,
  OrderTriggerTickUpdatedEvent,
  OrderValidUntilUpdatedEvent,
  OrderSlippageUpdatedEvent,
  OrderSwapIntentUpdatedEvent,
  AnyCloseOrderEvent,
  // Raw log type
  RawEventLog,
} from '@midcurve/services';
