/**
 * Automation Configuration
 *
 * Environment-based configuration for the automation service.
 */

import {
  PRODUCTION_CHAIN_IDS as REGISTRY_PRODUCTION_CHAIN_IDS,
  ALL_CHAIN_IDS as REGISTRY_ALL_CHAIN_IDS,
  isSupportedChainId as registryIsSupportedChainId,
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
 * Worker configuration
 */
export interface WorkerConfig {
  /** Deploy polling interval in milliseconds */
  deployPollIntervalMs: number;
  /** Number of order executor instances (competing consumers) */
  orderExecutorPoolSize: number;
}

/**
 * Signer service configuration
 */
export interface SignerConfig {
  /** Signer service URL */
  url: string;
  /** Internal API key for authentication */
  apiKey: string;
}

/**
 * Fee configuration
 */
export interface FeeConfig {
  /** Address to receive execution fees */
  recipient: string;
  /** Execution fee in basis points (100 = 1%) */
  bps: number;
}

/**
 * Full automation configuration
 */
export interface AutomationConfig {
  rabbitmq: RabbitMQConfig;
  worker: WorkerConfig;
  signer: SignerConfig;
  fee: FeeConfig;
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
    deployPollIntervalMs: parseInt(process.env.DEPLOY_POLL_INTERVAL_MS || '5000', 10),
    orderExecutorPoolSize: parseInt(process.env.ORDER_EXECUTOR_POOL_SIZE || '3', 10),
  };
}

/**
 * Get signer service configuration from environment
 */
export function getSignerConfig(): SignerConfig {
  const url = process.env.SIGNER_URL;
  const apiKey = process.env.SIGNER_INTERNAL_API_KEY;

  if (!url) {
    throw new Error('SIGNER_URL environment variable is required');
  }
  if (!apiKey) {
    throw new Error('SIGNER_INTERNAL_API_KEY environment variable is required');
  }

  return { url, apiKey };
}

/**
 * Get fee configuration from environment
 */
export function getFeeConfig(): FeeConfig {
  const recipient = process.env.EXECUTION_FEE_RECIPIENT;
  if (!recipient) {
    throw new Error('EXECUTION_FEE_RECIPIENT environment variable is required');
  }

  return {
    recipient,
    bps: parseInt(process.env.EXECUTION_FEE_BPS || '50', 10),
  };
}

/**
 * Get full automation configuration
 */
export function getAutomationConfig(): AutomationConfig {
  return {
    rabbitmq: getRabbitMQConfig(),
    worker: getWorkerConfig(),
    signer: getSignerConfig(),
    fee: getFeeConfig(),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

/**
 * Supported chain IDs
 *
 * Production chains are always available.
 * Local chain (31337) is only available in non-production environments.
 * Derived from centralized chain registry in @midcurve/shared.
 */
export const SUPPORTED_CHAIN_IDS =
  process.env.NODE_ENV === 'production'
    ? REGISTRY_PRODUCTION_CHAIN_IDS
    : REGISTRY_ALL_CHAIN_IDS;

export type SupportedChainId = 1 | 42161 | 8453 | 31337;

/**
 * Check if a chain ID is supported
 */
export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return registryIsSupportedChainId(chainId);
}
