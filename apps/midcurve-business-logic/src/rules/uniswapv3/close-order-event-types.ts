/**
 * Close Order Domain Event Types (Consumer-side)
 *
 * Mirrors the wire format published by the onchain-data service
 * (apps/midcurve-onchain-data/src/mq/close-order-messages.ts).
 *
 * Duplicated here because the business-logic app cannot import from
 * the onchain-data app directly.
 */

// ============================================================
// String Literal Unions
// ============================================================

export type TriggerModeString = 'LOWER' | 'UPPER';

export type SwapDirectionString = 'NONE' | 'TOKEN0_TO_1' | 'TOKEN1_TO_0';

// ============================================================
// Event Type Discriminator
// ============================================================

export type CloseOrderEventType =
  | 'close-order.uniswapv3.registered'
  | 'close-order.uniswapv3.cancelled'
  | 'close-order.uniswapv3.operator-updated'
  | 'close-order.uniswapv3.payout-updated'
  | 'close-order.uniswapv3.trigger-tick-updated'
  | 'close-order.uniswapv3.valid-until-updated'
  | 'close-order.uniswapv3.slippage-updated'
  | 'close-order.uniswapv3.swap-intent-updated';

// ============================================================
// Domain Event Envelope
// ============================================================

export interface CloseOrderDomainEvent<
  T extends CloseOrderEventType,
  P,
> {
  type: T;
  chainId: number;
  contractAddress: string;
  nftId: string;
  triggerMode: TriggerModeString;
  payload: P;
  blockNumber: string;
  transactionHash: string;
  logIndex: number;
  receivedAt: string;
}

// ============================================================
// Payload Types
// ============================================================

export interface OrderRegisteredPayload {
  owner: string;
  pool: string;
  operator: string;
  payout: string;
  triggerTick: number;
  validUntil: string;
  slippageBps: number;
  swapDirection: SwapDirectionString;
  swapSlippageBps: number;
}

export interface OrderCancelledPayload {
  owner: string;
}

export interface OrderOperatorUpdatedPayload {
  oldOperator: string;
  newOperator: string;
}

export interface OrderPayoutUpdatedPayload {
  oldPayout: string;
  newPayout: string;
}

export interface OrderTriggerTickUpdatedPayload {
  oldTick: number;
  newTick: number;
}

export interface OrderValidUntilUpdatedPayload {
  oldValidUntil: string;
  newValidUntil: string;
}

export interface OrderSlippageUpdatedPayload {
  oldSlippageBps: number;
  newSlippageBps: number;
}

export interface OrderSwapIntentUpdatedPayload {
  oldDirection: SwapDirectionString;
  newDirection: SwapDirectionString;
  swapSlippageBps: number;
}

// ============================================================
// Typed Event Aliases
// ============================================================

export type OrderRegisteredEvent = CloseOrderDomainEvent<
  'close-order.uniswapv3.registered',
  OrderRegisteredPayload
>;
export type OrderCancelledEvent = CloseOrderDomainEvent<
  'close-order.uniswapv3.cancelled',
  OrderCancelledPayload
>;
export type OrderOperatorUpdatedEvent = CloseOrderDomainEvent<
  'close-order.uniswapv3.operator-updated',
  OrderOperatorUpdatedPayload
>;
export type OrderPayoutUpdatedEvent = CloseOrderDomainEvent<
  'close-order.uniswapv3.payout-updated',
  OrderPayoutUpdatedPayload
>;
export type OrderTriggerTickUpdatedEvent = CloseOrderDomainEvent<
  'close-order.uniswapv3.trigger-tick-updated',
  OrderTriggerTickUpdatedPayload
>;
export type OrderValidUntilUpdatedEvent = CloseOrderDomainEvent<
  'close-order.uniswapv3.valid-until-updated',
  OrderValidUntilUpdatedPayload
>;
export type OrderSlippageUpdatedEvent = CloseOrderDomainEvent<
  'close-order.uniswapv3.slippage-updated',
  OrderSlippageUpdatedPayload
>;
export type OrderSwapIntentUpdatedEvent = CloseOrderDomainEvent<
  'close-order.uniswapv3.swap-intent-updated',
  OrderSwapIntentUpdatedPayload
>;

// ============================================================
// Discriminated Union
// ============================================================

export type AnyCloseOrderEvent =
  | OrderRegisteredEvent
  | OrderCancelledEvent
  | OrderOperatorUpdatedEvent
  | OrderPayoutUpdatedEvent
  | OrderTriggerTickUpdatedEvent
  | OrderValidUntilUpdatedEvent
  | OrderSlippageUpdatedEvent
  | OrderSwapIntentUpdatedEvent;
