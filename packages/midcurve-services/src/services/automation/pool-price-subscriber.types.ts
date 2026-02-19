/**
 * Pool Price Subscriber Types
 *
 * Type definitions for the PoolPriceSubscriber class and RabbitMQ message formats.
 * Used by automation workers (CloseOrderMonitor, RangeMonitor) for consuming
 * pool price events from the pool-prices exchange.
 */

import type { ChannelModel } from 'amqplib';
import type { ServiceLogger } from '../../logging/index.js';

// Forward declaration - PoolPriceSubscriber type for handler signatures
import type { PoolPriceSubscriber } from './pool-price-subscriber.js';

// ============================================================================
// RabbitMQ Message Types
// ============================================================================

/**
 * RabbitMQ connection configuration
 */
export interface RabbitMQConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  vhost?: string;
}

/**
 * Raw swap event wrapper - matches midcurve-onchain-data message format.
 *
 * This is the structure of messages published to the pool-prices exchange
 * by the onchain-data worker.
 */
export interface RawSwapEventWrapper {
  /** Chain ID for routing context */
  chainId: number;
  /** Pool address (lowercase) for routing context */
  poolAddress: string;
  /** Raw WebSocket payload from viem (Swap event log data) */
  raw: unknown;
  /** ISO timestamp when event was received by pool-prices service */
  receivedAt: string;
}

// ============================================================================
// Subscriber Types
// ============================================================================

/**
 * Message handler callback type.
 *
 * Called for each incoming pool price message.
 * Receives both the message and the subscriber instance (for self-stopping).
 */
export type PoolPriceMessageHandler = (
  message: RawSwapEventWrapper,
  subscriber: PoolPriceSubscriber
) => void | Promise<void>;

/**
 * Error handler callback type.
 *
 * Called on connection/channel errors (e.g., connection drops).
 * Receives both the error and the subscriber instance for cleanup/retry logic.
 */
export type PoolPriceErrorHandler = (
  error: Error,
  subscriber: PoolPriceSubscriber
) => void | Promise<void>;

/**
 * Subscriber lifecycle state.
 */
export type PoolPriceSubscriberState =
  | 'idle' // Not started
  | 'starting' // Connection in progress
  | 'running' // Actively consuming
  | 'stopping' // Shutdown in progress
  | 'stopped' // Gracefully stopped (terminal)
  | 'error'; // Error state (connection failed)

/**
 * Options for creating a pool price subscriber.
 */
export interface PoolPriceSubscriberOptions {
  /** Opaque identifier for logging (e.g. "order-trigger-<orderId>") */
  subscriberId: string;

  /** Chain ID of the pool (e.g., 1 for Ethereum) */
  chainId: number;

  /** Pool contract address (will be lowercased) */
  poolAddress: string;

  /** Callback invoked for each received message */
  messageHandler: PoolPriceMessageHandler;

  /** Optional: Callback invoked on connection/channel errors */
  errorHandler?: PoolPriceErrorHandler;

  /** Optional: Existing RabbitMQ connection (subscriber will own channel only) */
  connection?: ChannelModel;

  /** Optional: RabbitMQ config (used only if no connection provided) */
  rabbitmqConfig?: RabbitMQConfig;

  /** Optional: Custom logger instance */
  logger?: ServiceLogger;

  /** Optional: Prefetch count for fair dispatch (default: 1) */
  prefetch?: number;
}

/**
 * Subscriber status information.
 */
export interface PoolPriceSubscriberStatus {
  state: PoolPriceSubscriberState;
  chainId: number;
  poolAddress: string;
  routingKey: string;
  queueName: string;
  messagesReceived: number;
  lastMessageAt: Date | null;
  startedAt: Date | null;
  consumerTag: string | null;
}
