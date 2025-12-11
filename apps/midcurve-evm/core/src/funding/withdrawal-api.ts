import {
  type Address,
  type Hex,
  hashTypedData,
  recoverTypedDataAddress,
} from 'viem';
import type pino from 'pino';
import { FundingExecutor } from './funding-executor.js';
import {
  type SignedWithdrawRequest,
  type VerifiedWithdrawRequest,
  type WithdrawRequestMessage,
  type FundingResult,
  type Erc20WithdrawParams,
  type EthWithdrawParams,
  ETH_ADDRESS,
} from './types.js';

// ============= EIP-712 Domain and Types =============

/**
 * Ethereum mainnet chain ID for EIP-712 domain
 * Users sign on mainnet, verification happens on SEMSEE chain
 * This allows users to sign without switching networks
 */
const ETHEREUM_MAINNET_CHAIN_ID = 1;

/**
 * EIP-712 domain for withdrawal requests
 * Uses Ethereum mainnet chainId so users don't need to switch networks
 */
export const WITHDRAW_REQUEST_DOMAIN = {
  name: 'Semsee',
  version: '1',
  chainId: ETHEREUM_MAINNET_CHAIN_ID,
} as const;

/**
 * EIP-712 types for withdrawal requests
 *
 * Note: 'recipient' is NOT included - recipient is always the strategy owner.
 * This simplifies security by preventing theft via custom recipient.
 */
export const WITHDRAW_REQUEST_TYPES = {
  WithdrawRequest: [
    { name: 'strategyAddress', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const;

/**
 * Default validity window for signed requests (5 minutes)
 */
const DEFAULT_VALIDITY_MS = 5 * 60 * 1000;

// ============= Callback Types =============

/**
 * Callback to get strategy owner address
 */
export type GetStrategyOwnerCallback = (strategyAddress: Address) => Promise<Address>;

/**
 * Callback to check if strategy is running
 */
export type IsStrategyRunningCallback = (strategyAddress: Address) => Promise<boolean>;

/**
 * Callback to update BalanceStore
 */
export type UpdateBalanceCallback = (
  strategyAddress: Address,
  chainId: bigint,
  token: Address,
  balance: bigint
) => Promise<void>;

/**
 * Callback to notify strategy of withdrawal completion
 */
export type NotifyWithdrawCompleteCallback = (
  strategyAddress: Address,
  requestId: Hex,
  success: boolean,
  txHash: Hex,
  errorMessage: string
) => Promise<void>;

// ============= Withdrawal API =============

/**
 * WithdrawalApi handles signed withdrawal requests.
 *
 * Key Features:
 * - EIP-712 signature verification on Ethereum mainnet (chainId: 1)
 * - Users sign without switching networks
 * - Recipient is always the strategy owner (no custom recipient)
 * - Replay protection via timestamp nonces
 * - Expiry validation
 * - Balance updates always performed
 * - Strategy notification only when Running
 *
 * Flow:
 * 1. Verify signature recovers to strategy owner
 * 2. Check nonce not already used (replay protection)
 * 3. Check request not expired
 * 4. Execute withdrawal to owner address
 * 5. Update BalanceStore (always)
 * 6. Notify strategy if Running
 */
export class WithdrawalApi {
  /**
   * Track used nonces per strategy
   * Map<strategyAddress, Set<nonce>>
   * Nonces are only valid for a short window, cleaned up periodically
   */
  private usedNonces: Map<Address, Set<bigint>> = new Map();

  /**
   * Cleanup interval for expired nonces
   */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private executor: FundingExecutor,
    private logger: pino.Logger,
    private getStrategyOwner: GetStrategyOwnerCallback,
    private isStrategyRunning: IsStrategyRunningCallback,
    private updateBalance?: UpdateBalanceCallback,
    private notifyWithdrawComplete?: NotifyWithdrawCompleteCallback
  ) {
    // Start cleanup interval (every 5 minutes)
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredNonces();
    }, DEFAULT_VALIDITY_MS);
  }

  /**
   * Set the balance update callback
   */
  setUpdateBalanceCallback(callback: UpdateBalanceCallback): void {
    this.updateBalance = callback;
  }

  /**
   * Set the strategy notification callback
   */
  setNotifyWithdrawCompleteCallback(callback: NotifyWithdrawCompleteCallback): void {
    this.notifyWithdrawComplete = callback;
  }

  /**
   * Process a signed withdrawal request
   *
   * @param request The signed withdrawal request
   * @returns FundingResult with success/failure status
   */
  async processWithdrawRequest(request: SignedWithdrawRequest): Promise<FundingResult> {
    const { message } = request;

    // Generate request ID from message hash
    const requestId = this.generateRequestId(message);

    this.logger.info(
      {
        requestId,
        strategyAddress: message.strategyAddress,
        chainId: message.chainId.toString(),
        token: message.token,
        amount: message.amount.toString(),
      },
      'Processing signed withdrawal request'
    );

    try {
      // Step 1: Verify the request
      const verified = await this.verifyRequest(request, requestId);

      // Step 2: Mark nonce as used (replay protection)
      this.markNonceUsed(message.strategyAddress, message.nonce);

      // Step 3: Execute the withdrawal (to owner address)
      const result = await this.executeWithdrawal(verified);

      // Step 4: Update BalanceStore (always)
      await this.updateBalanceAfterWithdrawal(verified, result);

      // Step 5: Notify strategy (only if Running)
      await this.notifyStrategyIfRunning(verified, result);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        {
          requestId,
          strategyAddress: message.strategyAddress,
          error: errorMessage,
        },
        'Withdrawal request failed'
      );

      return {
        requestId,
        success: false,
        errorMessage,
      };
    }
  }

  /**
   * Verify a signed withdrawal request
   */
  private async verifyRequest(
    request: SignedWithdrawRequest,
    requestId: Hex
  ): Promise<VerifiedWithdrawRequest> {
    const { message, signature } = request;

    // 1. Check expiry
    const now = BigInt(Date.now());
    if (message.expiry < now) {
      throw new Error(`Request expired at ${message.expiry}, current time is ${now}`);
    }

    // 2. Check nonce not already used
    if (this.isNonceUsed(message.strategyAddress, message.nonce)) {
      throw new Error(`Nonce ${message.nonce} already used for strategy ${message.strategyAddress}`);
    }

    // 3. Recover signer from signature (no recipient in message)
    const recoveredAddress = await recoverTypedDataAddress({
      domain: WITHDRAW_REQUEST_DOMAIN,
      types: WITHDRAW_REQUEST_TYPES,
      primaryType: 'WithdrawRequest',
      message: {
        strategyAddress: message.strategyAddress,
        chainId: message.chainId,
        token: message.token,
        amount: message.amount,
        nonce: message.nonce,
        expiry: message.expiry,
      },
      signature,
    });

    // 4. Get strategy owner
    const ownerAddress = await this.getStrategyOwner(message.strategyAddress);

    // 5. Verify recovered address matches owner
    if (recoveredAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new Error(
        `Signature verification failed: recovered ${recoveredAddress}, expected owner ${ownerAddress}`
      );
    }

    this.logger.info(
      {
        requestId,
        strategyAddress: message.strategyAddress,
        recoveredOwner: recoveredAddress,
      },
      'Withdrawal request verified'
    );

    return {
      ...request,
      recoveredOwner: recoveredAddress,
      requestId,
    };
  }

  /**
   * Execute the withdrawal via FundingExecutor
   * Recipient is always the strategy owner (verified.recoveredOwner)
   */
  private async executeWithdrawal(verified: VerifiedWithdrawRequest): Promise<FundingResult> {
    const { message, requestId, recoveredOwner } = verified;

    // Recipient is ALWAYS the owner - no custom recipient allowed
    const recipient = recoveredOwner;

    // Determine if ETH or ERC-20 withdrawal
    const isEth = message.token.toLowerCase() === ETH_ADDRESS.toLowerCase();

    if (isEth) {
      const params: EthWithdrawParams = {
        type: 'eth',
        chainId: message.chainId,
        amount: message.amount,
      };

      return await this.executor.executeEthWithdraw(requestId, params, recipient);
    } else {
      const params: Erc20WithdrawParams = {
        type: 'erc20',
        chainId: message.chainId,
        token: message.token,
        amount: message.amount,
      };

      return await this.executor.executeErc20Withdraw(requestId, params, recipient);
    }
  }

  /**
   * Update BalanceStore after withdrawal (always, regardless of strategy state)
   */
  private async updateBalanceAfterWithdrawal(
    verified: VerifiedWithdrawRequest,
    result: FundingResult
  ): Promise<void> {
    if (!this.updateBalance) {
      return;
    }

    if (!result.success) {
      // Don't update balance on failed withdrawal
      return;
    }

    const { message } = verified;
    const isEth = message.token.toLowerCase() === ETH_ADDRESS.toLowerCase();

    try {
      // Get the new balance after withdrawal
      let newBalance: bigint;

      if (isEth) {
        newBalance = await this.executor.getEthBalance(message.chainId);
      } else {
        newBalance = await this.executor.getErc20Balance(message.chainId, message.token);
      }

      // Update BalanceStore
      await this.updateBalance(
        message.strategyAddress,
        message.chainId,
        message.token,
        newBalance
      );

      this.logger.info(
        {
          requestId: verified.requestId,
          strategyAddress: message.strategyAddress,
          chainId: message.chainId.toString(),
          token: message.token,
          newBalance: newBalance.toString(),
        },
        'Balance updated after withdrawal'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        {
          requestId: verified.requestId,
          strategyAddress: message.strategyAddress,
          error: errorMessage,
        },
        'Failed to update balance after withdrawal'
      );
    }
  }

  /**
   * Notify strategy of withdrawal completion (only if Running)
   */
  private async notifyStrategyIfRunning(
    verified: VerifiedWithdrawRequest,
    result: FundingResult
  ): Promise<void> {
    if (!this.notifyWithdrawComplete) {
      return;
    }

    const { message, requestId } = verified;

    // Check if strategy is running
    const isRunning = await this.isStrategyRunning(message.strategyAddress);

    if (!isRunning) {
      this.logger.info(
        {
          requestId,
          strategyAddress: message.strategyAddress,
        },
        'Strategy not running, skipping notification'
      );
      return;
    }

    // Notify strategy
    const txHashBytes32 =
      result.txHash ||
      ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hex);

    try {
      await this.notifyWithdrawComplete(
        message.strategyAddress,
        requestId,
        result.success,
        txHashBytes32,
        result.errorMessage || ''
      );

      this.logger.info(
        {
          requestId,
          strategyAddress: message.strategyAddress,
          success: result.success,
        },
        'Strategy notified of withdrawal completion'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        {
          requestId,
          strategyAddress: message.strategyAddress,
          error: errorMessage,
        },
        'Failed to notify strategy of withdrawal completion'
      );
    }
  }

  /**
   * Generate a unique request ID from message hash
   */
  private generateRequestId(message: WithdrawRequestMessage): Hex {
    // Hash the message to create a unique request ID (no recipient)
    return hashTypedData({
      domain: WITHDRAW_REQUEST_DOMAIN,
      types: WITHDRAW_REQUEST_TYPES,
      primaryType: 'WithdrawRequest',
      message: {
        strategyAddress: message.strategyAddress,
        chainId: message.chainId,
        token: message.token,
        amount: message.amount,
        nonce: message.nonce,
        expiry: message.expiry,
      },
    });
  }

  /**
   * Check if a nonce has been used
   */
  private isNonceUsed(strategyAddress: Address, nonce: bigint): boolean {
    const nonces = this.usedNonces.get(strategyAddress.toLowerCase() as Address);
    return nonces?.has(nonce) ?? false;
  }

  /**
   * Mark a nonce as used
   */
  private markNonceUsed(strategyAddress: Address, nonce: bigint): void {
    const key = strategyAddress.toLowerCase() as Address;
    let nonces = this.usedNonces.get(key);

    if (!nonces) {
      nonces = new Set<bigint>();
      this.usedNonces.set(key, nonces);
    }

    nonces.add(nonce);
  }

  /**
   * Cleanup expired nonces (called periodically)
   * Since nonces are timestamps and validity is 5 minutes,
   * we can remove any nonce older than 10 minutes
   */
  private cleanupExpiredNonces(): void {
    const cutoff = BigInt(Date.now() - 2 * DEFAULT_VALIDITY_MS);
    let cleaned = 0;

    for (const [strategyAddress, nonces] of this.usedNonces) {
      for (const nonce of nonces) {
        if (nonce < cutoff) {
          nonces.delete(nonce);
          cleaned++;
        }
      }

      // Remove empty sets
      if (nonces.size === 0) {
        this.usedNonces.delete(strategyAddress);
      }
    }

    if (cleaned > 0) {
      this.logger.debug({ cleaned }, 'Cleaned up expired nonces');
    }
  }

  /**
   * Stop the withdrawal API (cleanup)
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get the executor (for direct access if needed)
   */
  getExecutor(): FundingExecutor {
    return this.executor;
  }
}

// ============= Helper Functions =============

/**
 * Create a withdrawal request message with default expiry
 *
 * Note: No recipient parameter - recipient is always the strategy owner.
 *
 * @param params Withdrawal parameters (no recipient)
 * @param validityMs Validity window in milliseconds (default: 5 minutes)
 * @returns WithdrawRequestMessage ready for signing
 */
export function createWithdrawRequestMessage(
  params: {
    strategyAddress: Address;
    chainId: bigint;
    token: Address;
    amount: bigint;
  },
  validityMs: number = DEFAULT_VALIDITY_MS
): WithdrawRequestMessage {
  const now = BigInt(Date.now());

  return {
    ...params,
    nonce: now,
    expiry: now + BigInt(validityMs),
  };
}
