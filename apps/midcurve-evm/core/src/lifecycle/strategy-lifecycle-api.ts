import {
  type Address,
  type Hex,
  hashTypedData,
  recoverTypedDataAddress,
  type WalletClient,
  type PublicClient,
} from 'viem';
import type pino from 'pino';

// ============= EIP-712 Domain and Types =============

/**
 * Ethereum mainnet chain ID for EIP-712 domain
 * Users sign on mainnet, verification happens on SEMSEE chain
 */
const ETHEREUM_MAINNET_CHAIN_ID = 1;

/**
 * EIP-712 domain for lifecycle actions (start, shutdown)
 * Uses Ethereum mainnet chainId so users don't need to switch networks
 */
export const LIFECYCLE_DOMAIN = {
  name: 'Semsee',
  version: '1',
  chainId: ETHEREUM_MAINNET_CHAIN_ID,
} as const;

/**
 * EIP-712 types for Start action
 */
export const START_TYPES = {
  Start: [
    { name: 'strategy', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const;

/**
 * EIP-712 types for Shutdown action
 */
export const SHUTDOWN_TYPES = {
  Shutdown: [
    { name: 'strategy', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const;

/**
 * Default validity window for signed requests (5 minutes)
 */
const DEFAULT_VALIDITY_MS = 5 * 60 * 1000;

// ============= Message Types =============

/**
 * Message payload for Start action (EIP-712)
 */
export interface StartMessage {
  /** The strategy contract address */
  strategy: Address;
  /** Timestamp nonce for replay protection (Date.now()) */
  nonce: bigint;
  /** Expiry timestamp (nonce + validity window) */
  expiry: bigint;
}

/**
 * Message payload for Shutdown action (EIP-712)
 */
export interface ShutdownMessage {
  /** The strategy contract address */
  strategy: Address;
  /** Timestamp nonce for replay protection (Date.now()) */
  nonce: bigint;
  /** Expiry timestamp (nonce + validity window) */
  expiry: bigint;
}

/**
 * Signed Start request (message + signature)
 */
export interface SignedStartRequest {
  message: StartMessage;
  signature: Hex;
}

/**
 * Signed Shutdown request (message + signature)
 */
export interface SignedShutdownRequest {
  message: ShutdownMessage;
  signature: Hex;
}

/**
 * Verified lifecycle request (after signature verification)
 */
export interface VerifiedLifecycleRequest<T extends StartMessage | ShutdownMessage> {
  message: T;
  signature: Hex;
  recoveredOwner: Address;
}

/**
 * Result of a lifecycle operation
 */
export interface LifecycleResult {
  success: boolean;
  txHash?: Hex;
  errorMessage?: string;
}

// ============= Callback Types =============

/**
 * Callback to get strategy owner address
 */
export type GetStrategyOwnerCallback = (strategyAddress: Address) => Promise<Address>;

/**
 * Callback to execute start on strategy contract
 */
export type ExecuteStartCallback = (
  strategyAddress: Address,
  signature: Hex,
  nonce: bigint,
  expiry: bigint
) => Promise<Hex>;

/**
 * Callback to execute shutdown on strategy contract
 */
export type ExecuteShutdownCallback = (
  strategyAddress: Address,
  signature: Hex,
  nonce: bigint,
  expiry: bigint
) => Promise<Hex>;

// ============= Strategy Lifecycle API =============

/**
 * StrategyLifecycleApi handles signed lifecycle requests (start/shutdown).
 *
 * Key Features:
 * - EIP-712 signature verification on Ethereum mainnet (chainId: 1)
 * - Users sign without switching networks
 * - Automation wallet executes on SEMSEE chain
 *
 * Flow:
 * 1. User signs EIP-712 message with chainId: 1
 * 2. CLI/frontend sends signed request to backend
 * 3. Backend verifies signature recovers to strategy owner
 * 4. Backend executes action via automation wallet on SEMSEE chain
 */
export class StrategyLifecycleApi {
  constructor(
    private logger: pino.Logger,
    private getStrategyOwner: GetStrategyOwnerCallback,
    private executeStart?: ExecuteStartCallback,
    private executeShutdown?: ExecuteShutdownCallback
  ) {}

  /**
   * Set the execute start callback
   */
  setExecuteStartCallback(callback: ExecuteStartCallback): void {
    this.executeStart = callback;
  }

  /**
   * Set the execute shutdown callback
   */
  setExecuteShutdownCallback(callback: ExecuteShutdownCallback): void {
    this.executeShutdown = callback;
  }

  /**
   * Process a signed start request
   */
  async processStartRequest(request: SignedStartRequest): Promise<LifecycleResult> {
    const { message } = request;

    this.logger.info(
      {
        strategyAddress: message.strategy,
        nonce: message.nonce.toString(),
        expiry: message.expiry.toString(),
      },
      'Processing signed start request'
    );

    try {
      // Step 1: Verify the request
      const verified = await this.verifyStartRequest(request);

      // Step 2: Execute the start
      if (!this.executeStart) {
        throw new Error('Execute start callback not configured');
      }

      const txHash = await this.executeStart(
        message.strategy,
        request.signature,
        message.nonce,
        message.expiry
      );

      this.logger.info(
        {
          strategyAddress: message.strategy,
          txHash,
          recoveredOwner: verified.recoveredOwner,
        },
        'Strategy started successfully'
      );

      return {
        success: true,
        txHash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        {
          strategyAddress: message.strategy,
          error: errorMessage,
        },
        'Start request failed'
      );

      return {
        success: false,
        errorMessage,
      };
    }
  }

  /**
   * Process a signed shutdown request
   */
  async processShutdownRequest(request: SignedShutdownRequest): Promise<LifecycleResult> {
    const { message } = request;

    this.logger.info(
      {
        strategyAddress: message.strategy,
        nonce: message.nonce.toString(),
        expiry: message.expiry.toString(),
      },
      'Processing signed shutdown request'
    );

    try {
      // Step 1: Verify the request
      const verified = await this.verifyShutdownRequest(request);

      // Step 2: Execute the shutdown
      if (!this.executeShutdown) {
        throw new Error('Execute shutdown callback not configured');
      }

      const txHash = await this.executeShutdown(
        message.strategy,
        request.signature,
        message.nonce,
        message.expiry
      );

      this.logger.info(
        {
          strategyAddress: message.strategy,
          txHash,
          recoveredOwner: verified.recoveredOwner,
        },
        'Strategy shutdown successfully'
      );

      return {
        success: true,
        txHash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        {
          strategyAddress: message.strategy,
          error: errorMessage,
        },
        'Shutdown request failed'
      );

      return {
        success: false,
        errorMessage,
      };
    }
  }

  /**
   * Verify a signed start request
   */
  private async verifyStartRequest(
    request: SignedStartRequest
  ): Promise<VerifiedLifecycleRequest<StartMessage>> {
    const { message, signature } = request;

    // 1. Check expiry
    const now = BigInt(Date.now());
    if (message.expiry < now) {
      throw new Error(`Request expired at ${message.expiry}, current time is ${now}`);
    }

    // 2. Recover signer from signature
    const recoveredAddress = await recoverTypedDataAddress({
      domain: LIFECYCLE_DOMAIN,
      types: START_TYPES,
      primaryType: 'Start',
      message: {
        strategy: message.strategy,
        nonce: message.nonce,
        expiry: message.expiry,
      },
      signature,
    });

    // 3. Get strategy owner
    const ownerAddress = await this.getStrategyOwner(message.strategy);

    // 4. Verify recovered address matches owner
    if (recoveredAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new Error(
        `Signature verification failed: recovered ${recoveredAddress}, expected owner ${ownerAddress}`
      );
    }

    this.logger.info(
      {
        strategyAddress: message.strategy,
        recoveredOwner: recoveredAddress,
      },
      'Start request verified'
    );

    return {
      message,
      signature,
      recoveredOwner: recoveredAddress,
    };
  }

  /**
   * Verify a signed shutdown request
   */
  private async verifyShutdownRequest(
    request: SignedShutdownRequest
  ): Promise<VerifiedLifecycleRequest<ShutdownMessage>> {
    const { message, signature } = request;

    // 1. Check expiry
    const now = BigInt(Date.now());
    if (message.expiry < now) {
      throw new Error(`Request expired at ${message.expiry}, current time is ${now}`);
    }

    // 2. Recover signer from signature
    const recoveredAddress = await recoverTypedDataAddress({
      domain: LIFECYCLE_DOMAIN,
      types: SHUTDOWN_TYPES,
      primaryType: 'Shutdown',
      message: {
        strategy: message.strategy,
        nonce: message.nonce,
        expiry: message.expiry,
      },
      signature,
    });

    // 3. Get strategy owner
    const ownerAddress = await this.getStrategyOwner(message.strategy);

    // 4. Verify recovered address matches owner
    if (recoveredAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new Error(
        `Signature verification failed: recovered ${recoveredAddress}, expected owner ${ownerAddress}`
      );
    }

    this.logger.info(
      {
        strategyAddress: message.strategy,
        recoveredOwner: recoveredAddress,
      },
      'Shutdown request verified'
    );

    return {
      message,
      signature,
      recoveredOwner: recoveredAddress,
    };
  }
}

// ============= Helper Functions =============

/**
 * Create a start message with default expiry
 *
 * @param strategyAddress The strategy contract address
 * @param validityMs Validity window in milliseconds (default: 5 minutes)
 * @returns StartMessage ready for signing
 */
export function createStartMessage(
  strategyAddress: Address,
  validityMs: number = DEFAULT_VALIDITY_MS
): StartMessage {
  const now = BigInt(Date.now());

  return {
    strategy: strategyAddress,
    nonce: now,
    expiry: now + BigInt(validityMs),
  };
}

/**
 * Create a shutdown message with default expiry
 *
 * @param strategyAddress The strategy contract address
 * @param validityMs Validity window in milliseconds (default: 5 minutes)
 * @returns ShutdownMessage ready for signing
 */
export function createShutdownMessage(
  strategyAddress: Address,
  validityMs: number = DEFAULT_VALIDITY_MS
): ShutdownMessage {
  const now = BigInt(Date.now());

  return {
    strategy: strategyAddress,
    nonce: now,
    expiry: now + BigInt(validityMs),
  };
}

/**
 * Sign a start message using a wallet client
 *
 * @param walletClient Viem wallet client
 * @param message Start message to sign
 * @returns Signed start request
 */
export async function signStartMessage(
  walletClient: WalletClient,
  message: StartMessage
): Promise<SignedStartRequest> {
  const account = walletClient.account;
  if (!account) {
    throw new Error('Wallet client has no account');
  }

  const signature = await walletClient.signTypedData({
    account,
    domain: LIFECYCLE_DOMAIN,
    types: START_TYPES,
    primaryType: 'Start',
    message: {
      strategy: message.strategy,
      nonce: message.nonce,
      expiry: message.expiry,
    },
  });

  return {
    message,
    signature,
  };
}

/**
 * Sign a shutdown message using a wallet client
 *
 * @param walletClient Viem wallet client
 * @param message Shutdown message to sign
 * @returns Signed shutdown request
 */
export async function signShutdownMessage(
  walletClient: WalletClient,
  message: ShutdownMessage
): Promise<SignedShutdownRequest> {
  const account = walletClient.account;
  if (!account) {
    throw new Error('Wallet client has no account');
  }

  const signature = await walletClient.signTypedData({
    account,
    domain: LIFECYCLE_DOMAIN,
    types: SHUTDOWN_TYPES,
    primaryType: 'Shutdown',
    message: {
      strategy: message.strategy,
      nonce: message.nonce,
      expiry: message.expiry,
    },
  });

  return {
    message,
    signature,
  };
}

/**
 * Generate the EIP-712 hash for a start message
 * Useful for verifying what will be signed
 */
export function hashStartMessage(message: StartMessage): Hex {
  return hashTypedData({
    domain: LIFECYCLE_DOMAIN,
    types: START_TYPES,
    primaryType: 'Start',
    message: {
      strategy: message.strategy,
      nonce: message.nonce,
      expiry: message.expiry,
    },
  });
}

/**
 * Generate the EIP-712 hash for a shutdown message
 * Useful for verifying what will be signed
 */
export function hashShutdownMessage(message: ShutdownMessage): Hex {
  return hashTypedData({
    domain: LIFECYCLE_DOMAIN,
    types: SHUTDOWN_TYPES,
    primaryType: 'Shutdown',
    message: {
      strategy: message.strategy,
      nonce: message.nonce,
      expiry: message.expiry,
    },
  });
}
