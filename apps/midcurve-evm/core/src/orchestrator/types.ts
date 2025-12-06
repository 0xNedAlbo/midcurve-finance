import type { Hex } from 'viem';
import type { ExternalEvent } from '../stores/types.js';
import type { EffectResult } from '../effects/types.js';

/**
 * Types of events that can be delivered to a strategy's mailbox
 */
export type MailboxEventType = 'external' | 'effect_result';

/**
 * External event to be delivered to a strategy
 */
export interface ExternalMailboxEvent {
  type: 'external';
  event: ExternalEvent;
  subscriptionType: Hex;
  subscriptionPayload: Hex;
}

/**
 * Effect result to be delivered to a strategy
 */
export interface EffectResultMailboxEvent {
  type: 'effect_result';
  result: EffectResult;
}

/**
 * Union of all mailbox event types
 */
export type MailboxEvent = ExternalMailboxEvent | EffectResultMailboxEvent;

/**
 * Statistics about mailbox state
 */
export interface MailboxStats {
  totalPending: number;
  byStrategy: Record<string, number>;
}

/**
 * Configuration for the orchestrator
 */
export interface OrchestratorConfig {
  /** RPC URL for the embedded EVM */
  rpcUrl?: string;

  /** WebSocket URL for the embedded EVM */
  wsUrl?: string;

  /** Callback gas limit */
  callbackGasLimit?: bigint;
}

/**
 * OHLC timeframe values in minutes
 */
export const OHLC_TIMEFRAMES = {
  ONE_MINUTE: 1,
  FIVE_MINUTES: 5,
  FIFTEEN_MINUTES: 15,
  ONE_HOUR: 60,
  FOUR_HOURS: 240,
  ONE_DAY: 1440,
} as const;

export type OhlcTimeframe = (typeof OHLC_TIMEFRAMES)[keyof typeof OHLC_TIMEFRAMES];
