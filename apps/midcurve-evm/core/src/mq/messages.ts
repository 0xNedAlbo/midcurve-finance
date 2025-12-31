/**
 * RabbitMQ Message Type Definitions
 *
 * Defines the message formats for communication between:
 * - Core orchestrator (strategy loops)
 * - Effect executors
 * - External event sources (OHLC service, API)
 */

import { type Hex, keccak256, toHex, encodeAbiParameters } from 'viem';

// ============================================================
// Effect Request Message
// ============================================================

/**
 * Effect request published by Core when a strategy needs external work.
 *
 * Published to: midcurve.effects exchange
 * Routing key: "pending"
 * Consumed by: Effect executor pool (competing consumers)
 */
export interface EffectRequestMessage {
  // Routing info
  /** Strategy contract address (0x... checksummed) */
  strategyAddress: string;

  // Effect identification (from EffectNeeded error)
  /** Current epoch (uint64 as string for JSON serialization) */
  epoch: string;
  /** Unique key for exactly-once semantics (bytes32 hex) */
  idempotencyKey: string;
  /** Effect type discriminator (bytes32 hex, e.g., keccak256("LOG")) */
  effectType: string;
  /** ABI-encoded effect-specific parameters (bytes hex) */
  payload: string;

  // Timing
  /** Unix milliseconds when Core first detected this effect request */
  requestedAt: number;

  // Metadata
  /** UUID for distributed tracing */
  correlationId: string;
}

// ============================================================
// Effect Result Message
// ============================================================

/**
 * Effect result published by executor after completing external work.
 *
 * Published to: midcurve.results exchange
 * Routing key: {strategyAddress} (lowercase)
 * Consumed by: Strategy loop (single consumer)
 */
export interface EffectResultMessage {
  // Routing info
  /** Strategy contract address (must match request) */
  strategyAddress: string;

  // Result identification
  /** Epoch from the original request */
  epoch: string;
  /** Idempotency key from the original request */
  idempotencyKey: string;

  // Result data
  /** True if effect executed successfully */
  ok: boolean;
  /** ABI-encoded result data (bytes hex) */
  data: string;

  // Timing (for latency tracking)
  /** Unix milliseconds when Core first saw this request (copied from request) */
  requestedAt: number;
  /** Unix milliseconds when executor completed the effect */
  completedAt: number;

  // Metadata
  /** Correlation ID from the original request */
  correlationId: string;
  /** Identifier of the executor that handled this effect */
  executorId?: string;
}

// ============================================================
// Step Event Message
// ============================================================

/**
 * External event to be processed by a strategy.
 *
 * Published to: midcurve.events exchange
 * Routing keys:
 *   - action.{addr} - User actions
 *   - lifecycle.{addr} - Start/shutdown commands
 *   - ohlc.{SYMBOL}.{timeframe} - OHLC candle data
 * Consumed by: Strategy loop (single consumer)
 */
export interface StepEventMessage {
  // Event envelope (matches Solidity step() input format)
  /** Event type discriminator (bytes32 hex, e.g., STEP_EVENT_ACTION) */
  eventType: string;
  /** Event payload version (uint32) */
  eventVersion: number;
  /** ABI-encoded event-specific data (bytes hex) */
  payload: string;

  // Metadata
  /** Unix milliseconds when event was created */
  timestamp: number;
  /** Source identifier (e.g., 'ohlc-service', 'api', 'lifecycle') */
  source: string;
}

// ============================================================
// Serialization Helpers
// ============================================================

/**
 * Serialize a message to JSON buffer for RabbitMQ.
 */
export function serializeMessage<T>(message: T): Buffer {
  return Buffer.from(JSON.stringify(message));
}

/**
 * Deserialize a RabbitMQ message buffer to typed object.
 * @throws SyntaxError if invalid JSON
 */
export function deserializeMessage<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString()) as T;
}

/**
 * Convert bigint to string for JSON serialization.
 */
export function bigintToString(value: bigint): string {
  return value.toString();
}

/**
 * Convert string back to bigint after JSON deserialization.
 */
export function stringToBigint(value: string): bigint {
  return BigInt(value);
}

/**
 * Generate a correlation ID for tracing.
 */
export function generateCorrelationId(): string {
  // Simple UUID v4 implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================
// Message Builders
// ============================================================

/**
 * Create an effect request message from parsed EffectNeeded error.
 */
export function createEffectRequest(
  strategyAddress: string,
  epoch: bigint,
  idempotencyKey: Hex,
  effectType: Hex,
  payload: Hex
): EffectRequestMessage {
  return {
    strategyAddress,
    epoch: bigintToString(epoch),
    idempotencyKey,
    effectType,
    payload,
    requestedAt: Date.now(),
    correlationId: generateCorrelationId(),
  };
}

/**
 * Create an effect result message from executor output.
 */
export function createEffectResult(
  request: EffectRequestMessage,
  ok: boolean,
  data: Hex,
  executorId?: string
): EffectResultMessage {
  return {
    strategyAddress: request.strategyAddress,
    epoch: request.epoch,
    idempotencyKey: request.idempotencyKey,
    ok,
    data,
    requestedAt: request.requestedAt,
    completedAt: Date.now(),
    correlationId: request.correlationId,
    executorId,
  };
}

/**
 * Create a step event message.
 */
export function createStepEvent(
  eventType: Hex,
  eventVersion: number,
  payload: Hex,
  source: string
): StepEventMessage {
  return {
    eventType,
    eventVersion,
    payload,
    timestamp: Date.now(),
    source,
  };
}

// ============================================================
// Lifecycle Event Constants
// ============================================================

/** Event type for lifecycle commands (must match Solidity STEP_EVENT_LIFECYCLE) */
export const STEP_EVENT_LIFECYCLE = keccak256(toHex('STEP_EVENT_LIFECYCLE')) as Hex;

/** Envelope version for lifecycle events */
export const LIFECYCLE_EVENT_VERSION = 1;

/** Lifecycle command: start the strategy */
export const LIFECYCLE_START = keccak256(toHex('START')) as Hex;

/** Lifecycle command: graceful shutdown */
export const LIFECYCLE_SHUTDOWN = keccak256(toHex('SHUTDOWN')) as Hex;

// ============================================================
// Lifecycle Event Builder
// ============================================================

/**
 * Create a lifecycle event message (START or SHUTDOWN).
 *
 * Lifecycle events use a simplified payload format: abi.encode(command)
 * No nonce is needed because lifecycle commands are idempotent by state machine.
 *
 * @param command - LIFECYCLE_START or LIFECYCLE_SHUTDOWN
 * @returns StepEventMessage ready to publish to strategy's events queue
 */
export function createLifecycleEvent(command: Hex): StepEventMessage {
  // Encode payload: abi.encode(command)
  const payload = encodeAbiParameters(
    [{ type: 'bytes32', name: 'command' }],
    [command]
  );

  return {
    eventType: STEP_EVENT_LIFECYCLE,
    eventVersion: LIFECYCLE_EVENT_VERSION,
    payload,
    timestamp: Date.now(),
    source: 'lifecycle',
  };
}

// ============================================================
// Type Guards
// ============================================================

/**
 * Check if object is a valid EffectRequestMessage.
 */
export function isEffectRequestMessage(obj: unknown): obj is EffectRequestMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const msg = obj as Record<string, unknown>;
  return (
    typeof msg.strategyAddress === 'string' &&
    typeof msg.epoch === 'string' &&
    typeof msg.idempotencyKey === 'string' &&
    typeof msg.effectType === 'string' &&
    typeof msg.payload === 'string' &&
    typeof msg.requestedAt === 'number' &&
    typeof msg.correlationId === 'string'
  );
}

/**
 * Check if object is a valid EffectResultMessage.
 */
export function isEffectResultMessage(obj: unknown): obj is EffectResultMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const msg = obj as Record<string, unknown>;
  return (
    typeof msg.strategyAddress === 'string' &&
    typeof msg.epoch === 'string' &&
    typeof msg.idempotencyKey === 'string' &&
    typeof msg.ok === 'boolean' &&
    typeof msg.data === 'string' &&
    typeof msg.requestedAt === 'number' &&
    typeof msg.completedAt === 'number' &&
    typeof msg.correlationId === 'string'
  );
}

/**
 * Check if object is a valid StepEventMessage.
 */
export function isStepEventMessage(obj: unknown): obj is StepEventMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const msg = obj as Record<string, unknown>;
  return (
    typeof msg.eventType === 'string' &&
    typeof msg.eventVersion === 'number' &&
    typeof msg.payload === 'string' &&
    typeof msg.timestamp === 'number' &&
    typeof msg.source === 'string'
  );
}
