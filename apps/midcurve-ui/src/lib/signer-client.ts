/**
 * Signer Service Client
 *
 * Client for communicating with the midcurve-signer internal API.
 * This is used by the UI backend (API routes) to trigger signing operations.
 *
 * Environment Variables:
 * - SIGNER_SERVICE_URL: Base URL of the signer service (default: http://localhost:3001)
 * - SIGNER_INTERNAL_API_KEY: Shared secret for authenticating with the signer service
 */

import { apiLogger } from './logger';

const logger = apiLogger.child({ client: 'signer' });

/**
 * Signer service configuration
 */
function getSignerConfig() {
  const baseUrl = process.env.SIGNER_SERVICE_URL || 'http://localhost:3001';
  const apiKey = process.env.SIGNER_INTERNAL_API_KEY;

  if (!apiKey) {
    throw new Error('SIGNER_INTERNAL_API_KEY environment variable is required');
  }

  return { baseUrl, apiKey };
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

/**
 * Signer client error
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
 * Call the signer service to deploy a strategy contract
 *
 * @param request - Deployment request parameters
 * @returns Deployment result with contract address and transaction hash
 * @throws SignerClientError if deployment fails
 */
export async function deployStrategyContract(
  request: SignerDeployStrategyRequest
): Promise<SignerDeployStrategyResponse['data']> {
  const config = getSignerConfig();
  const url = `${config.baseUrl}/api/strategy/deploy`;

  logger.info({
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
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorData = data as SignerErrorResponse;
      logger.error({
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

    logger.info({
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
    logger.error({
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
