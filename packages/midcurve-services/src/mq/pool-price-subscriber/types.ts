/**
 * Pool Price Subscriber Types
 *
 * Type definitions for the PoolPriceSubscriber class.
 */

import type { ChannelModel } from 'amqplib';
import type { ServiceLogger } from '../../logging/index.js';
import type { RabbitMQConfig, RawSwapEventWrapper } from '../types.js';

// Forward declaration - PoolPriceSubscriber type for handler signatures
// The actual class is in pool-price-subscriber.ts
import type { PoolPriceSubscriber } from './pool-price-subscriber.js';

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
  /** Current lifecycle state */
  state: PoolPriceSubscriberState;

  /** Chain ID being subscribed to */
  chainId: number;

  /** Pool address being subscribed to */
  poolAddress: string;

  /** Routing key used for subscription */
  routingKey: string;

  /** Queue name (unique per subscriber instance) */
  queueName: string;

  /** Total messages received since start */
  messagesReceived: number;

  /** Timestamp of last received message */
  lastMessageAt: Date | null;

  /** Timestamp when subscriber was started */
  startedAt: Date | null;

  /** RabbitMQ consumer tag (null if not consuming) */
  consumerTag: string | null;
}
