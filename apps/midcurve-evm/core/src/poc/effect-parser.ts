/**
 * Effect parsing utilities for the durable await pattern.
 *
 * Handles parsing of EffectNeeded errors from contract reverts
 * and decoding of specific effect payloads (e.g., LOG effects).
 */

import {
  decodeAbiParameters,
  type Hex,
  keccak256,
  toHex,
  hexToString,
} from 'viem';

// ============================================================
// Types
// ============================================================

export interface EffectRequest {
  epoch: bigint;
  idempotencyKey: Hex;
  effectType: Hex;
  payload: Hex;
}

export interface LogEffectPayload {
  level: number; // 0=debug, 1=info, 2=warn, 3=error
  topic: Hex;
  data: Hex;
}

// ============================================================
// Constants
// ============================================================

// EffectNeeded(uint64,bytes32,bytes32,bytes)
export const EFFECT_NEEDED_SELECTOR = keccak256(
  toHex('EffectNeeded(uint64,bytes32,bytes32,bytes)')
).slice(0, 10) as Hex;

// Effect type for logging
export const EFFECT_LOG = keccak256(toHex('LOG')) as Hex;

// Log levels
export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

// Known topic hashes (for human-readable output)
// These match keccak256("TOPIC_NAME") used in the strategy
export const KNOWN_TOPICS: Record<string, string> = {
  [keccak256(toHex('STEP_START'))]: 'STEP_START',
  [keccak256(toHex('EPOCH_INFO'))]: 'EPOCH_INFO',
  [keccak256(toHex('EVENTS_COUNT'))]: 'EVENTS_COUNT',
  [keccak256(toHex('STEP_COMPLETE'))]: 'STEP_COMPLETE',
  [keccak256(toHex('EVENT_RECEIVED'))]: 'EVENT_RECEIVED',
};

// Known event type hashes (for human-readable output)
export const KNOWN_EVENT_TYPES: Record<string, string> = {
  [keccak256(toHex('PING'))]: 'PING',
  [keccak256(toHex('PONG'))]: 'PONG',
};

// ============================================================
// Parsing Functions
// ============================================================

/**
 * Parse an EffectNeeded error from revert data.
 *
 * @param revertData - Raw revert data (hex string starting with selector)
 * @returns Parsed effect request or null if not an EffectNeeded error
 */
export function parseEffectNeeded(revertData: Hex): EffectRequest | null {
  // Check selector matches EffectNeeded
  if (!revertData.startsWith(EFFECT_NEEDED_SELECTOR)) {
    return null;
  }

  // Remove selector (first 4 bytes = 10 hex chars including 0x)
  const encodedParams = `0x${revertData.slice(10)}` as Hex;

  try {
    const [epoch, idempotencyKey, effectType, payload] = decodeAbiParameters(
      [
        { type: 'uint64', name: 'epoch' },
        { type: 'bytes32', name: 'idempotencyKey' },
        { type: 'bytes32', name: 'effectType' },
        { type: 'bytes', name: 'payload' },
      ],
      encodedParams
    );

    return {
      epoch,
      idempotencyKey,
      effectType,
      payload: payload as Hex,
    };
  } catch {
    return null;
  }
}

/**
 * Extract revert data from a viem ContractFunctionExecutionError.
 *
 * viem wraps revert data in nested error structures. This extracts the raw data.
 */
export function extractRevertData(error: unknown): Hex | null {
  // viem errors have a nested structure with the revert data
  // We need to traverse to find it
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;

    // Check for raw property directly (some error types)
    if (err.raw && typeof err.raw === 'string' && err.raw.startsWith('0x')) {
      return err.raw as Hex;
    }

    // Check for data property directly (some error types)
    if (err.data && typeof err.data === 'string' && err.data.startsWith('0x')) {
      return err.data as Hex;
    }

    // Check for cause chain (ContractFunctionExecutionError)
    if (err.cause && typeof err.cause === 'object') {
      const cause = err.cause as Record<string, unknown>;

      // ContractFunctionRevertedError has raw property with the full revert data
      if (cause.raw && typeof cause.raw === 'string' && cause.raw.startsWith('0x')) {
        return cause.raw as Hex;
      }

      // ContractFunctionRevertedError has data
      if (cause.data && typeof cause.data === 'string') {
        return cause.data as Hex;
      }

      // Sometimes it's nested further
      if (cause.cause && typeof cause.cause === 'object') {
        const innerCause = cause.cause as Record<string, unknown>;
        if (innerCause.raw && typeof innerCause.raw === 'string') {
          return innerCause.raw as Hex;
        }
        if (innerCause.data && typeof innerCause.data === 'string') {
          return innerCause.data as Hex;
        }
      }
    }

    // Check for walk() method (viem 2.x errors)
    if (typeof err.walk === 'function') {
      let revertData: Hex | null = null;
      (err.walk as (fn: (e: unknown) => boolean) => void)((e: unknown) => {
        if (e && typeof e === 'object') {
          const inner = e as Record<string, unknown>;
          if (inner.raw && typeof inner.raw === 'string' && inner.raw.startsWith('0x')) {
            revertData = inner.raw as Hex;
            return true; // stop walking
          }
          if (inner.data && typeof inner.data === 'string' && inner.data.startsWith('0x')) {
            revertData = inner.data as Hex;
            return true; // stop walking
          }
        }
        return false;
      });
      if (revertData) return revertData;
    }
  }

  return null;
}

/**
 * Parse EffectNeeded from a viem error object.
 *
 * Combines extractRevertData and parseEffectNeeded.
 */
export function parseEffectNeededFromError(error: unknown): EffectRequest | null {
  const revertData = extractRevertData(error);
  if (!revertData) return null;
  return parseEffectNeeded(revertData);
}

// ============================================================
// LOG Effect Handling
// ============================================================

/**
 * Decode a LOG effect payload.
 *
 * LOG payload format: abi.encode(uint8 level, bytes32 topic, bytes data)
 */
export function decodeLogPayload(payload: Hex): LogEffectPayload {
  const [level, topic, data] = decodeAbiParameters(
    [
      { type: 'uint8', name: 'level' },
      { type: 'bytes32', name: 'topic' },
      { type: 'bytes', name: 'data' },
    ],
    payload
  );

  return {
    level,
    topic,
    data: data as Hex,
  };
}

/**
 * Format a bytes32 value for display.
 * Tries to find a known name, otherwise truncates the hex.
 */
function formatBytes32(value: Hex, knownNames: Record<string, string>): string {
  const known = knownNames[value];
  if (known) return known;
  return value.slice(0, 10) + '...';
}

/**
 * Try to decode log data and format it nicely.
 */
function formatLogData(data: Hex): string {
  if (data === '0x' || data.length <= 2) {
    return '(empty)';
  }

  try {
    // Most of our log data is abi.encode(bytes32) or abi.encode(uint256)
    // abi.encode produces 32-byte aligned data with offset prefix
    // So abi.encode(bytes32) or abi.encode(uint256) = 32 bytes = 66 hex chars (with 0x)

    if (data.length >= 66) {
      // First, try as uint256/uint64 (for epoch, counters, etc.)
      // These are small numbers that would look like 0x00000...000X
      try {
        const [decoded] = decodeAbiParameters(
          [{ type: 'uint256', name: 'value' }],
          data
        );
        // If it's a small number, show as decimal
        if (decoded < 1000000n) {
          return decoded.toString();
        }
      } catch {
        // Not a uint256
      }

      // Try as bytes32 (for event types, etc.)
      try {
        const [decoded] = decodeAbiParameters(
          [{ type: 'bytes32', name: 'value' }],
          data
        );
        const known = KNOWN_EVENT_TYPES[decoded as string];
        if (known) return known;
        // If it looks like a hash (non-zero), show truncated
        if (decoded !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
          return (decoded as string).slice(0, 18) + '...';
        }
        // Zero bytes32 - show as 0
        return '0';
      } catch {
        // Not a bytes32
      }
    }

    // Raw bytes32 (66 chars = 0x + 64 hex)
    if (data.length === 66) {
      const known = KNOWN_EVENT_TYPES[data];
      if (known) return known;
      return data.slice(0, 18) + '...';
    }

    // Fallback: just show truncated hex
    return data.slice(0, 18) + '...';
  } catch {
    return data.slice(0, 18) + '...';
  }
}

/**
 * Execute a LOG effect by printing to console.
 *
 * @param payload - Decoded log payload
 * @returns Empty result (logs don't return data)
 */
export function executeLogEffect(payload: LogEffectPayload): void {
  const levelName = LOG_LEVELS[payload.level] ?? 'UNKNOWN';
  const topicName = formatBytes32(payload.topic, KNOWN_TOPICS);
  const dataStr = formatLogData(payload.data);

  // Color-code by level (using ANSI codes)
  const levelColors: Record<string, string> = {
    DEBUG: '\x1b[90m',  // gray
    INFO: '\x1b[36m',   // cyan
    WARN: '\x1b[33m',   // yellow
    ERROR: '\x1b[31m',  // red
  };
  const reset = '\x1b[0m';
  const color = levelColors[levelName] ?? '';

  console.log(`  ${color}[${levelName}]${reset} ${topicName}: ${dataStr}`);
}

/**
 * Check if an effect type is a LOG effect.
 */
export function isLogEffect(effectType: Hex): boolean {
  return effectType === EFFECT_LOG;
}
