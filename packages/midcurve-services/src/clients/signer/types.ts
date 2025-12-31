/**
 * Signer Client Types
 *
 * Type definitions for the signer service client.
 */

import type { ServiceLogger } from '../../logging/index.js';

/**
 * Signer service configuration
 */
export interface SignerConfig {
  /** Base URL of the signer service (default: http://localhost:3001) */
  baseUrl: string;
  /** Shared secret for authenticating with the signer service */
  apiKey: string;
}

/**
 * Dependencies for SignerClient (for dependency injection)
 */
export interface SignerClientDependencies {
  /** Custom logger instance */
  logger?: ServiceLogger;
  /** Custom configuration (overrides environment variables) */
  config?: SignerConfig;
}

/**
 * Strategy deployment request to signer service
 */
export interface SignerDeployStrategyRequest {
  strategyId: string;
  chainId: number;
  ownerAddress: string;
}

/**
 * Strategy deployment response from signer service
 */
export interface SignerDeployStrategyResponse {
  success: true;
  data: {
    contractAddress: string;
    transactionHash: string;
    automationWallet: {
      id: string;
      address: string;
    };
    blockNumber: number;
  };
  requestId: string;
}

/**
 * Signer error response
 */
export interface SignerErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}
