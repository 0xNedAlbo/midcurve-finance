/**
 * Onchain Data Configuration
 *
 * Environment-based configuration for the onchain data service.
 */

import {
  PRODUCTION_CHAIN_IDS as REGISTRY_PRODUCTION_CHAIN_IDS,
  ALL_CHAIN_IDS as REGISTRY_ALL_CHAIN_IDS,
  getChainShortName,
  getWsRpcEnvVarName,
} from '@midcurve/shared';

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
  /** Threshold for pruning inactive subscribers from database (milliseconds, default: 24 hours) */
  pruneThresholdMs: number;
}

/**
 * Full onchain data configuration
 */
export interface OnchainDataConfig {
  rabbitmq: RabbitMQConfig;
  worker: WorkerConfig;
  logLevel: string;
}

/**
 * @deprecated Use OnchainDataConfig instead. Kept for backward compatibility.
 */
export type PoolPricesConfig = OnchainDataConfig;

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
    pruneThresholdMs: parseInt(process.env.PRUNE_THRESHOLD_MS || '86400000', 10), // 24 hours
  };
}

/**
 * Get full onchain data configuration
 */
export function getOnchainDataConfig(): OnchainDataConfig {
  return {
    rabbitmq: getRabbitMQConfig(),
    worker: getWorkerConfig(),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

/**
 * @deprecated Use getOnchainDataConfig instead. Kept for backward compatibility.
 */
export const getPoolPricesConfig = getOnchainDataConfig;

/**
 * Supported chain IDs for WebSocket subscriptions
 *
 * Production chains are always available.
 * Local chain (31337) is only available in non-production environments.
 * Derived from centralized chain registry in @midcurve/shared.
 */
export const SUPPORTED_CHAIN_IDS =
  process.env.NODE_ENV === 'production'
    ? REGISTRY_PRODUCTION_CHAIN_IDS
    : REGISTRY_ALL_CHAIN_IDS;

export type SupportedChainId = 1 | 42161 | 8453 | 11155111 | 31337;

/**
 * Get chain name (lowercase slug) for a chain ID
 * Delegates to chain registry.
 */
export function getChainName(chainId: SupportedChainId): string {
  return getChainShortName(chainId).toLowerCase();
}

/**
 * Get WebSocket RPC URL for a specific chain
 * Returns undefined if not configured
 */
export function getWssUrl(chainId: number): string | undefined {
  const envVar = getWsRpcEnvVarName(chainId);
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

// ============================================================
// Catch-Up Configuration
// ============================================================

/**
 * Catch-up configuration for recovering missed events
 */
export interface CatchUpConfig {
  /** Whether catch-up is enabled (default: true) */
  enabled: boolean;
  /** Maximum blocks per getLogs request (default: 10000, eth_getLogs provider limit) */
  batchSizeBlocks: number;
  /** Block tracking heartbeat interval in milliseconds (default: 60000) */
  heartbeatIntervalMs: number;
}

/**
 * Get catch-up configuration from environment
 */
export function getCatchUpConfig(): CatchUpConfig {
  return {
    enabled: process.env.CATCHUP_ENABLED !== 'false',
    batchSizeBlocks: parseInt(process.env.CATCHUP_BATCH_SIZE_BLOCKS || '10000', 10),
    heartbeatIntervalMs: parseInt(process.env.CATCHUP_HEARTBEAT_INTERVAL_MS || '60000', 10),
  };
}
