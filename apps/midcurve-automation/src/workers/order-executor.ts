/**
 * Order Executor Worker
 *
 * RabbitMQ consumer that processes triggered orders.
 * Uses competing consumers pattern for parallel execution.
 */

import type { AutomationContractConfig } from '@midcurve/shared';
import { formatCurrency } from '@midcurve/shared';
import { getCloseOrderService, getPoolSubscriptionService, getAutomationLogService, getPositionService } from '../lib/services';
import { broadcastTransaction, waitForTransaction, type SupportedChainId } from '../lib/evm';
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

    // Mark order as triggering (use BigInt for the price)
    await closeOrderService.markTriggered(orderId, {
      triggerSqrtPriceX96: BigInt(triggerPrice),
    });

    // Log ORDER_TRIGGERED for user visibility
    const automationLogService = getAutomationLogService();
    await automationLogService.logOrderTriggered(positionId, orderId, {
      platform: 'evm',
      chainId,
      triggerSide,
      triggerPrice,
      currentPrice: _currentPrice,
      humanTriggerPrice: formatCurrency(triggerPrice, quoteTokenDecimals),
      humanCurrentPrice: formatCurrency(_currentPrice, quoteTokenDecimals),
    });

    autoLog.orderExecution(log, orderId, 'signing', {
      positionId,
      poolAddress,
      triggerPrice,
      operatorAddress,
    });

    // Sign the execution transaction (gas estimation done in signer-client)
    const signedTx = await signerClient.signExecuteClose({
      userId,
      chainId,
      contractAddress,
      closeId,
      feeRecipient: feeConfig.recipient,
      feeBps: feeConfig.bps,
      operatorAddress,
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
      throw new Error(`Transaction reverted: ${txHash}`);
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

    // Decrement pool subscription order count (uses poolId, not poolAddress)
    // We need to look up the pool subscription by the pool it belongs to
    // For now, let's try using the poolAddress as the poolId since that's how it's stored
    try {
      const subscription = await poolSubscriptionService.findByPoolId(poolAddress);
      if (subscription) {
        await poolSubscriptionService.decrementOrderCount(subscription.poolId);
      }
    } catch (err) {
      log.warn({ orderId, poolAddress, error: err, msg: 'Failed to decrement order count' });
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
