import type { Address, Hex } from 'viem';
import type pino from 'pino';
import { FundingExecutor } from './funding-executor.js';
import { DepositWatcher } from './deposit-watcher.js';
import {
  type WithdrawRequest,
  type EthBalanceUpdateRequest,
  type FundingRequest,
  type FundingResult,
  type DetectedErc20Deposit,
  type Erc20WithdrawParams,
  type EthWithdrawParams,
  ETH_ADDRESS,
  isErc20Withdraw,
  isEthWithdraw,
} from './types.js';
import type {
  Erc20WithdrawRequestedEvent,
  EthWithdrawRequestedEvent,
  EthBalanceUpdateRequestedEvent,
} from '../events/types.js';

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
 * Callback to notify strategy of deposit/withdrawal completion
 */
export type NotifyStrategyCallback = (
  strategyAddress: Address,
  functionName: string,
  args: unknown[]
) => Promise<void>;

/**
 * FundingManager coordinates all funding operations.
 *
 * Responsibilities:
 * - Process withdrawal requests from strategies
 * - Process ETH balance update requests
 * - Handle deposit notifications from DepositWatcher
 * - Coordinate with BalanceStore updates
 * - Deliver callbacks to strategies
 *
 * Key Flow:
 * 1. BalanceStore is ALWAYS updated BEFORE strategy callback
 * 2. This prevents stale data reads in strategy callbacks
 */
export class FundingManager {
  private pendingRequests: Map<Hex, FundingRequest> = new Map();

  constructor(
    private executor: FundingExecutor,
    private depositWatcher: DepositWatcher,
    private logger: pino.Logger,
    private updateBalanceCallback?: UpdateBalanceCallback,
    private notifyStrategyCallback?: NotifyStrategyCallback
  ) {
    // Register deposit callback
    this.depositWatcher.setOnDepositCallback(this.handleDeposit.bind(this));
  }

  /**
   * Set the callback for updating BalanceStore
   */
  setUpdateBalanceCallback(callback: UpdateBalanceCallback): void {
    this.updateBalanceCallback = callback;
  }

  /**
   * Set the callback for notifying strategies
   */
  setNotifyStrategyCallback(callback: NotifyStrategyCallback): void {
    this.notifyStrategyCallback = callback;
  }

  /**
   * Process an ERC-20 withdrawal request event
   */
  async processErc20WithdrawRequest(
    strategyAddress: Address,
    ownerAddress: Address,
    event: Erc20WithdrawRequestedEvent
  ): Promise<void> {
    const params: Erc20WithdrawParams = {
      type: 'erc20',
      chainId: event.chainId,
      token: event.token,
      amount: event.amount,
    };

    const request: WithdrawRequest = {
      requestId: event.requestId,
      strategyAddress,
      ownerAddress,
      operation: 'withdraw',
      params,
      recipient: event.recipient,
      createdAt: Date.now(),
    };

    this.pendingRequests.set(event.requestId, request);

    this.logger.info(
      {
        requestId: event.requestId,
        strategy: strategyAddress,
        chainId: event.chainId.toString(),
        token: event.token,
        amount: event.amount.toString(),
        recipient: event.recipient,
      },
      'Processing ERC-20 withdrawal request'
    );

    // Execute the withdrawal
    const result = await this.executor.executeErc20Withdraw(
      event.requestId,
      params,
      event.recipient
    );

    await this.handleWithdrawResult(request, result);
  }

  /**
   * Process an ETH withdrawal request event
   */
  async processEthWithdrawRequest(
    strategyAddress: Address,
    ownerAddress: Address,
    event: EthWithdrawRequestedEvent
  ): Promise<void> {
    const params: EthWithdrawParams = {
      type: 'eth',
      chainId: event.chainId,
      amount: event.amount,
    };

    const request: WithdrawRequest = {
      requestId: event.requestId,
      strategyAddress,
      ownerAddress,
      operation: 'withdraw',
      params,
      recipient: event.recipient,
      createdAt: Date.now(),
    };

    this.pendingRequests.set(event.requestId, request);

    this.logger.info(
      {
        requestId: event.requestId,
        strategy: strategyAddress,
        chainId: event.chainId.toString(),
        amount: event.amount.toString(),
        recipient: event.recipient,
      },
      'Processing ETH withdrawal request'
    );

    // Execute the withdrawal
    const result = await this.executor.executeEthWithdraw(
      event.requestId,
      params,
      event.recipient
    );

    await this.handleWithdrawResult(request, result);
  }

  /**
   * Process an ETH balance update request event
   */
  async processEthBalanceUpdateRequest(
    strategyAddress: Address,
    ownerAddress: Address,
    event: EthBalanceUpdateRequestedEvent
  ): Promise<void> {
    const request: EthBalanceUpdateRequest = {
      requestId: event.requestId,
      strategyAddress,
      ownerAddress,
      operation: 'ethBalanceUpdate',
      params: {
        chainId: event.chainId,
      },
      createdAt: Date.now(),
    };

    this.pendingRequests.set(event.requestId, request);

    this.logger.info(
      {
        requestId: event.requestId,
        strategy: strategyAddress,
        chainId: event.chainId.toString(),
      },
      'Processing ETH balance update request'
    );

    try {
      // Poll the ETH balance
      const balance = await this.executor.getEthBalance(event.chainId);

      // Update BalanceStore FIRST
      if (this.updateBalanceCallback) {
        await this.updateBalanceCallback(
          strategyAddress,
          event.chainId,
          ETH_ADDRESS,
          balance
        );
      }

      // Then notify strategy
      if (this.notifyStrategyCallback) {
        await this.notifyStrategyCallback(strategyAddress, 'onEthBalanceUpdated', [
          event.chainId,
          balance,
        ]);
      }

      this.logger.info(
        {
          requestId: event.requestId,
          strategy: strategyAddress,
          chainId: event.chainId.toString(),
          balance: balance.toString(),
        },
        'ETH balance update completed'
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        {
          requestId: event.requestId,
          strategy: strategyAddress,
          error: errorMessage,
        },
        'ETH balance update failed'
      );
    } finally {
      this.pendingRequests.delete(event.requestId);
    }
  }

  /**
   * Handle withdrawal result
   */
  private async handleWithdrawResult(
    request: WithdrawRequest,
    result: FundingResult
  ): Promise<void> {
    try {
      if (result.success) {
        // Get the new balance after withdrawal
        let newBalance: bigint;
        const params = request.params;

        if (isErc20Withdraw(params)) {
          newBalance = await this.executor.getErc20Balance(
            params.chainId,
            params.token
          );

          // Update BalanceStore FIRST
          if (this.updateBalanceCallback) {
            await this.updateBalanceCallback(
              request.strategyAddress,
              params.chainId,
              params.token,
              newBalance
            );
          }
        } else if (isEthWithdraw(params)) {
          newBalance = await this.executor.getEthBalance(params.chainId);

          // Update BalanceStore FIRST
          if (this.updateBalanceCallback) {
            await this.updateBalanceCallback(
              request.strategyAddress,
              params.chainId,
              ETH_ADDRESS,
              newBalance
            );
          }
        }
      }

      // Then notify strategy of completion
      if (this.notifyStrategyCallback) {
        // Convert txHash to bytes32 (0x0 if undefined)
        const txHashBytes32 =
          result.txHash ||
          ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hex);

        await this.notifyStrategyCallback(
          request.strategyAddress,
          'onWithdrawComplete',
          [
            request.requestId,
            result.success,
            txHashBytes32,
            result.errorMessage || '',
          ]
        );
      }

      this.logger.info(
        {
          requestId: request.requestId,
          strategy: request.strategyAddress,
          success: result.success,
          txHash: result.txHash,
        },
        'Withdrawal completed'
      );
    } finally {
      this.pendingRequests.delete(request.requestId);
    }
  }

  /**
   * Handle detected ERC-20 deposit
   */
  private async handleDeposit(
    strategyAddress: Address,
    deposit: DetectedErc20Deposit
  ): Promise<void> {
    this.logger.info(
      {
        strategy: strategyAddress,
        chainId: deposit.chainId.toString(),
        token: deposit.token,
        amount: deposit.amount.toString(),
        from: deposit.from,
        txHash: deposit.txHash,
      },
      'Processing ERC-20 deposit'
    );

    try {
      // Get the new balance after deposit
      const newBalance = await this.executor.getErc20Balance(
        deposit.chainId,
        deposit.token
      );

      // Update BalanceStore FIRST
      if (this.updateBalanceCallback) {
        await this.updateBalanceCallback(
          strategyAddress,
          deposit.chainId,
          deposit.token,
          newBalance
        );
      }

      // Then notify strategy
      if (this.notifyStrategyCallback) {
        await this.notifyStrategyCallback(strategyAddress, 'onErc20Deposit', [
          deposit.chainId,
          deposit.token,
          deposit.amount,
        ]);
      }

      this.logger.info(
        {
          strategy: strategyAddress,
          chainId: deposit.chainId.toString(),
          token: deposit.token,
          newBalance: newBalance.toString(),
        },
        'ERC-20 deposit processed'
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        {
          strategy: strategyAddress,
          chainId: deposit.chainId.toString(),
          token: deposit.token,
          error: errorMessage,
        },
        'Failed to process deposit'
      );
    }
  }

  /**
   * Register a strategy for deposit monitoring
   */
  registerStrategy(
    strategyAddress: Address,
    ownerAddress: Address,
    tokens: Address[] = []
  ): void {
    this.depositWatcher.registerStrategy(strategyAddress, ownerAddress, tokens);
  }

  /**
   * Unregister a strategy from deposit monitoring
   */
  unregisterStrategy(strategyAddress: Address): void {
    this.depositWatcher.unregisterStrategy(strategyAddress);
  }

  /**
   * Add a token to watch for a strategy
   */
  addWatchedToken(strategyAddress: Address, token: Address): void {
    this.depositWatcher.addWatchedToken(strategyAddress, token);
  }

  /**
   * Start the funding manager (starts deposit watching)
   */
  async start(): Promise<void> {
    await this.depositWatcher.startWatching();
    this.logger.info('Funding manager started');
  }

  /**
   * Stop the funding manager
   */
  stop(): void {
    this.depositWatcher.stopWatching();
    this.logger.info('Funding manager stopped');
  }

  /**
   * Get pending request count
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Check if a request is pending
   */
  isRequestPending(requestId: Hex): boolean {
    return this.pendingRequests.has(requestId);
  }

  /**
   * Get the funding executor
   */
  getExecutor(): FundingExecutor {
    return this.executor;
  }
}
