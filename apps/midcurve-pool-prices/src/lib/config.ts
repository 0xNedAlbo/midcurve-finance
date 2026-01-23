/**
 * Pool Prices Configuration
 *
 * Environment-based configuration for the pool prices service.
 */

/**
 * RabbitMQ configuration
 */
export interface RabbitMQConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  vhost?: string;
}

/**
 * WebSocket configuration per chain
 */
export interface WssConfig {
  chainId: number;
  url: string;
}

/**
 * Worker configuration
 */
export interface WorkerConfig {
  /** Maximum pools per WebSocket connection (eth_subscribe limit) */
  maxPoolsPerConnection: number;
  /** Reconnection delay in milliseconds */
  reconnectDelayMs: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts: number;
  /** Interval for polling new subscriptions (milliseconds) */
  pollIntervalMs: number;
  /** Interval for cleaning up stale subscribers (milliseconds) */
  cleanupIntervalMs: number;
  /** Threshold for considering a subscriber stale (milliseconds behind MAX lastMessageAck) */
  staleThresholdMs: number;
}

/**
 * Full pool prices configuration
 */
export interface PoolPricesConfig {
  rabbitmq: RabbitMQConfig;
  worker: WorkerConfig;
  logLevel: string;
}

/**
 * Get RabbitMQ configuration from environment
 */
export function getRabbitMQConfig(): RabbitMQConfig {
  return {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
    username: process.env.RABBITMQ_USER || 'midcurve',
    password: process.env.RABBITMQ_PASS || 'midcurve_dev',
    vhost: process.env.RABBITMQ_VHOST,
  };
}

/**
 * Get worker configuration from environment
 */
export function getWorkerConfig(): WorkerConfig {
  return {
    maxPoolsPerConnection: parseInt(process.env.MAX_POOLS_PER_CONNECTION || '1000', 10),
    reconnectDelayMs: parseInt(process.env.RECONNECT_DELAY_MS || '5000', 10),
    maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '10', 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
    cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || '60000', 10),
    staleThresholdMs: parseInt(process.env.STALE_THRESHOLD_MS || '60000', 10),
  };
}

/**
 * Get full pool prices configuration
 */
export function getPoolPricesConfig(): PoolPricesConfig {
  return {
    rabbitmq: getRabbitMQConfig(),
    worker: getWorkerConfig(),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

/**
 * Supported chain IDs for WebSocket subscriptions
 */
export const SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 56, 137, 10] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/**
 * Chain ID to name mapping
 */
export const CHAIN_NAMES: Record<SupportedChainId, string> = {
  1: 'ethereum',
  42161: 'arbitrum',
  8453: 'base',
  56: 'bsc',
  137: 'polygon',
  10: 'optimism',
};

/**
 * Environment variable names for WebSocket RPC URLs per chain
 */
const WS_RPC_URL_ENV_VARS: Record<SupportedChainId, string> = {
  1: 'WS_RPC_URL_ETHEREUM',
  42161: 'WS_RPC_URL_ARBITRUM',
  8453: 'WS_RPC_URL_BASE',
  56: 'WS_RPC_URL_BSC',
  137: 'WS_RPC_URL_POLYGON',
  10: 'WS_RPC_URL_OPTIMISM',
};

/**
 * Get WebSocket RPC URL for a specific chain
 * Returns undefined if not configured
 */
export function getWssUrl(chainId: SupportedChainId): string | undefined {
  const envVar = WS_RPC_URL_ENV_VARS[chainId];
  return process.env[envVar];
}

/**
 * Get all configured WebSocket RPC URLs
 * Only returns chains that have WS_RPC_URL_* configured
 */
export function getConfiguredWssUrls(): WssConfig[] {
  const configs: WssConfig[] = [];

  for (const chainId of SUPPORTED_CHAIN_IDS) {
    const url = getWssUrl(chainId);
    if (url) {
      configs.push({ chainId, url });
    }
  }

  return configs;
}

/**
 * Check if a chain ID is supported
 */
export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}
