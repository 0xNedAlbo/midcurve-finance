/**
 * NFPM Transfer Event Message Types and Serialization
 *
 * Defines the message structure for NFPM ERC-721 Transfer events published to RabbitMQ.
 * Covers three event types derived from the Transfer(from, to, tokenId) event:
 * - MINT: from = address(0) → new position created
 * - BURN: to = address(0) → position destroyed
 * - TRANSFER: neither zero → ownership changed
 */

import type { NfpmTransferEventType } from './topology';

/**
 * JSON replacer function that converts BigInt values to strings.
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * NFPM Transfer event wrapper for RabbitMQ messages.
 */
export interface NfpmTransferEventWrapper {
  /** Chain ID for routing context */
  chainId: number;
  /** NFT ID (tokenId) from the Transfer event */
  nftId: string;
  /** Classified event type: MINT, BURN, or TRANSFER */
  eventType: NfpmTransferEventType;
  /** Sender address (address(0) for mints) */
  from: string;
  /** Recipient address (address(0) for burns) */
  to: string;
  /** Raw WebSocket payload as-is */
  raw: unknown;
  /** ISO timestamp when event was received */
  receivedAt: string;
}

/**
 * Serialize an NFPM transfer event to a Buffer for RabbitMQ publishing.
 */
export function serializeNfpmTransferEvent(event: NfpmTransferEventWrapper): Buffer {
  return Buffer.from(JSON.stringify(event, bigIntReplacer));
}

/**
 * Create an NFPM transfer event wrapper from WebSocket data.
 */
export function createNfpmTransferEvent(
  chainId: number,
  nftId: string,
  eventType: NfpmTransferEventType,
  from: string,
  to: string,
  rawPayload: unknown,
): NfpmTransferEventWrapper {
  return {
    chainId,
    nftId,
    eventType,
    from,
    to,
    raw: rawPayload,
    receivedAt: new Date().toISOString(),
  };
}
