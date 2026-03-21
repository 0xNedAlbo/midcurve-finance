/**
 * Signer Client (Business Logic)
 *
 * Lightweight HTTP client for the midcurve-signer service.
 * Only implements the methods needed by business logic rules:
 * - getOperatorAddress: fetch the operator wallet address
 * - signRefuelOperator: sign a treasury refuel transaction
 */

import { businessLogicLogger } from '../lib/logger';

const log = businessLogicLogger.child({ component: 'SignerClient' });

// =============================================================================
// Types
// =============================================================================

export interface SignedTransaction {
  signedTransaction: string;
  nonce: number;
  txHash: string;
  from: string;
}

export interface HopInput {
  venueId: string;
  tokenIn: string;
  tokenOut: string;
  venueData: string;
}

export interface SignRefuelOperatorParams {
  chainId: number;
  treasuryAddress: string;
  tokenIn: string;
  amountIn: string;
  minEthOut: string;
  deadline: number;
  hops: HopInput[];
  gasLimit: string;
  gasPrice: string;
  nonce: number;
}

// =============================================================================
// Client
// =============================================================================

class SignerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private cachedOperatorAddress: string | null = null;

  constructor() {
    const url = process.env.SIGNER_URL;
    const apiKey = process.env.SIGNER_INTERNAL_API_KEY;

    if (!url) throw new Error('SIGNER_URL environment variable is required');
    if (!apiKey) throw new Error('SIGNER_INTERNAL_API_KEY environment variable is required');

    this.baseUrl = url;
    this.apiKey = apiKey;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error({ method, path, status: response.status, error: errorBody, msg: 'Signer request failed' });
      throw new Error(`Signer request failed: ${response.status} ${errorBody}`);
    }

    const data = (await response.json()) as { success: boolean; data?: T; error?: { message?: string } };

    if (!data.success) {
      log.error({ method, path, error: data.error, msg: 'Signer returned error' });
      throw new Error(`Signer error: ${data.error?.message || 'Unknown error'}`);
    }

    return data.data as T;
  }

  async getOperatorAddress(): Promise<string> {
    if (this.cachedOperatorAddress) {
      return this.cachedOperatorAddress;
    }

    const result = await this.request<{ address: string }>('GET', '/api/operator/address');
    this.cachedOperatorAddress = result.address;
    return result.address;
  }

  async signRefuelOperator(params: SignRefuelOperatorParams): Promise<SignedTransaction> {
    return this.request<SignedTransaction>('POST', '/api/sign/automation/treasury/refuel-operator', params);
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _signerClient: SignerClient | null = null;

export function getSignerClient(): SignerClient {
  if (!_signerClient) {
    _signerClient = new SignerClient();
  }
  return _signerClient;
}
