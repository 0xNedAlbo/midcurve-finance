/**
 * Position Liquidity Message Types and Serialization
 *
 * Defines the message structure for position liquidity events published to RabbitMQ.
 * Raw WebSocket payloads are wrapped with minimal context for routing.
 *
 * Events: IncreaseLiquidity, DecreaseLiquidity, Collect from NFPM contract.
 */

/**
 * JSON replacer function that converts BigInt values to strings.
 * Required because JSON.stringify() cannot serialize BigInt natively.
 *
 * viem returns log data with BigInt fields (blockNumber, tokenId, etc.) which
 * must be converted to strings for JSON serialization.
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Position event types from NFPM contract.
 */
export type PositionEventType = 'INCREASE_LIQUIDITY' | 'DECREASE_LIQUIDITY' | 'COLLECT';

/**
 * Raw position event wrapper - minimal wrapper around raw WebSocket payload.
 *
 * We publish the raw payload as-is to:
 * 1. Observe what data actually comes in the payload
 * 2. Identify what fields are available vs missing
 * 3. Define the final structure in a later step after observation
 */
export interface RawPositionEventWrapper {
  /** Chain ID for routing context */
  chainId: number;
  /** NFT ID (tokenId) for routing context */
  nftId: string;
  /** Event type for consumer discrimination */
  eventType: PositionEventType;
  /** Raw WebSocket payload as-is (no transformation) */
  raw: unknown;
  /** ISO timestamp when event was received */
  receivedAt: string;
}

/**
 * Serialize a raw position event to a Buffer for RabbitMQ publishing.
 * Uses bigIntReplacer to handle BigInt values in the raw viem payload.
 */
export function serializeRawPositionEvent(event: RawPositionEventWrapper): Buffer {
  return Buffer.from(JSON.stringify(event, bigIntReplacer));
}

/**
 * Create a raw position event wrapper from WebSocket data.
 */
export function createRawPositionEvent(
  chainId: number,
  nftId: string,
  eventType: PositionEventType,
  rawPayload: unknown
): RawPositionEventWrapper {
  return {
    chainId,
    nftId,
    eventType,
    raw: rawPayload,
    receivedAt: new Date().toISOString(),
  };
}
