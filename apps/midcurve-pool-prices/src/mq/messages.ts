/**
 * Message Types and Serialization
 *
 * Defines the message structure for pool price events published to RabbitMQ.
 * Raw WebSocket payloads are wrapped with minimal context for routing.
 */

/**
 * JSON replacer function that converts BigInt values to strings.
 * Required because JSON.stringify() cannot serialize BigInt natively.
 *
 * viem returns log data with BigInt fields (blockNumber, etc.) which
 * must be converted to strings for JSON serialization.
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Raw swap event wrapper - minimal wrapper around raw WebSocket payload.
 *
 * We publish the raw payload as-is to:
 * 1. Observe what data actually comes in the payload
 * 2. Identify what fields are available vs missing
 * 3. Define the final structure in a later step after observation
 */
export interface RawSwapEventWrapper {
  /** Chain ID for routing context */
  chainId: number;
  /** Pool address for routing context (from subscription filter) */
  poolAddress: string;
  /** Raw WebSocket payload as-is (no transformation) */
  raw: unknown;
  /** ISO timestamp when event was received */
  receivedAt: string;
}

/**
 * Serialize a raw swap event to a Buffer for RabbitMQ publishing.
 * Uses bigIntReplacer to handle BigInt values in the raw viem payload.
 */
export function serializeRawSwapEvent(event: RawSwapEventWrapper): Buffer {
  return Buffer.from(JSON.stringify(event, bigIntReplacer));
}

/**
 * Create a raw swap event wrapper from WebSocket data.
 */
export function createRawSwapEvent(
  chainId: number,
  poolAddress: string,
  rawPayload: unknown
): RawSwapEventWrapper {
  return {
    chainId,
    poolAddress: poolAddress.toLowerCase(),
    raw: rawPayload,
    receivedAt: new Date().toISOString(),
  };
}
