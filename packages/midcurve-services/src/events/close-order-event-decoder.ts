/**
 * Close Order Event Decoder
 *
 * Decodes raw EVM logs from UniswapV3PositionCloser contracts into
 * typed domain events. Shared between onchain-data (polling),
 * API (receipt extraction), and automation (executor receipt).
 *
 * Events covered:
 * - Lifecycle: OrderRegistered, OrderCancelled, OrderExecuted
 * - Config Updates: OrderOperatorUpdated, OrderPayoutUpdated, OrderTriggerTickUpdated,
 *   OrderValidUntilUpdated, OrderSlippageUpdated, OrderSwapIntentUpdated
 */

import { decodeEventLog } from 'viem';
import { UniswapV3PositionCloserV100Abi, UniswapV3VaultPositionCloserV100Abi } from '@midcurve/shared';

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

export type CloseOrderOnChainEventType =
  | 'close-order.registered.uniswapv3'
  | 'close-order.cancelled.uniswapv3'
  | 'close-order.executed.uniswapv3'
  | 'close-order.operator-updated.uniswapv3'
  | 'close-order.payout-updated.uniswapv3'
  | 'close-order.trigger-tick-updated.uniswapv3'
  | 'close-order.valid-until-updated.uniswapv3'
  | 'close-order.slippage-updated.uniswapv3'
  | 'close-order.swap-intent-updated.uniswapv3'
  | 'close-order.registered.uniswapv3-vault'
  | 'close-order.cancelled.uniswapv3-vault'
  | 'close-order.executed.uniswapv3-vault'
  | 'close-order.operator-updated.uniswapv3-vault'
  | 'close-order.payout-updated.uniswapv3-vault'
  | 'close-order.trigger-tick-updated.uniswapv3-vault'
  | 'close-order.valid-until-updated.uniswapv3-vault'
  | 'close-order.slippage-updated.uniswapv3-vault'
  | 'close-order.swap-intent-updated.uniswapv3-vault'
  | 'close-order.shares-updated.uniswapv3-vault';

/**
 * Lifecycle event names from the contract (used for discrimination after decodeEventLog)
 */
const LIFECYCLE_EVENT_NAMES = [
  'OrderRegistered',
  'OrderCancelled',
  'OrderExecuted',
  'OrderOperatorUpdated',
  'OrderPayoutUpdated',
  'OrderTriggerTickUpdated',
  'OrderValidUntilUpdated',
  'OrderSlippageUpdated',
  'OrderSwapIntentUpdated',
  'OrderSharesUpdated',
] as const;

type LifecycleEventName = (typeof LIFECYCLE_EVENT_NAMES)[number];

/**
 * Map contract event name to domain event type (NFT variant)
 */
const NFT_EVENT_NAME_TO_DOMAIN_TYPE: Record<string, CloseOrderOnChainEventType> = {
  OrderRegistered: 'close-order.registered.uniswapv3',
  OrderCancelled: 'close-order.cancelled.uniswapv3',
  OrderExecuted: 'close-order.executed.uniswapv3',
  OrderOperatorUpdated: 'close-order.operator-updated.uniswapv3',
  OrderPayoutUpdated: 'close-order.payout-updated.uniswapv3',
  OrderTriggerTickUpdated: 'close-order.trigger-tick-updated.uniswapv3',
  OrderValidUntilUpdated: 'close-order.valid-until-updated.uniswapv3',
  OrderSlippageUpdated: 'close-order.slippage-updated.uniswapv3',
  OrderSwapIntentUpdated: 'close-order.swap-intent-updated.uniswapv3',
};

/**
 * Map contract event name to domain event type (vault variant)
 */
const VAULT_EVENT_NAME_TO_DOMAIN_TYPE: Record<string, CloseOrderOnChainEventType> = {
  OrderRegistered: 'close-order.registered.uniswapv3-vault',
  OrderCancelled: 'close-order.cancelled.uniswapv3-vault',
  OrderExecuted: 'close-order.executed.uniswapv3-vault',
  OrderOperatorUpdated: 'close-order.operator-updated.uniswapv3-vault',
  OrderPayoutUpdated: 'close-order.payout-updated.uniswapv3-vault',
  OrderTriggerTickUpdated: 'close-order.trigger-tick-updated.uniswapv3-vault',
  OrderValidUntilUpdated: 'close-order.valid-until-updated.uniswapv3-vault',
  OrderSlippageUpdated: 'close-order.slippage-updated.uniswapv3-vault',
  OrderSwapIntentUpdated: 'close-order.swap-intent-updated.uniswapv3-vault',
  OrderSharesUpdated: 'close-order.shares-updated.uniswapv3-vault',
};

function isLifecycleEventName(name: string): name is LifecycleEventName {
  return LIFECYCLE_EVENT_NAMES.includes(name as LifecycleEventName);
}

// ============================================================
// Domain Event Envelope
// ============================================================

export interface CloseOrderDomainEvent<T extends CloseOrderOnChainEventType, P> {
  type: T;
  chainId: number;
  contractAddress: string;
  /** NFT position identifier (present for protocol='uniswapv3') */
  nftId?: string;
  /** Vault address (present for protocol='uniswapv3-vault') */
  vaultAddress?: string;
  /** Share holder address (present for protocol='uniswapv3-vault') */
  ownerAddress?: string;
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

export interface OrderExecutedPayload {
  owner: string;
  payout: string;
  executionTick: number;
  /** Amount of token0 received (as string for bigint) */
  amount0Out: string;
  /** Amount of token1 received (as string for bigint) */
  amount1Out: string;
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

export interface OrderSharesUpdatedPayload {
  oldShares: string;
  newShares: string;
}

// ============================================================
// Typed Event Aliases
// ============================================================

export type OrderRegisteredEvent = CloseOrderDomainEvent<'close-order.registered.uniswapv3', OrderRegisteredPayload>;
export type OrderCancelledEvent = CloseOrderDomainEvent<'close-order.cancelled.uniswapv3', OrderCancelledPayload>;
export type OrderExecutedEvent = CloseOrderDomainEvent<'close-order.executed.uniswapv3', OrderExecutedPayload>;
export type OrderOperatorUpdatedEvent = CloseOrderDomainEvent<'close-order.operator-updated.uniswapv3', OrderOperatorUpdatedPayload>;
export type OrderPayoutUpdatedEvent = CloseOrderDomainEvent<'close-order.payout-updated.uniswapv3', OrderPayoutUpdatedPayload>;
export type OrderTriggerTickUpdatedEvent = CloseOrderDomainEvent<'close-order.trigger-tick-updated.uniswapv3', OrderTriggerTickUpdatedPayload>;
export type OrderValidUntilUpdatedEvent = CloseOrderDomainEvent<'close-order.valid-until-updated.uniswapv3', OrderValidUntilUpdatedPayload>;
export type OrderSlippageUpdatedEvent = CloseOrderDomainEvent<'close-order.slippage-updated.uniswapv3', OrderSlippageUpdatedPayload>;
export type OrderSwapIntentUpdatedEvent = CloseOrderDomainEvent<'close-order.swap-intent-updated.uniswapv3', OrderSwapIntentUpdatedPayload>;

// Vault event aliases
export type VaultOrderRegisteredEvent = CloseOrderDomainEvent<'close-order.registered.uniswapv3-vault', OrderRegisteredPayload>;
export type VaultOrderCancelledEvent = CloseOrderDomainEvent<'close-order.cancelled.uniswapv3-vault', OrderCancelledPayload>;
export type VaultOrderExecutedEvent = CloseOrderDomainEvent<'close-order.executed.uniswapv3-vault', OrderExecutedPayload>;
export type VaultOrderOperatorUpdatedEvent = CloseOrderDomainEvent<'close-order.operator-updated.uniswapv3-vault', OrderOperatorUpdatedPayload>;
export type VaultOrderPayoutUpdatedEvent = CloseOrderDomainEvent<'close-order.payout-updated.uniswapv3-vault', OrderPayoutUpdatedPayload>;
export type VaultOrderTriggerTickUpdatedEvent = CloseOrderDomainEvent<'close-order.trigger-tick-updated.uniswapv3-vault', OrderTriggerTickUpdatedPayload>;
export type VaultOrderValidUntilUpdatedEvent = CloseOrderDomainEvent<'close-order.valid-until-updated.uniswapv3-vault', OrderValidUntilUpdatedPayload>;
export type VaultOrderSlippageUpdatedEvent = CloseOrderDomainEvent<'close-order.slippage-updated.uniswapv3-vault', OrderSlippageUpdatedPayload>;
export type VaultOrderSwapIntentUpdatedEvent = CloseOrderDomainEvent<'close-order.swap-intent-updated.uniswapv3-vault', OrderSwapIntentUpdatedPayload>;
export type VaultOrderSharesUpdatedEvent = CloseOrderDomainEvent<'close-order.shares-updated.uniswapv3-vault', OrderSharesUpdatedPayload>;

export type AnyCloseOrderEvent =
  | OrderRegisteredEvent
  | OrderCancelledEvent
  | OrderExecutedEvent
  | OrderOperatorUpdatedEvent
  | OrderPayoutUpdatedEvent
  | OrderTriggerTickUpdatedEvent
  | OrderValidUntilUpdatedEvent
  | OrderSlippageUpdatedEvent
  | OrderSwapIntentUpdatedEvent
  | VaultOrderRegisteredEvent
  | VaultOrderCancelledEvent
  | VaultOrderExecutedEvent
  | VaultOrderOperatorUpdatedEvent
  | VaultOrderPayoutUpdatedEvent
  | VaultOrderTriggerTickUpdatedEvent
  | VaultOrderValidUntilUpdatedEvent
  | VaultOrderSlippageUpdatedEvent
  | VaultOrderSwapIntentUpdatedEvent
  | VaultOrderSharesUpdatedEvent;

// ============================================================
// Extract Lifecycle Event ABIs
// ============================================================

/**
 * Filtered ABI containing only the 9 lifecycle events.
 * Used for watchEvent subscriptions and decodeEventLog.
 */
export const CLOSER_LIFECYCLE_EVENT_ABIS = UniswapV3PositionCloserV100Abi.filter(
  (item) => item.type === 'event' && isLifecycleEventName(item.name)
);

export const VAULT_CLOSER_LIFECYCLE_EVENT_ABIS = UniswapV3VaultPositionCloserV100Abi.filter(
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

  // Try decoding with NFT ABI first, then vault ABI.
  // The topic0 (event signature hash) differs because the event parameter types differ,
  // so only one will succeed.
  let decoded: { eventName: string; args: Record<string, unknown> } | null = null;
  let isVault = false;

  try {
    decoded = decodeEventLog({
      abi: UniswapV3PositionCloserV100Abi,
      data: rawLog.data,
      topics: rawLog.topics as [`0x${string}`, ...`0x${string}`[]],
    }) as { eventName: string; args: Record<string, unknown> };
  } catch {
    // Not an NFT closer event — try vault
    try {
      decoded = decodeEventLog({
        abi: UniswapV3VaultPositionCloserV100Abi,
        data: rawLog.data,
        topics: rawLog.topics as [`0x${string}`, ...`0x${string}`[]],
      }) as { eventName: string; args: Record<string, unknown> };
      isVault = true;
    } catch {
      // Not a recognized event from either ABI
      return null;
    }
  }

  if (!decoded) return null;

  const eventName = decoded.eventName;
  if (!isLifecycleEventName(eventName)) return null;

  const eventNameMap = isVault ? VAULT_EVENT_NAME_TO_DOMAIN_TYPE : NFT_EVENT_NAME_TO_DOMAIN_TYPE;
  const domainType = eventNameMap[eventName];
  if (!domainType) return null;

  const args = decoded.args;
  const triggerMode = triggerModeToString(args.triggerMode as number);

  // Build envelope with protocol-specific identifiers
  const envelope = {
    chainId,
    contractAddress,
    ...(isVault
      ? { vaultAddress: String(args.vault), ownerAddress: String(args.owner) }
      : { nftId: String(args.nftId) }),
    triggerMode,
    blockNumber: rawLog.blockNumber.toString(),
    transactionHash: rawLog.transactionHash,
    logIndex: rawLog.logIndex,
    receivedAt: new Date().toISOString(),
  };

  switch (eventName) {
    case 'OrderRegistered':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          owner: args.owner as string,
          pool: args.pool as string,
          operator: args.operator as string,
          payout: args.payout as string,
          triggerTick: Number(args.triggerTick),
          validUntil: String(args.validUntil),
          slippageBps: Number(args.slippageBps),
          swapDirection: swapDirectionToString(args.swapDirection as number),
          swapSlippageBps: Number(args.swapSlippageBps),
          ...(isVault && args.shares !== undefined ? { shares: String(args.shares) } : {}),
        },
      } as AnyCloseOrderEvent;

    case 'OrderCancelled':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          owner: args.owner as string,
        },
      } as AnyCloseOrderEvent;

    case 'OrderExecuted':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          owner: args.owner as string,
          payout: args.payout as string,
          executionTick: Number(args.executionTick),
          ...(isVault ? { sharesClosed: String(args.sharesClosed) } : {}),
          amount0Out: String(args.amount0Out),
          amount1Out: String(args.amount1Out),
        },
      } as AnyCloseOrderEvent;

    case 'OrderOperatorUpdated':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          oldOperator: args.oldOperator as string,
          newOperator: args.newOperator as string,
        },
      } as AnyCloseOrderEvent;

    case 'OrderPayoutUpdated':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          oldPayout: args.oldPayout as string,
          newPayout: args.newPayout as string,
        },
      } as AnyCloseOrderEvent;

    case 'OrderTriggerTickUpdated':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          oldTick: Number(args.oldTick),
          newTick: Number(args.newTick),
        },
      } as AnyCloseOrderEvent;

    case 'OrderValidUntilUpdated':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          oldValidUntil: String(args.oldValidUntil),
          newValidUntil: String(args.newValidUntil),
        },
      } as AnyCloseOrderEvent;

    case 'OrderSlippageUpdated':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          oldSlippageBps: Number(args.oldSlippageBps),
          newSlippageBps: Number(args.newSlippageBps),
        },
      } as AnyCloseOrderEvent;

    case 'OrderSwapIntentUpdated':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          oldDirection: swapDirectionToString(args.oldDirection as number),
          newDirection: swapDirectionToString(args.newDirection as number),
          swapSlippageBps: Number(args.swapSlippageBps),
        },
      } as AnyCloseOrderEvent;

    case 'OrderSharesUpdated':
      return {
        type: domainType as any,
        ...envelope,
        payload: {
          oldShares: String(args.oldShares),
          newShares: String(args.newShares),
        },
      } as AnyCloseOrderEvent;

    default:
      return null;
  }
}

// ============================================================
// Routing
// ============================================================

/** Exchange name for close order lifecycle events */
export const EXCHANGE_CLOSE_ORDER_EVENTS = 'close-order-events';

/**
 * Build a routing key for close order lifecycle events.
 * NFT format:   closer.{chainId}.{nftId}.{triggerMode}
 * Vault format:  closer.vault.{chainId}.{vaultAddress}.{triggerMode}
 */
export function buildCloseOrderRoutingKey(
  chainId: number,
  identifier: string,
  triggerMode: string,
  variant?: 'vault'
): string {
  if (variant === 'vault') {
    return `closer.vault.${chainId}.${identifier}.${triggerMode}`;
  }
  return `closer.${chainId}.${identifier}.${triggerMode}`;
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
