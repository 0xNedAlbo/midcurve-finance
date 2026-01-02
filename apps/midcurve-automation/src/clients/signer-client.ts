/**
 * Signer Client
 *
 * HTTP client for communicating with the midcurve-signer service.
 * Handles signing of deployment, registration, and execution transactions.
 */

import { getSignerConfig } from '../lib/config';
import { automationLogger } from '../lib/logger';

const log = automationLogger.child({ component: 'SignerClient' });

// =============================================================================
// Types
// =============================================================================

export interface SignedTransaction {
  signedTransaction: string;
  predictedAddress?: string;
  nonce: number;
  txHash: string;
  from: string;
}

export interface DeployCloserParams {
  userId: string;
  chainId: number;
  nfpmAddress: string;
}

export interface RegisterCloseParams {
  userId: string;
  chainId: number;
  contractAddress: string;
  nftId: string;
  sqrtPriceX96Lower: string;
  sqrtPriceX96Upper: string;
  payoutAddress: string;
  validUntil: string;
  slippageBps: number;
}

export interface ExecuteCloseParams {
  userId: string;
  chainId: number;
  contractAddress: string;
  closeId: number;
  feeRecipient: string;
  feeBps: number;
}

export interface CancelCloseParams {
  userId: string;
  chainId: number;
  contractAddress: string;
  closeId: number;
}

// =============================================================================
// Client
// =============================================================================

class SignerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    const config = getSignerConfig();
    this.baseUrl = config.url;
    this.apiKey = config.apiKey;
  }

  /**
   * Make an authenticated request to the signer service
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    log.debug({ method, path, msg: 'Making signer request' });

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
      log.error({
        method,
        path,
        status: response.status,
        error: errorBody,
        msg: 'Signer request failed',
      });
      throw new Error(`Signer request failed: ${response.status} ${errorBody}`);
    }

    const data = await response.json();

    if (!data.success) {
      log.error({
        method,
        path,
        error: data.error,
        msg: 'Signer returned error',
      });
      throw new Error(`Signer error: ${data.error?.message || 'Unknown error'}`);
    }

    return data.data as T;
  }

  /**
   * Sign a UniswapV3PositionCloser deployment transaction
   */
  async deployCloser(params: DeployCloserParams): Promise<SignedTransaction> {
    log.info({
      userId: params.userId,
      chainId: params.chainId,
      msg: 'Signing closer deployment',
    });

    return this.request<SignedTransaction>('POST', '/api/sign/automation/deploy-closer', params);
  }

  /**
   * Sign a registerClose transaction
   */
  async signRegisterClose(params: RegisterCloseParams): Promise<SignedTransaction> {
    log.info({
      userId: params.userId,
      chainId: params.chainId,
      contractAddress: params.contractAddress,
      nftId: params.nftId,
      msg: 'Signing close order registration',
    });

    return this.request<SignedTransaction>('POST', '/api/sign/automation/register-close', params);
  }

  /**
   * Sign an executeClose transaction
   */
  async signExecuteClose(params: ExecuteCloseParams): Promise<SignedTransaction> {
    log.info({
      userId: params.userId,
      chainId: params.chainId,
      contractAddress: params.contractAddress,
      closeId: params.closeId,
      msg: 'Signing close order execution',
    });

    return this.request<SignedTransaction>('POST', '/api/sign/automation/execute-close', params);
  }

  /**
   * Sign a cancelClose transaction
   */
  async signCancelClose(params: CancelCloseParams): Promise<SignedTransaction> {
    log.info({
      userId: params.userId,
      chainId: params.chainId,
      contractAddress: params.contractAddress,
      closeId: params.closeId,
      msg: 'Signing close order cancellation',
    });

    return this.request<SignedTransaction>('POST', '/api/sign/automation/cancel-close', params);
  }

  /**
   * Get or create automation wallet for a user
   */
  async getOrCreateWallet(userId: string): Promise<{ walletAddress: string }> {
    log.info({ userId, msg: 'Getting or creating automation wallet' });

    // First try to get existing wallet
    try {
      const existing = await this.request<{ wallet: { walletAddress: string } | null }>(
        'GET',
        `/api/wallets/automation?userId=${userId}`
      );

      if (existing.wallet) {
        return { walletAddress: existing.wallet.walletAddress };
      }
    } catch {
      // Wallet doesn't exist, create it
    }

    // Create new wallet
    const created = await this.request<{ wallet: { walletAddress: string } }>(
      'POST',
      '/api/wallets/automation',
      { userId, label: 'Position Automation Wallet' }
    );

    return { walletAddress: created.wallet.walletAddress };
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

export { SignerClient };
