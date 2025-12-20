/**
 * Signer Client
 *
 * HTTP client for calling midcurve-signer API endpoints.
 * Used to sign strategy transactions (deployment, step, submitEffectResult).
 *
 * The signer service owns the automation wallet private keys (via KMS).
 * This client requests signed transactions that we then broadcast to the network.
 */

import type { Address, Hex, Hash } from 'viem';
import { logger, evmLog } from '../../../lib/logger';

// =============================================================================
// Types
// =============================================================================

/**
 * Response from signing a deployment transaction
 */
export interface SignDeployResponse {
  signedTransaction: Hex;
  predictedAddress: Address;
  nonce: number;
  txHash: Hash;
}

/**
 * Response from signing a step or submitEffectResult transaction
 */
export interface SignContractCallResponse {
  signedTransaction: Hex;
  nonce: number;
  txHash: Hash;
}

/**
 * Input for signing a deployment transaction
 * Note: chainId is not configurable - signer only supports local SEMSEE (31337)
 * Note: ownerAddress removed - constructor params sourced from manifest
 */
export interface SignDeployInput {
  strategyId: string;
}

/**
 * Input for signing a step() transaction
 */
export interface SignStepInput {
  strategyId: string;
  stepInput: Hex;
}

/**
 * Input for signing a submitEffectResult() transaction
 */
export interface SignSubmitEffectResultInput {
  strategyId: string;
  epoch: string;
  idempotencyKey: Hex;
  ok: boolean;
  data: Hex;
}

// =============================================================================
// Vault Signing Types
// =============================================================================

/**
 * Input for signing a vault useFunds() transaction
 *
 * Transfers tokens from vault to operator wallet on public chain.
 * Used by USE_FUNDS effect handler.
 */
export interface SignVaultUseFundsInput {
  strategyId: string;
  /** Amount of tokens to transfer (bigint as string) */
  amount: string;
}

/**
 * Input for signing a vault returnFunds() transaction
 *
 * Returns tokens from operator wallet to vault on public chain.
 * Used by RETURN_FUNDS effect handler.
 */
export interface SignVaultReturnFundsInput {
  strategyId: string;
  /** Amount of tokens to return (bigint as string) */
  amount: string;
}

/**
 * Input for signing a vault reimburseGas() transaction
 *
 * Reimburses operator for gas costs from vault's ETH pool.
 * Called by orchestrator ONLY (not by effect handlers).
 */
export interface SignVaultReimburseGasInput {
  strategyId: string;
  /** Amount of ETH to reimburse in wei (bigint as string) */
  amountWei: string;
}

/**
 * API error response
 */
interface SignerErrorResponse {
  error: string;
  code?: string;
  statusCode?: number;
}

/**
 * Signer client configuration
 */
export interface SignerClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

// =============================================================================
// Error
// =============================================================================

export class SignerClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SignerClientError';
  }
}

// =============================================================================
// Client
// =============================================================================

export class SignerClient {
  private readonly log = logger.child({ client: 'SignerClient' });
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeout: number;

  constructor(config: SignerClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Sign a deployment transaction
   *
   * @param input - Deployment signing input
   * @returns Signed transaction and predicted contract address
   */
  async signDeployment(input: SignDeployInput): Promise<SignDeployResponse> {
    evmLog.methodEntry(this.log, 'signDeployment', { strategyId: input.strategyId });

    const response = await this.post<SignDeployResponse>(
      '/api/sign/strategy/deploy',
      input
    );

    evmLog.methodExit(this.log, 'signDeployment', {
      predictedAddress: response.predictedAddress,
    });

    return response;
  }

  /**
   * Sign a step() transaction
   *
   * @param input - Step signing input
   * @returns Signed transaction
   */
  async signStep(input: SignStepInput): Promise<SignContractCallResponse> {
    evmLog.methodEntry(this.log, 'signStep', { strategyId: input.strategyId });

    const response = await this.post<SignContractCallResponse>(
      '/api/sign/strategy/step',
      input
    );

    evmLog.methodExit(this.log, 'signStep', { nonce: response.nonce });

    return response;
  }

  /**
   * Sign a submitEffectResult() transaction
   *
   * @param input - Submit effect result signing input
   * @returns Signed transaction
   */
  async signSubmitEffectResult(
    input: SignSubmitEffectResultInput
  ): Promise<SignContractCallResponse> {
    evmLog.methodEntry(this.log, 'signSubmitEffectResult', {
      strategyId: input.strategyId,
      epoch: input.epoch,
    });

    const response = await this.post<SignContractCallResponse>(
      '/api/sign/strategy/submit-effect-result',
      input
    );

    evmLog.methodExit(this.log, 'signSubmitEffectResult', { nonce: response.nonce });

    return response;
  }

  // =============================================================================
  // Vault Signing Methods
  // =============================================================================

  /**
   * Sign a vault useFunds() transaction
   *
   * Transfers tokens from vault to operator wallet on public chain.
   * Called by the USE_FUNDS effect handler.
   *
   * @param input - Use funds signing input
   * @returns Signed transaction for public chain
   */
  async signVaultUseFunds(
    input: SignVaultUseFundsInput
  ): Promise<SignContractCallResponse> {
    evmLog.methodEntry(this.log, 'signVaultUseFunds', {
      strategyId: input.strategyId,
      amount: input.amount,
    });

    const response = await this.post<SignContractCallResponse>(
      '/api/sign/vault/use-funds',
      input
    );

    evmLog.methodExit(this.log, 'signVaultUseFunds', { nonce: response.nonce });

    return response;
  }

  /**
   * Sign a vault returnFunds() transaction
   *
   * Returns tokens from operator wallet to vault on public chain.
   * Called by the RETURN_FUNDS effect handler.
   *
   * @param input - Return funds signing input
   * @returns Signed transaction for public chain
   */
  async signVaultReturnFunds(
    input: SignVaultReturnFundsInput
  ): Promise<SignContractCallResponse> {
    evmLog.methodEntry(this.log, 'signVaultReturnFunds', {
      strategyId: input.strategyId,
      amount: input.amount,
    });

    const response = await this.post<SignContractCallResponse>(
      '/api/sign/vault/return-funds',
      input
    );

    evmLog.methodExit(this.log, 'signVaultReturnFunds', { nonce: response.nonce });

    return response;
  }

  /**
   * Sign a vault reimburseGas() transaction
   *
   * Reimburses operator for gas costs from vault's ETH pool.
   * Called by the orchestrator ONLY after executing vault operations.
   *
   * @param input - Reimburse gas signing input
   * @returns Signed transaction for public chain
   */
  async signVaultReimburseGas(
    input: SignVaultReimburseGasInput
  ): Promise<SignContractCallResponse> {
    evmLog.methodEntry(this.log, 'signVaultReimburseGas', {
      strategyId: input.strategyId,
      amountWei: input.amountWei,
    });

    const response = await this.post<SignContractCallResponse>(
      '/api/sign/vault/reimburse-gas',
      input
    );

    evmLog.methodExit(this.log, 'signVaultReimburseGas', { nonce: response.nonce });

    return response;
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as SignerErrorResponse;
        throw new SignerClientError(
          errorData.error || `Signer request failed: ${response.status}`,
          response.status,
          errorData.code,
          errorData
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof SignerClientError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new SignerClientError('Request timeout', 408, 'TIMEOUT');
      }

      throw new SignerClientError(
        error instanceof Error ? error.message : 'Unknown error',
        500,
        'NETWORK_ERROR',
        error
      );
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

let signerClientInstance: SignerClient | null = null;

/**
 * Get the singleton signer client instance
 */
export function getSignerClient(): SignerClient {
  if (!signerClientInstance) {
    const baseUrl = process.env.SIGNER_SERVICE_URL;
    if (!baseUrl) {
      throw new Error('SIGNER_SERVICE_URL environment variable is required');
    }

    signerClientInstance = new SignerClient({
      baseUrl,
      apiKey: process.env.SIGNER_INTERNAL_API_KEY,
      timeout: 30000,
    });
  }

  return signerClientInstance;
}
