/**
 * Close Order Domain Event Types and Serialization
 *
 * Defines structured domain events for UniswapV3PositionCloser lifecycle events.
 * Published to RabbitMQ for downstream processing by business rule consumers.
 *
 * Events covered:
 * - Registration: OrderRegistered, OrderCancelled
 * - Config Updates: OrderOperatorUpdated, OrderPayoutUpdated, OrderTriggerTickUpdated,
 *   OrderValidUntilUpdated, OrderSlippageUpdated, OrderSwapIntentUpdated
 */

import { decodeEventLog } from 'viem';
import { UniswapV3PositionCloserV100Abi } from '@midcurve/shared';

// ============================================================
// Enum Helpers
// ============================================================

export type TriggerModeString = 'LOWER' | 'UPPER';

export function triggerModeToString(value: number | bigint): TriggerModeString {
  return Number(value) === 0 ? 'LOWER' : 'UPPER';
}

export type SwapDirectionString = 'NONE' | 'TOKEN0_TO_1' | 'TOKEN1_TO_0';

export function swapDirectionToString(value: number | bigint): SwapDirectionString {
  const num = Number(value);
  if (num === 1) return 'TOKEN0_TO_1';
  if (num === 2) return 'TOKEN1_TO_0';
  return 'NONE';
}

// ============================================================
// Domain Event Types
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

/**
 * Lifecycle event names from the contract (used for discrimination after decodeEventLog)
 */
const LIFECYCLE_EVENT_NAMES = [
  'OrderRegistered',
  'OrderCancelled',
  'OrderOperatorUpdated',
  'OrderPayoutUpdated',
  'OrderTriggerTickUpdated',
  'OrderValidUntilUpdated',
  'OrderSlippageUpdated',
  'OrderSwapIntentUpdated',
] as const;

type LifecycleEventName = (typeof LIFECYCLE_EVENT_NAMES)[number];

/**
 * Map contract event name to domain event type
 */
const EVENT_NAME_TO_DOMAIN_TYPE: Record<LifecycleEventName, CloseOrderEventType> = {
  OrderRegistered: 'close-order.uniswapv3.registered',
  OrderCancelled: 'close-order.uniswapv3.cancelled',
  OrderOperatorUpdated: 'close-order.uniswapv3.operator-updated',
  OrderPayoutUpdated: 'close-order.uniswapv3.payout-updated',
  OrderTriggerTickUpdated: 'close-order.uniswapv3.trigger-tick-updated',
  OrderValidUntilUpdated: 'close-order.uniswapv3.valid-until-updated',
  OrderSlippageUpdated: 'close-order.uniswapv3.slippage-updated',
  OrderSwapIntentUpdated: 'close-order.uniswapv3.swap-intent-updated',
};

function isLifecycleEventName(name: string): name is LifecycleEventName {
  return LIFECYCLE_EVENT_NAMES.includes(name as LifecycleEventName);
}

// ============================================================
// Domain Event Envelope
// ============================================================

export interface CloseOrderDomainEvent<T extends CloseOrderEventType, P> {
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
}

// ============================================================
// Typed Event Aliases
// ============================================================

export type OrderRegisteredEvent = CloseOrderDomainEvent<'close-order.uniswapv3.registered', OrderRegisteredPayload>;
export type OrderCancelledEvent = CloseOrderDomainEvent<'close-order.uniswapv3.cancelled', OrderCancelledPayload>;
export type OrderOperatorUpdatedEvent = CloseOrderDomainEvent<'close-order.uniswapv3.operator-updated', OrderOperatorUpdatedPayload>;
export type OrderPayoutUpdatedEvent = CloseOrderDomainEvent<'close-order.uniswapv3.payout-updated', OrderPayoutUpdatedPayload>;
export type OrderTriggerTickUpdatedEvent = CloseOrderDomainEvent<'close-order.uniswapv3.trigger-tick-updated', OrderTriggerTickUpdatedPayload>;
export type OrderValidUntilUpdatedEvent = CloseOrderDomainEvent<'close-order.uniswapv3.valid-until-updated', OrderValidUntilUpdatedPayload>;
export type OrderSlippageUpdatedEvent = CloseOrderDomainEvent<'close-order.uniswapv3.slippage-updated', OrderSlippageUpdatedPayload>;
export type OrderSwapIntentUpdatedEvent = CloseOrderDomainEvent<'close-order.uniswapv3.swap-intent-updated', OrderSwapIntentUpdatedPayload>;

export type AnyCloseOrderEvent =
  | OrderRegisteredEvent
  | OrderCancelledEvent
  | OrderOperatorUpdatedEvent
  | OrderPayoutUpdatedEvent
  | OrderTriggerTickUpdatedEvent
  | OrderValidUntilUpdatedEvent
  | OrderSlippageUpdatedEvent
  | OrderSwapIntentUpdatedEvent;

// ============================================================
// Extract Lifecycle Event ABIs
// ============================================================

/**
 * Filtered ABI containing only the 8 lifecycle events.
 * Used for watchEvent subscriptions and decodeEventLog.
 */
export const CLOSER_LIFECYCLE_EVENT_ABIS = UniswapV3PositionCloserV100Abi.filter(
  (item) => item.type === 'event' && isLifecycleEventName(item.name)
);

// ============================================================
// Event Construction
// ============================================================

/**
 * Raw log shape from viem (both watchEvent and getLogs)
 */
export interface RawEventLog {
  address: string;
  topics: [`0x${string}`, ...`0x${string}`[]] | readonly [`0x${string}`, ...`0x${string}`[]];
  data: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
  removed?: boolean;
}

/**
 * Build a typed domain event from a raw viem log.
 *
 * Uses decodeEventLog with the existing V100 ABI for type-safe decoding.
 *
 * @returns Typed domain event, or null if log is not a recognized lifecycle event
 */
export function buildCloseOrderEvent(
  chainId: number,
  contractAddress: string,
  rawLog: RawEventLog
): AnyCloseOrderEvent | null {
  // Skip removed/reorged logs
  if (rawLog.removed) return null;

  let decoded;
  try {
    decoded = decodeEventLog({
      abi: UniswapV3PositionCloserV100Abi,
      data: rawLog.data,
      topics: rawLog.topics as [`0x${string}`, ...`0x${string}`[]],
    });
  } catch {
    // Not a recognized event from our ABI
    return null;
  }

  const eventName = decoded.eventName;
  if (!isLifecycleEventName(eventName)) return null;

  const domainType = EVENT_NAME_TO_DOMAIN_TYPE[eventName];
  const args = decoded.args as Record<string, unknown>;

  // All lifecycle events have nftId (topics[1]) and triggerMode (topics[2])
  const nftId = String(args.nftId);
  const triggerMode = triggerModeToString(args.triggerMode as number);

  const envelope = {
    chainId,
    contractAddress,
    nftId,
    triggerMode,
    blockNumber: rawLog.blockNumber.toString(),
    transactionHash: rawLog.transactionHash,
    logIndex: rawLog.logIndex,
    receivedAt: new Date().toISOString(),
  };

  switch (eventName) {
    case 'OrderRegistered':
      return {
        type: domainType as 'close-order.uniswapv3.registered',
        ...envelope,
        payload: {
          owner: args.owner as string,
          pool: args.pool as string,
          operator: args.operator as string,
          payout: args.payout as string,
          triggerTick: Number(args.triggerTick),
          validUntil: String(args.validUntil),
          slippageBps: Number(args.slippageBps),
        },
      };

    case 'OrderCancelled':
      return {
        type: domainType as 'close-order.uniswapv3.cancelled',
        ...envelope,
        payload: {
          owner: args.owner as string,
        },
      };

    case 'OrderOperatorUpdated':
      return {
        type: domainType as 'close-order.uniswapv3.operator-updated',
        ...envelope,
        payload: {
          oldOperator: args.oldOperator as string,
          newOperator: args.newOperator as string,
        },
      };

    case 'OrderPayoutUpdated':
      return {
        type: domainType as 'close-order.uniswapv3.payout-updated',
        ...envelope,
        payload: {
          oldPayout: args.oldPayout as string,
          newPayout: args.newPayout as string,
        },
      };

    case 'OrderTriggerTickUpdated':
      return {
        type: domainType as 'close-order.uniswapv3.trigger-tick-updated',
        ...envelope,
        payload: {
          oldTick: Number(args.oldTick),
          newTick: Number(args.newTick),
        },
      };

    case 'OrderValidUntilUpdated':
      return {
        type: domainType as 'close-order.uniswapv3.valid-until-updated',
        ...envelope,
        payload: {
          oldValidUntil: String(args.oldValidUntil),
          newValidUntil: String(args.newValidUntil),
        },
      };

    case 'OrderSlippageUpdated':
      return {
        type: domainType as 'close-order.uniswapv3.slippage-updated',
        ...envelope,
        payload: {
          oldSlippageBps: Number(args.oldSlippageBps),
          newSlippageBps: Number(args.newSlippageBps),
        },
      };

    case 'OrderSwapIntentUpdated':
      return {
        type: domainType as 'close-order.uniswapv3.swap-intent-updated',
        ...envelope,
        payload: {
          oldDirection: swapDirectionToString(args.oldDirection as number),
          newDirection: swapDirectionToString(args.newDirection as number),
        },
      };

    default:
      return null;
  }
}

// ============================================================
// Serialization
// ============================================================

function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function serializeCloseOrderEvent(event: AnyCloseOrderEvent): Buffer {
  return Buffer.from(JSON.stringify(event, bigIntReplacer));
}
