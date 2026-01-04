/**
 * Automation Configuration
 *
 * Environment-based configuration for the automation service.
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
 * Worker configuration
 */
export interface WorkerConfig {
  /** Price polling interval in milliseconds */
  pricePollIntervalMs: number;
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
    pricePollIntervalMs: parseInt(process.env.PRICE_POLL_INTERVAL_MS || '10000', 10),
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
 */
const PRODUCTION_CHAIN_IDS = [1, 42161, 8453, 56, 137, 10] as const;
const LOCAL_CHAIN_IDS = [31337] as const;

// Include local chain only in non-production
export const SUPPORTED_CHAIN_IDS =
  process.env.NODE_ENV === 'production'
    ? PRODUCTION_CHAIN_IDS
    : ([...PRODUCTION_CHAIN_IDS, ...LOCAL_CHAIN_IDS] as const);

export type SupportedChainId =
  | (typeof PRODUCTION_CHAIN_IDS)[number]
  | (typeof LOCAL_CHAIN_IDS)[number];

/**
 * All possible chain IDs (for type checking)
 */
const ALL_CHAIN_IDS = [...PRODUCTION_CHAIN_IDS, ...LOCAL_CHAIN_IDS] as const;

/**
 * Check if a chain ID is supported
 */
export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (ALL_CHAIN_IDS as readonly number[]).includes(chainId);
}
