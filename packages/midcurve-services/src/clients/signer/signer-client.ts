/**
 * Signer API Client
 *
 * HTTP client for the midcurve-signer service that manages KMS-backed
 * automation wallets and transaction signing with intent compliance checking.
 *
 * Features:
 * - Automation wallet creation (KMS-backed or local encryption)
 * - Get wallet by user ID
 * - Sign ERC-20 approve transactions with intent compliance verification
 *
 * Transaction Signing Flow:
 * 1. Caller provides signed strategy intent (EIP-712)
 * 2. Signer verifies the intent signature
 * 3. Signer checks operation compliance (allowedCurrencies, allowedEffects)
 * 4. Signer signs the transaction with KMS
 * 5. Caller broadcasts the signed transaction
 *
 * Security:
 * - Uses internal API key authentication (Bearer token)
 * - Should only be called from backend services (not exposed to clients)
 * - Signer service runs in private subnet
 * - Intent compliance prevents unauthorized operations
 */

import type { SignedStrategyIntentV1, StrategyType } from '@midcurve/shared';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

// ============ Types ============

/**
 * Configuration for SignerClient
 */
export interface SignerClientConfig {
  /** Base URL of the signer service (e.g., http://localhost:3002) */
  baseUrl: string;
  /** Internal API key for authentication */
  apiKey: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/**
 * Key provider type for automation wallets
 */
export type KeyProvider = 'aws-kms' | 'local-encrypted';

/**
 * Automation wallet returned from signer API
 */
export interface AutomationWallet {
  /** Unique wallet ID */
  id: string;
  /** User ID who owns this wallet */
  userId: string;
  /** Wallet address (EIP-55 checksummed) */
  walletAddress: string;
  /** Human-readable label */
  label: string;
  /** Key storage provider */
  keyProvider: KeyProvider;
  /** Whether wallet is active */
  isActive: boolean;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Last usage timestamp (null if never used) */
  lastUsedAt: string | null;
}

/**
 * Request to create an automation wallet
 */
export interface CreateWalletRequest {
  /** User ID to create wallet for */
  userId: string;
  /** Human-readable label for the wallet */
  label: string;
}

/**
 * Request to verify a signed strategy intent
 */
export interface VerifyIntentRequest {
  /** User ID who should own the intent */
  userId: string;
  /** Chain ID for EIP-712 domain */
  chainId: number;
  /** Signed strategy intent */
  signedIntent: SignedStrategyIntentV1;
}

/**
 * Result of intent verification
 */
export interface VerifyIntentResult {
  /** Unique intent ID from the intent document */
  intentId: string;
  /** Strategy type from the intent */
  strategyType: StrategyType;
  /** Address that signed the intent */
  signer: string;
  /** Automation wallet address the intent authorizes */
  walletAddress: string;
  /** Whether the signature is valid */
  verified: boolean;
}

// ============ Signing Request/Response Types ============

/**
 * Request to sign an ERC-20 approve transaction
 */
export interface SignErc20ApproveRequest {
  /** User ID who owns the strategy */
  userId: string;
  /** Chain ID for the transaction */
  chainId: number;
  /** Signed strategy intent (for authorization) */
  signedIntent: SignedStrategyIntentV1;
  /** ERC-20 token address to approve */
  tokenAddress: string;
  /** Spender address (e.g., Uniswap router) */
  spenderAddress: string;
  /** Amount to approve (as string for bigint precision) */
  amount: string;
}

/**
 * Signed transaction result
 */
export interface SignedTransaction {
  /** Signed transaction ready to broadcast (hex-encoded) */
  signedTx: string;
  /** Transaction hash */
  txHash: string;
  /** From address (automation wallet) */
  from: string;
  /** To address (contract) */
  to: string;
  /** Chain ID */
  chainId: number;
  /** Encoded calldata */
  calldata: string;
}

// ============ Error Classes ============

/**
 * Base error class for SignerClient errors
 */
export class SignerClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'SignerClientError';
  }
}

/**
 * Error when authentication fails
 */
export class SignerAuthenticationError extends SignerClientError {
  constructor(message: string, requestId?: string) {
    super(message, 'UNAUTHORIZED', 401, requestId);
    this.name = 'SignerAuthenticationError';
  }
}

/**
 * Error when resource is not found
 */
export class SignerNotFoundError extends SignerClientError {
  constructor(message: string, requestId?: string) {
    super(message, 'NOT_FOUND', 404, requestId);
    this.name = 'SignerNotFoundError';
  }
}

/**
 * Error when request validation fails
 */
export class SignerValidationError extends SignerClientError {
  constructor(message: string, requestId?: string) {
    super(message, 'VALIDATION_ERROR', 400, requestId);
    this.name = 'SignerValidationError';
  }
}

/**
 * Error when intent verification fails
 */
export class SignerVerificationError extends SignerClientError {
  constructor(message: string, requestId?: string) {
    super(message, 'VERIFICATION_FAILED', 400, requestId);
    this.name = 'SignerVerificationError';
  }
}

/**
 * Error when intent compliance check fails
 */
export class SignerComplianceError extends SignerClientError {
  constructor(message: string, code: string, requestId?: string) {
    super(message, code, 400, requestId);
    this.name = 'SignerComplianceError';
  }
}

/**
 * Error when signing operation fails
 */
export class SignerSigningError extends SignerClientError {
  constructor(message: string, requestId?: string) {
    super(message, 'SIGNING_FAILED', 500, requestId);
    this.name = 'SignerSigningError';
  }
}

// ============ Response Types ============

interface ApiErrorResponse {
  success: false;
  error: string;
  message: string;
  requestId?: string;
}

interface WalletResponse {
  success: true;
  requestId?: string;
  wallet: AutomationWallet;
}

interface VerifyResponse {
  success: true;
  requestId?: string;
  intentId: string;
  strategyType: StrategyType;
  signer: string;
  walletAddress: string;
  verified: boolean;
}

interface SignResponse {
  success: true;
  requestId?: string;
  signedTx: string;
  txHash: string;
  from: string;
  to: string;
  chainId: number;
  calldata: string;
}

// ============ Client Implementation ============

/**
 * Signer API Client
 *
 * Provides methods for interacting with the midcurve-signer service.
 *
 * @example
 * ```typescript
 * const client = new SignerClient({
 *   baseUrl: 'http://localhost:3002',
 *   apiKey: process.env.SIGNER_INTERNAL_API_KEY!,
 * });
 *
 * // Create automation wallet
 * const wallet = await client.createWallet({
 *   userId: 'user_123',
 *   label: 'Strategy Wallet',
 * });
 *
 * // Verify signed intent
 * const result = await client.verifyIntent({
 *   userId: 'user_123',
 *   chainId: 1,
 *   signedIntent: { intent: {...}, signature: '0x...', signer: '0x...' },
 * });
 * ```
 */
export class SignerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly logger: ServiceLogger;

  constructor(config: SignerClientConfig) {
    // Remove trailing slash from base URL
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.logger = createServiceLogger('SignerClient');

    this.logger.debug({ baseUrl: this.baseUrl }, 'SignerClient initialized');
  }

  // ==========================================================================
  // Wallet Operations
  // ==========================================================================

  /**
   * Create a new automation wallet for a user
   *
   * Creates a KMS-backed (production) or locally encrypted (development)
   * wallet that can be used to sign transactions on behalf of the user.
   *
   * @param request - Wallet creation request
   * @returns Created automation wallet
   * @throws SignerAuthenticationError if API key is invalid
   * @throws SignerValidationError if request is invalid
   * @throws SignerClientError for other errors
   */
  async createWallet(request: CreateWalletRequest): Promise<AutomationWallet> {
    this.logger.debug(
      { userId: request.userId, label: request.label },
      'Creating automation wallet'
    );

    const response = await this.postWallet('/api/wallets', request);

    if (!response.success) {
      throw this.createError(response);
    }

    const wallet = response.wallet;
    this.logger.info(
      { userId: request.userId, walletAddress: wallet.walletAddress },
      'Automation wallet created'
    );

    return wallet;
  }

  /**
   * Get automation wallet for a user
   *
   * @param userId - User ID to get wallet for
   * @returns Automation wallet or null if not found
   * @throws SignerAuthenticationError if API key is invalid
   * @throws SignerClientError for other errors
   */
  async getWallet(userId: string): Promise<AutomationWallet | null> {
    this.logger.debug({ userId }, 'Fetching automation wallet');

    try {
      const response = await this.getWalletRequest(`/api/wallets/${userId}`);

      if (!response.success) {
        if (response.error === 'NOT_FOUND') {
          return null;
        }
        throw this.createError(response);
      }

      return response.wallet;
    } catch (error) {
      if (error instanceof SignerNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get or create automation wallet for a user
   *
   * Convenience method that returns existing wallet or creates a new one.
   *
   * @param userId - User ID to get/create wallet for
   * @param label - Label to use if creating new wallet
   * @returns Automation wallet (existing or newly created)
   */
  async getOrCreateWallet(
    userId: string,
    label: string
  ): Promise<AutomationWallet> {
    const existing = await this.getWallet(userId);
    if (existing) {
      return existing;
    }
    return this.createWallet({ userId, label });
  }

  // ==========================================================================
  // Intent Verification
  // ==========================================================================

  /**
   * Verify a signed strategy intent
   *
   * Validates the EIP-712 signature and checks that the signer
   * is authorized to create intents for the specified user.
   *
   * @param request - Intent verification request
   * @returns Verification result
   * @throws SignerAuthenticationError if API key is invalid
   * @throws SignerVerificationError if signature is invalid
   * @throws SignerValidationError if request is invalid
   * @throws SignerClientError for other errors
   */
  async verifyIntent(request: VerifyIntentRequest): Promise<VerifyIntentResult> {
    this.logger.debug(
      {
        userId: request.userId,
        chainId: request.chainId,
        intentId: request.signedIntent.intent.id,
      },
      'Verifying strategy intent'
    );

    const response = await this.postVerify(
      '/api/sign/test-evm-wallet',
      request
    );

    if (!response.success) {
      throw this.createError(response);
    }

    const result: VerifyIntentResult = {
      intentId: response.intentId,
      strategyType: response.strategyType,
      signer: response.signer,
      walletAddress: response.walletAddress,
      verified: response.verified,
    };

    if (!result.verified) {
      throw new SignerVerificationError(
        'Intent signature verification failed',
        response.requestId
      );
    }

    this.logger.info(
      {
        intentId: result.intentId,
        strategyType: result.strategyType,
        signer: result.signer,
        verified: result.verified,
      },
      'Strategy intent verified'
    );

    return result;
  }

  // ==========================================================================
  // Transaction Signing
  // ==========================================================================

  /**
   * Sign an ERC-20 approve transaction
   *
   * Requests the signer service to sign an ERC-20 approve transaction.
   * The signer verifies the EIP-712 signature on the strategy intent and
   * checks that the operation is compliant with the intent's allowedCurrencies
   * and allowedEffects before signing.
   *
   * @param request - ERC-20 approve signing request
   * @returns Signed transaction ready to broadcast
   * @throws SignerAuthenticationError if API key is invalid
   * @throws SignerVerificationError if intent signature is invalid
   * @throws SignerComplianceError if operation is not compliant with intent
   * @throws SignerSigningError if signing fails
   * @throws SignerClientError for other errors
   *
   * @example
   * ```typescript
   * const signedTx = await client.signErc20Approve({
   *   userId: 'user_123',
   *   chainId: 1,
   *   signedIntent: { intent: {...}, signature: '0x...', signer: '0x...' },
   *   tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
   *   spenderAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap Router
   *   amount: '1000000000', // 1000 USDC (6 decimals)
   * });
   *
   * // Broadcast the signed transaction
   * const txHash = await walletClient.sendRawTransaction({
   *   serializedTransaction: signedTx.signedTx as `0x${string}`,
   * });
   * ```
   */
  async signErc20Approve(
    request: SignErc20ApproveRequest
  ): Promise<SignedTransaction> {
    this.logger.debug(
      {
        userId: request.userId,
        chainId: request.chainId,
        intentId: request.signedIntent.intent.id,
        tokenAddress: request.tokenAddress,
        spenderAddress: request.spenderAddress,
      },
      'Requesting ERC-20 approve signature'
    );

    const response = await this.postSign('/api/sign/erc20/approve', request);

    if (!response.success) {
      throw this.createError(response);
    }

    const result: SignedTransaction = {
      signedTx: response.signedTx,
      txHash: response.txHash,
      from: response.from,
      to: response.to,
      chainId: response.chainId,
      calldata: response.calldata,
    };

    this.logger.info(
      {
        userId: request.userId,
        chainId: request.chainId,
        tokenAddress: request.tokenAddress,
        spenderAddress: request.spenderAddress,
        txHash: result.txHash,
        from: result.from,
      },
      'ERC-20 approve transaction signed'
    );

    return result;
  }

  // ==========================================================================
  // HTTP Helpers
  // ==========================================================================

  /**
   * Make a GET request for wallet data
   */
  private async getWalletRequest(
    path: string
  ): Promise<WalletResponse | ApiErrorResponse> {
    const url = `${this.baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      // Handle non-OK status codes
      if (!response.ok) {
        return {
          success: false,
          error: data.error ?? 'UNKNOWN_ERROR',
          message: data.message ?? `HTTP ${response.status}`,
          requestId: data.requestId,
        };
      }

      return data as WalletResponse;
    } catch (error) {
      return this.handleFetchError(error, url);
    }
  }

  /**
   * Make a POST request for wallet operations
   */
  private async postWallet(
    path: string,
    body: unknown
  ): Promise<WalletResponse | ApiErrorResponse> {
    const url = `${this.baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      // Handle non-OK status codes
      if (!response.ok) {
        return {
          success: false,
          error: data.error ?? 'UNKNOWN_ERROR',
          message: data.message ?? `HTTP ${response.status}`,
          requestId: data.requestId,
        };
      }

      return data as WalletResponse;
    } catch (error) {
      return this.handleFetchError(error, url);
    }
  }

  /**
   * Make a POST request for intent verification
   */
  private async postVerify(
    path: string,
    body: unknown
  ): Promise<VerifyResponse | ApiErrorResponse> {
    const url = `${this.baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      // Handle non-OK status codes
      if (!response.ok) {
        return {
          success: false,
          error: data.error ?? 'UNKNOWN_ERROR',
          message: data.message ?? `HTTP ${response.status}`,
          requestId: data.requestId,
        };
      }

      return data as VerifyResponse;
    } catch (error) {
      return this.handleFetchError(error, url);
    }
  }

  /**
   * Make a POST request for transaction signing
   */
  private async postSign(
    path: string,
    body: unknown
  ): Promise<SignResponse | ApiErrorResponse> {
    const url = `${this.baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      // Handle non-OK status codes
      if (!response.ok) {
        return {
          success: false,
          error: data.error ?? 'UNKNOWN_ERROR',
          message: data.message ?? `HTTP ${response.status}`,
          requestId: data.requestId,
        };
      }

      return data as SignResponse;
    } catch (error) {
      return this.handleFetchError(error, url);
    }
  }

  /**
   * Handle fetch errors (network, timeout, etc.)
   */
  private handleFetchError(error: unknown, url: string): ApiErrorResponse {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'TIMEOUT',
          message: `Request to ${url} timed out after ${this.timeoutMs}ms`,
        };
      }

      return {
        success: false,
        error: 'NETWORK_ERROR',
        message: error.message,
      };
    }

    return {
      success: false,
      error: 'UNKNOWN_ERROR',
      message: String(error),
    };
  }

  /**
   * Create appropriate error from API error response
   */
  private createError(response: ApiErrorResponse): SignerClientError {
    const { error, message, requestId } = response;

    switch (error) {
      case 'UNAUTHORIZED':
        return new SignerAuthenticationError(message, requestId);
      case 'NOT_FOUND':
        return new SignerNotFoundError(message, requestId);
      case 'VALIDATION_ERROR':
        return new SignerValidationError(message, requestId);
      case 'VERIFICATION_FAILED':
        return new SignerVerificationError(message, requestId);
      case 'SIGNING_FAILED':
        return new SignerSigningError(message, requestId);
      // Compliance errors
      case 'TOKEN_NOT_ALLOWED':
      case 'EFFECT_NOT_ALLOWED':
      case 'COMPLIANCE_FAILED':
        return new SignerComplianceError(message, error, requestId);
      default:
        return new SignerClientError(
          message,
          error,
          undefined,
          requestId
        );
    }
  }
}
