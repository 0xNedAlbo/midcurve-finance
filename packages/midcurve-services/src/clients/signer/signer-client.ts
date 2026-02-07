/**
 * Signer Service Client
 *
 * Client for communicating with the midcurve-signer internal API.
 * This is used by backend services to trigger signing operations.
 *
 * Environment Variables:
 * - SIGNER_URL: Base URL of the signer service (default: http://localhost:3003)
 * - SIGNER_INTERNAL_API_KEY: Shared secret for authenticating with the signer service
 */

import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type {
  SignerConfig,
  SignerClientDependencies,
  SignerCreateAutomationWalletRequest,
  SignerCreateAutomationWalletResponse,
  SignerDeployStrategyRequest,
  SignerDeployStrategyResponse,
  SignerErrorResponse,
} from './types.js';

/**
 * Error thrown by the SignerClient
 */
export class SignerClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SignerClientError';
  }
}

/**
 * Client for communicating with the midcurve-signer service
 */
export class SignerClient {
  private static instance: SignerClient | null = null;

  private readonly logger: ServiceLogger;
  private readonly config: SignerConfig;

  constructor(dependencies: SignerClientDependencies = {}) {
    this.logger = dependencies.logger ?? createServiceLogger('SignerClient');
    this.config = dependencies.config ?? this.getConfigFromEnv();
  }

  /**
   * Get configuration from environment variables
   */
  private getConfigFromEnv(): SignerConfig {
    const baseUrl = process.env.SIGNER_URL || 'http://localhost:3003';
    const apiKey = process.env.SIGNER_INTERNAL_API_KEY;

    if (!apiKey) {
      throw new Error('SIGNER_INTERNAL_API_KEY environment variable is required');
    }

    return { baseUrl, apiKey };
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): SignerClient {
    if (!SignerClient.instance) {
      SignerClient.instance = new SignerClient();
    }
    return SignerClient.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    SignerClient.instance = null;
  }

  /**
   * Call the signer service to deploy a strategy contract
   *
   * @param request - Deployment request parameters
   * @returns Deployment result with contract address and transaction hash
   * @throws SignerClientError if deployment fails
   */
  async deployStrategyContract(
    request: SignerDeployStrategyRequest
  ): Promise<SignerDeployStrategyResponse['data']> {
    const url = `${this.config.baseUrl}/api/strategy/deploy`;

    this.logger.info({
      strategyId: request.strategyId,
      chainId: request.chainId,
      ownerAddress: request.ownerAddress,
      msg: 'Calling signer service to deploy strategy',
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
      });

      const data = (await response.json()) as SignerDeployStrategyResponse | SignerErrorResponse;

      if (!response.ok || !data.success) {
        const errorData = data as SignerErrorResponse;
        this.logger.error({
          strategyId: request.strategyId,
          statusCode: response.status,
          errorCode: errorData.error?.code,
          errorMessage: errorData.error?.message,
          msg: 'Signer service deployment failed',
        });

        throw new SignerClientError(
          errorData.error?.message || 'Deployment failed',
          errorData.error?.code || 'UNKNOWN_ERROR',
          response.status,
          errorData.error?.details
        );
      }

      const successData = data as SignerDeployStrategyResponse;

      this.logger.info({
        strategyId: request.strategyId,
        contractAddress: successData.data.contractAddress,
        transactionHash: successData.data.transactionHash,
        msg: 'Strategy deployed successfully via signer service',
      });

      return successData.data;
    } catch (error) {
      if (error instanceof SignerClientError) {
        throw error;
      }

      // Network or other fetch errors
      this.logger.error({
        strategyId: request.strategyId,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to communicate with signer service',
      });

      throw new SignerClientError(
        'Failed to communicate with signer service',
        'NETWORK_ERROR',
        503,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Create an automation wallet for a user via the signer service.
   *
   * @param request - Wallet creation request
   * @returns Created wallet data, or null if the user already has one (409)
   * @throws SignerClientError on unexpected failures
   */
  async createAutomationWallet(
    request: SignerCreateAutomationWalletRequest
  ): Promise<SignerCreateAutomationWalletResponse['wallet'] | null> {
    const url = `${this.config.baseUrl}/api/wallets/automation`;

    this.logger.info({
      userId: request.userId,
      msg: 'Creating automation wallet via signer service',
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
      });

      if (response.status === 409) {
        this.logger.info({
          userId: request.userId,
          msg: 'User already has an automation wallet',
        });
        return null;
      }

      const data = (await response.json()) as
        | SignerCreateAutomationWalletResponse
        | SignerErrorResponse;

      if (!response.ok || !data.success) {
        const errorData = data as SignerErrorResponse;
        this.logger.error({
          userId: request.userId,
          statusCode: response.status,
          errorCode: errorData.error?.code,
          errorMessage: errorData.error?.message,
          msg: 'Failed to create automation wallet',
        });

        throw new SignerClientError(
          errorData.error?.message || 'Wallet creation failed',
          errorData.error?.code || 'UNKNOWN_ERROR',
          response.status,
          errorData.error?.details
        );
      }

      const successData = data as SignerCreateAutomationWalletResponse;

      this.logger.info({
        userId: request.userId,
        walletAddress: successData.wallet.walletAddress,
        msg: 'Automation wallet created successfully',
      });

      return successData.wallet;
    } catch (error) {
      if (error instanceof SignerClientError) {
        throw error;
      }

      this.logger.error({
        userId: request.userId,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to communicate with signer service',
      });

      throw new SignerClientError(
        'Failed to communicate with signer service',
        'NETWORK_ERROR',
        503,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
