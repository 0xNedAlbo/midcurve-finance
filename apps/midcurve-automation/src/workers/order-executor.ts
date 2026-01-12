/**
 * Order Executor Worker
 *
 * RabbitMQ consumer that processes triggered orders.
 * Uses competing consumers pattern for parallel execution.
 */

import type { AutomationContractConfig } from '@midcurve/shared';
import { formatCurrency } from '@midcurve/shared';
import { getCloseOrderService, getPoolSubscriptionService, getAutomationLogService, getPositionService } from '../lib/services';
import {
  broadcastTransaction,
  waitForTransaction,
  getRevertReason,
  validatePositionForClose,
  simulateExecuteClose,
  checkContractTokenBalances,
  getOnChainNonce,
  type SupportedChainId,
} from '../lib/evm';
import { isSupportedChain, getWorkerConfig, getFeeConfig } from '../lib/config';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection, type ConsumeMessage } from '../mq/connection-manager';
import { QUEUES, ORDER_RETRY_DELAY_MS } from '../mq/topology';
import { deserializeMessage, serializeMessage, type OrderTriggerMessage } from '../mq/messages';
import { getSignerClient } from '../clients/signer-client';

const log = automationLogger.child({ component: 'OrderExecutor' });

// Maximum number of execution attempts before marking order as permanently failed
const MAX_EXECUTION_ATTEMPTS = 3;

// =============================================================================
// Types
// =============================================================================

export interface OrderExecutorStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  consumerCount: number;
  processedTotal: number;
  failedTotal: number;
  lastProcessedAt: string | null;
}

// =============================================================================
// Worker
// =============================================================================

export class OrderExecutor {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private consumerCount: number;
  private consumerTags: string[] = [];
  private processedTotal = 0;
  private failedTotal = 0;
  private lastProcessedAt: Date | null = null;

  constructor() {
    const config = getWorkerConfig();
    this.consumerCount = config.orderExecutorPoolSize;
  }

  /**
   * Start the order executor consumers
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'OrderExecutor already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'OrderExecutor', 'starting');
    this.status = 'running';

    const mq = getRabbitMQConnection();

    // Start competing consumers
    for (let i = 0; i < this.consumerCount; i++) {
      const tag = await mq.consume(
        QUEUES.ORDERS_PENDING,
        async (msg) => this.handleMessage(msg),
        { prefetch: 1 }
      );
      this.consumerTags.push(tag);
    }

    autoLog.workerLifecycle(log, 'OrderExecutor', 'started', {
      consumerCount: this.consumerCount,
    });
  }

  /**
   * Stop the order executor
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'OrderExecutor', 'stopping');
    this.status = 'stopping';

    const mq = getRabbitMQConnection();

    // Cancel all consumers
    for (const tag of this.consumerTags) {
      await mq.cancelConsumer(tag);
    }
    this.consumerTags = [];

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'OrderExecutor', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): OrderExecutorStatus {
    return {
      status: this.status,
      consumerCount: this.consumerCount,
      processedTotal: this.processedTotal,
      failedTotal: this.failedTotal,
      lastProcessedAt: this.lastProcessedAt?.toISOString() || null,
    };
  }

  /**
   * Handle incoming trigger message
   */
  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg) {
      return;
    }

    const mq = getRabbitMQConnection();
    let message: OrderTriggerMessage;

    try {
      message = deserializeMessage<OrderTriggerMessage>(msg.content);
    } catch (err) {
      autoLog.methodError(log, 'handleMessage.deserialize', err);
      // Reject malformed messages without requeue
      await mq.nack(msg, false);
      this.failedTotal++;
      return;
    }

    const { orderId, positionId, poolAddress, chainId, currentPrice, triggerPrice, triggerSide } = message;

    autoLog.mqEvent(log, 'received', QUEUES.ORDERS_PENDING, {
      orderId,
      positionId,
      triggerSide,
    });

    const closeOrderService = getCloseOrderService();

    try {
      await this.executeOrder(orderId, positionId, poolAddress, chainId, currentPrice, triggerPrice, triggerSide);

      // Acknowledge successful processing
      await mq.ack(msg);
      this.processedTotal++;
      this.lastProcessedAt = new Date();
    } catch (err) {
      const error = err as Error;
      autoLog.methodError(log, 'handleMessage.execute', error, { orderId, positionId });

      // Increment retry counter and record error
      const automationLogService = getAutomationLogService();
      try {
        const { retryCount } = await closeOrderService.incrementExecutionAttempt(
          orderId,
          error.message
        );

        const willRetry = retryCount < MAX_EXECUTION_ATTEMPTS;

        // Log ORDER_FAILED for user visibility
        await automationLogService.logOrderFailed(positionId, orderId, {
          platform: 'evm',
          chainId,
          error: error.message,
          retryCount,
          maxRetries: MAX_EXECUTION_ATTEMPTS,
          willRetry,
        });

        if (willRetry) {
          // Log retry scheduled with delay info
          await automationLogService.logRetryScheduled(positionId, orderId, {
            platform: 'evm',
            chainId,
            error: error.message,
            retryCount,
            maxRetries: MAX_EXECUTION_ATTEMPTS,
            willRetry: true,
            retryDelayMs: ORDER_RETRY_DELAY_MS,
            scheduledRetryAt: new Date(Date.now() + ORDER_RETRY_DELAY_MS).toISOString(),
          });
        }

        if (retryCount >= MAX_EXECUTION_ATTEMPTS) {
          // Permanently failed - mark as failed and remove from queue
          await closeOrderService.markFailed(orderId, error.message);
          await mq.ack(msg); // Remove from queue - don't requeue
          log.error(
            { orderId, positionId, retryCount, error: error.message },
            'Order permanently failed after max attempts'
          );
        } else {
          // Temporary failure - send to delay queue for retry after delay
          await mq.ack(msg); // Remove from main queue

          // Republish to delay queue (will dead-letter back to main queue after TTL)
          const delayContent = serializeMessage(message);
          await mq.publishToQueue(QUEUES.ORDERS_RETRY_DELAY, delayContent);

          log.warn(
            {
              orderId,
              positionId,
              retryCount,
              maxAttempts: MAX_EXECUTION_ATTEMPTS,
              retryDelayMs: ORDER_RETRY_DELAY_MS,
            },
            `Order execution failed, scheduled for retry after ${ORDER_RETRY_DELAY_MS / 1000}s delay`
          );
        }
      } catch (trackingErr) {
        const trackingError = trackingErr as Error;
        const errorMessage = trackingError.message.toLowerCase();

        // If order doesn't exist, drop the message - don't requeue
        if (errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
          await mq.ack(msg); // Remove from queue
          log.warn(
            { orderId, positionId, error: trackingError.message },
            'Order not found in database, dropping message'
          );
        } else {
          // For other tracking errors, requeue but log the issue
          log.error(
            { orderId, positionId, error: trackingError.message },
            'Failed to track execution attempt, requeueing anyway'
          );
          await mq.nack(msg, true);
        }
      }

      this.failedTotal++;
    }
  }

  /**
   * Execute a triggered close order
   */
  private async executeOrder(
    orderId: string,
    positionId: string,
    poolAddress: string,
    chainId: number,
    _currentPrice: string,
    triggerPrice: string,
    triggerSide: 'lower' | 'upper'
  ): Promise<void> {
    const closeOrderService = getCloseOrderService();
    const poolSubscriptionService = getPoolSubscriptionService();
    const signerClient = getSignerClient();
    const feeConfig = getFeeConfig();

    // Validate chain support
    if (!isSupportedChain(chainId)) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    // Get order details
    const order = await closeOrderService.findById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Get contract address from automationContractConfig (immutable at registration)
    const contractConfig = order.automationContractConfig as AutomationContractConfig;
    const contractAddress = contractConfig.contractAddress;
    if (!contractAddress) {
      throw new Error(`Contract address not configured for order: ${orderId}`);
    }

    // Get closeId and operatorAddress from order config
    const orderConfig = order.config as { closeId?: number; operatorAddress?: string };
    const closeId = orderConfig.closeId;
    if (closeId === undefined) {
      throw new Error(`Order not registered on-chain: ${orderId}`);
    }

    const operatorAddress = orderConfig.operatorAddress;
    if (!operatorAddress) {
      throw new Error(`Operator address not configured for order: ${orderId}`);
    }

    // Get full position data (needed for signer service + price formatting)
    const positionService = getPositionService();
    const position = await positionService.findById(positionId);
    if (!position) {
      throw new Error(`Position not found: ${positionId}`);
    }
    const userId = position.userId;

    // Get quote token decimals for human-readable price formatting
    const quoteTokenDecimals = position.isToken0Quote
      ? position.pool.token0.decimals
      : position.pool.token1.decimals;

    // Get nftId from position config
    const nftId = position.config.nftId ? BigInt(position.config.nftId) : undefined;

    // =========================================================================
    // PRE-FLIGHT VALIDATION: Check position state before execution
    // =========================================================================
    if (nftId) {
      log.info({
        orderId,
        positionId,
        nftId: nftId.toString(),
        contractAddress,
        msg: 'Running pre-flight validation',
      });

      const preflight = await validatePositionForClose(
        chainId as SupportedChainId,
        nftId,
        position.state.ownerAddress as `0x${string}`,
        contractAddress as `0x${string}`
      );

      // Log preflight result for diagnostics (console + database)
      if (preflight.positionData) {
        log.info({
          orderId,
          positionId,
          preflight: {
            isValid: preflight.isValid,
            reason: preflight.reason,
            liquidity: preflight.positionData.liquidity.toString(),
            token0: preflight.positionData.token0,
            token1: preflight.positionData.token1,
            tickLower: preflight.positionData.tickLower,
            tickUpper: preflight.positionData.tickUpper,
            tokensOwed0: preflight.positionData.tokensOwed0.toString(),
            tokensOwed1: preflight.positionData.tokensOwed1.toString(),
            owner: preflight.owner,
            isApproved: preflight.isApproved,
            isApprovedForAll: preflight.isApprovedForAll,
          },
          msg: 'Pre-flight validation result',
        });

        // Log to database for UI visibility
        const automationLogService = getAutomationLogService();
        await automationLogService.logPreflightValidation(positionId, orderId, {
          platform: 'evm',
          chainId,
          isValid: preflight.isValid,
          reason: preflight.reason,
          liquidity: preflight.positionData.liquidity.toString(),
          token0: preflight.positionData.token0,
          token1: preflight.positionData.token1,
          tickLower: preflight.positionData.tickLower,
          tickUpper: preflight.positionData.tickUpper,
          tokensOwed0: preflight.positionData.tokensOwed0.toString(),
          tokensOwed1: preflight.positionData.tokensOwed1.toString(),
          owner: preflight.owner,
          isApproved: preflight.isApproved,
          isApprovedForAll: preflight.isApprovedForAll,
        });
      }

      if (!preflight.isValid) {
        throw new Error(`Pre-flight validation failed: ${preflight.reason}`);
      }
    }

    // Check if this is a retry attempt (order already in 'triggering' status)
    const isRetry = order.status === 'triggering';

    // For retry attempts, fetch the on-chain nonce to avoid "nonce too low" errors
    // This handles cases where the original tx succeeded but we didn't get confirmation
    let explicitNonce: number | undefined;

    if (isRetry) {
      log.info(
        { orderId, positionId, status: order.status },
        'Retry attempt - fetching on-chain nonce for sync'
      );

      // Get the automation wallet address to fetch its nonce
      const wallet = await signerClient.getOrCreateWallet(userId);

      // Fetch current on-chain nonce
      explicitNonce = await getOnChainNonce(
        chainId as SupportedChainId,
        wallet.walletAddress as `0x${string}`
      );

      log.info(
        { orderId, positionId, operatorAddress, explicitNonce },
        'Will use explicit nonce for retry to avoid nonce desync'
      );
    }

    // Only mark as triggering on first attempt, not retries
    const automationLogService = getAutomationLogService();
    if (!isRetry) {
      // Mark order as triggering (use BigInt for the price)
      await closeOrderService.markTriggered(orderId, {
        triggerSqrtPriceX96: BigInt(triggerPrice),
      });

      // Log ORDER_TRIGGERED for user visibility
      await automationLogService.logOrderTriggered(positionId, orderId, {
        platform: 'evm',
        chainId,
        triggerSide,
        triggerPrice,
        currentPrice: _currentPrice,
        humanTriggerPrice: formatCurrency(triggerPrice, quoteTokenDecimals),
        humanCurrentPrice: formatCurrency(_currentPrice, quoteTokenDecimals),
      });
    }

    // =========================================================================
    // SIMULATION: Simulate transaction before signing to catch errors early
    // =========================================================================
    log.info({
      orderId,
      positionId,
      closeId,
      contractAddress,
      operatorAddress,
      msg: 'Simulating executeClose transaction',
    });

    const simulation = await simulateExecuteClose(
      chainId as SupportedChainId,
      contractAddress as `0x${string}`,
      closeId,
      feeConfig.recipient as `0x${string}`,
      feeConfig.bps,
      operatorAddress as `0x${string}`
    );

    if (!simulation.success) {
      log.error({
        orderId,
        positionId,
        closeId,
        simulation,
        msg: 'Transaction simulation failed',
      });

      // If we have position data, try to get contract token balances for additional diagnostics
      let contractBalances: {
        token0Symbol: string;
        token0Balance: string;
        token1Symbol: string;
        token1Balance: string;
      } | undefined;

      if (nftId) {
        try {
          const simDiagPreflight = await validatePositionForClose(
            chainId as SupportedChainId,
            nftId,
            position.state.ownerAddress as `0x${string}`,
            contractAddress as `0x${string}`
          );

          if (simDiagPreflight.positionData) {
            const balances = await checkContractTokenBalances(
              chainId as SupportedChainId,
              simDiagPreflight.positionData.token0,
              simDiagPreflight.positionData.token1,
              contractAddress as `0x${string}`
            );

            contractBalances = {
              token0Symbol: balances.token0Symbol,
              token0Balance: balances.token0Balance.toString(),
              token1Symbol: balances.token1Symbol,
              token1Balance: balances.token1Balance.toString(),
            };

            log.error({
              orderId,
              positionId,
              contractBalances,
              msg: 'Contract token balances at simulation failure',
            });
          }
        } catch (balanceErr) {
          log.warn({
            orderId,
            positionId,
            error: (balanceErr as Error).message,
            msg: 'Failed to fetch contract balances for diagnostics',
          });
        }
      }

      // Log simulation failure to database for UI visibility
      const automationLogService = getAutomationLogService();
      await automationLogService.logSimulationFailed(positionId, orderId, {
        platform: 'evm',
        chainId,
        error: simulation.error || 'Unknown simulation error',
        decodedError: simulation.decodedError,
        closeId,
        contractAddress,
        operatorAddress,
        feeRecipient: feeConfig.recipient,
        feeBps: feeConfig.bps,
        contractBalances,
      });

      throw new Error(`Simulation failed: ${simulation.decodedError || simulation.error}`);
    }

    log.info({
      orderId,
      positionId,
      msg: 'Transaction simulation successful',
    });

    autoLog.orderExecution(log, orderId, 'signing', {
      positionId,
      poolAddress,
      triggerPrice,
      operatorAddress,
    });

    // Sign the execution transaction (gas estimation done in signer-client)
    // For retry attempts, pass the explicit on-chain nonce to avoid "nonce too low" errors
    const signedTx = await signerClient.signExecuteClose({
      userId,
      chainId,
      contractAddress,
      closeId,
      feeRecipient: feeConfig.recipient,
      feeBps: feeConfig.bps,
      operatorAddress,
      nonce: explicitNonce,
    });

    autoLog.orderExecution(log, orderId, 'broadcasting', {
      txHash: signedTx.txHash,
    });

    // Log ORDER_EXECUTING for user visibility
    await automationLogService.logOrderExecuting(positionId, orderId, {
      platform: 'evm',
      chainId,
      txHash: signedTx.txHash,
      operatorAddress,
    });

    // Broadcast transaction
    const txHash = await broadcastTransaction(
      chainId as SupportedChainId,
      signedTx.signedTransaction as `0x${string}`
    );

    autoLog.orderExecution(log, orderId, 'waiting', { txHash });

    // Wait for confirmation
    const receipt = await waitForTransaction(chainId as SupportedChainId, txHash);

    if (receipt.status === 'reverted') {
      // Fetch and decode the revert reason for better debugging
      const revertReason = await getRevertReason(chainId as SupportedChainId, txHash);

      // Enhanced diagnostics: Log position state and contract balances after revert
      log.error({
        orderId,
        positionId,
        txHash,
        revertReason,
        receipt: {
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
        },
        msg: 'Transaction reverted - gathering diagnostics',
      });

      // Try to get post-revert position state and contract balances
      if (nftId) {
        try {
          const postRevertPreflight = await validatePositionForClose(
            chainId as SupportedChainId,
            nftId,
            position.state.ownerAddress as `0x${string}`,
            contractAddress as `0x${string}`
          );

          log.error({
            orderId,
            positionId,
            postRevertState: {
              isValid: postRevertPreflight.isValid,
              reason: postRevertPreflight.reason,
              liquidity: postRevertPreflight.positionData?.liquidity.toString(),
              token0: postRevertPreflight.positionData?.token0,
              token1: postRevertPreflight.positionData?.token1,
              owner: postRevertPreflight.owner,
              isApproved: postRevertPreflight.isApproved,
            },
            msg: 'Position state after revert',
          });

          if (postRevertPreflight.positionData) {
            const balances = await checkContractTokenBalances(
              chainId as SupportedChainId,
              postRevertPreflight.positionData.token0,
              postRevertPreflight.positionData.token1,
              contractAddress as `0x${string}`
            );

            log.error({
              orderId,
              positionId,
              contractBalances: {
                token0Symbol: balances.token0Symbol,
                token0Balance: balances.token0Balance.toString(),
                token1Symbol: balances.token1Symbol,
                token1Balance: balances.token1Balance.toString(),
              },
              msg: 'Contract token balances after revert',
            });
          }
        } catch (diagErr) {
          log.warn({
            orderId,
            positionId,
            error: (diagErr as Error).message,
            msg: 'Failed to gather post-revert diagnostics',
          });
        }
      }

      throw new Error(`Transaction reverted: ${revertReason || 'unknown reason'} (tx: ${txHash})`);
    }

    // Mark order as executed with proper input shape
    // Note: amount0Out and amount1Out would ideally be parsed from tx logs
    // For now, using 0n as placeholder - real implementation would decode the tx receipt
    await closeOrderService.markExecuted(orderId, {
      executionTxHash: txHash,
      executionFeeBps: feeConfig.bps,
      amount0Out: 0n, // TODO: Parse from tx receipt
      amount1Out: 0n, // TODO: Parse from tx receipt
    });

    // Decrement pool subscription order count
    // Use position.pool.id (database UUID), not poolAddress (contract address)
    try {
      await poolSubscriptionService.decrementOrderCount(position.pool.id);
      log.info({ orderId, poolId: position.pool.id, msg: 'Decremented pool subscription order count' });
    } catch (err) {
      log.warn({ orderId, poolId: position.pool.id, error: err, msg: 'Failed to decrement order count' });
    }

    // Log ORDER_EXECUTED for user visibility
    await automationLogService.logOrderExecuted(positionId, orderId, {
      platform: 'evm',
      chainId,
      txHash,
      gasUsed: receipt.gasUsed.toString(),
      amount0Out: '0', // TODO: Parse from tx receipt
      amount1Out: '0', // TODO: Parse from tx receipt
      executionFeeBps: feeConfig.bps,
    });

    autoLog.orderExecution(log, orderId, 'completed', {
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
    });

    log.info({
      orderId,
      positionId,
      poolAddress,
      txHash,
      triggerSide,
      msg: 'Order executed successfully',
    });
  }
}
