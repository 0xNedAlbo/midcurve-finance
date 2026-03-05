/**
 * Close Order Domain Event Types (Consumer-side)
 *
 * Re-exports from @midcurve/services where the canonical types now live.
 * Previously duplicated here because business-logic couldn't import from onchain-data.
 */

export type {
  CloseOrderOnChainEventType as CloseOrderEventType,
  TriggerModeString,
  SwapDirectionString,
  CloseOrderDomainEvent,
  CloseOrderRegisteredOnChainPayload as OrderRegisteredPayload,
  CloseOrderCancelledOnChainPayload as OrderCancelledPayload,
  CloseOrderExecutedOnChainPayload as OrderExecutedPayload,
  OrderOperatorUpdatedPayload,
  OrderPayoutUpdatedPayload,
  OrderTriggerTickUpdatedPayload,
  OrderValidUntilUpdatedPayload,
  OrderSlippageUpdatedPayload,
  OrderSwapIntentUpdatedPayload,
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
} from '@midcurve/services';
