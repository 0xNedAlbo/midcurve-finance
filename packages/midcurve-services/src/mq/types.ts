/**
 * RabbitMQ Types
 *
 * Shared types for RabbitMQ messaging in midcurve-services.
 */

/**
 * RabbitMQ connection configuration
 */
export interface RabbitMQConfig {
  /** RabbitMQ host (default: localhost) */
  host: string;
  /** RabbitMQ port (default: 5672) */
  port: number;
  /** RabbitMQ username (default: midcurve) */
  username: string;
  /** RabbitMQ password (default: midcurve_dev) */
  password: string;
  /** RabbitMQ virtual host (optional) */
  vhost?: string;
}

/**
 * Raw swap event wrapper - matches midcurve-pool-prices message format.
 *
 * This is the structure of messages published to the pool-prices exchange
 * by the midcurve-pool-prices worker.
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
