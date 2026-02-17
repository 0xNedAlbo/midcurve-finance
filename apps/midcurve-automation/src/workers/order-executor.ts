/**
 * Order Executor Worker
 *
 * RabbitMQ consumer that processes triggered orders.
 * Uses competing consumers pattern for parallel execution.
 *
 * Execution lifecycle tracked via CloseOrderExecutionService (per-attempt entities):
 * - First attempt: atomicTransitionToTriggered + executionService.create
 * - Retry: executionService.incrementRetryCount + transitionToMonitoring
 * - Success: executionService.markCompleted + markOnChainExecuted
 * - Permanent failure: executionService.markFailed + transitionToSuspended
 */

import { formatCurrency, UniswapV3Position } from '@midcurve/shared';
import { SwapRouterService, type PostCloseSwapResult } from '@midcurve/services';
import { getOnChainCloseOrderService, getCloseOrderExecutionService, getPoolSubscriptionService, getAutomationLogService, getPositionService } from '../lib/services';
import {
  broadcastTransaction,
  waitForTransaction,
  getRevertReason,
  validatePositionForClose,
  simulateExecuteOrder,
  checkContractTokenBalances,
  getOnChainNonce,
  getOnChainOrder,
  readPoolPrice,
  readSwapRouterAddress,
  type SupportedChainId,
  type PreflightValidation,
  type SimulationSwapParams,
} from '../lib/evm';
import { isSupportedChain, getWorkerConfig, getFeeConfig } from '../lib/config';
import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection, type ConsumeMessage } from '../mq/connection-manager';
import { QUEUES, EXCHANGES, ROUTING_KEYS, ORDER_RETRY_DELAY_MS } from '../mq/topology';
import {
  deserializeMessage,
  serializeMessage,
  type OrderTriggerMessage,
  type ExecutionResultNotificationMessage,
} from '../mq/messages';
import { getSignerClient, type SwapParamsInput } from '../clients/signer-client';

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

    const onChainCloseOrderService = getOnChainCloseOrderService();
    const executionService = getCloseOrderExecutionService();

    try {
      await this.executeOrder(orderId, positionId, poolAddress, chainId, currentPrice, triggerPrice, triggerSide);

      // Acknowledge successful processing
      await mq.ack(msg);
      this.processedTotal++;
      this.lastProcessedAt = new Date();
    } catch (err) {
      const error = err as Error;
      autoLog.methodError(log, 'handleMessage.execute', error, { orderId, positionId });

      // Track execution failure
      const automationLogService = getAutomationLogService();
      try {
        // Find the current execution attempt
        const execution = await executionService.findLatestByOrderId(orderId);
        if (!execution) {
          // Edge case: execution record not created yet (failure before create)
          log.error({ orderId, msg: 'No execution record found for failed order' });
          await mq.ack(msg);
          this.failedTotal++;
          return;
        }

        // Increment retry count on the execution
        const updatedExecution = await executionService.incrementRetryCount(
          execution.id,
          error.message
        );
        const retryCount = updatedExecution.retryCount;
        const willRetry = retryCount < MAX_EXECUTION_ATTEMPTS;

        // Log ORDER_FAILED for user visibility
        const orderTag = triggerSide === 'upper' ? 'TP' : 'SL';
        await automationLogService.logOrderFailed(positionId, orderId, {
          platform: 'evm',
          chainId,
          orderTag,
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
            orderTag,
            error: error.message,
            retryCount,
            maxRetries: MAX_EXECUTION_ATTEMPTS,
            retryDelayMs: ORDER_RETRY_DELAY_MS,
            scheduledRetryAt: new Date(Date.now() + ORDER_RETRY_DELAY_MS).toISOString(),
          });

          // Transition order back to monitoring for re-trigger
          await onChainCloseOrderService.transitionToMonitoring(orderId);

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
        } else {
          // Permanently failed - mark execution as failed and suspend order
          await executionService.markFailed(execution.id, { error: error.message });
          await onChainCloseOrderService.transitionToSuspended(orderId);

          await mq.ack(msg); // Remove from queue - don't requeue
          log.error(
            { orderId, positionId, retryCount, error: error.message },
            'Order permanently failed after max attempts'
          );

          // Publish failure notification
          try {
            const positionService = getPositionService();
            const position = await positionService.findById(positionId);
            if (position) {
              await this.publishExecutionNotification({
                userId: position.userId,
                positionId,
                orderId,
                eventType: triggerSide === 'lower' ? 'STOP_LOSS_FAILED' : 'TAKE_PROFIT_FAILED',
                chainId,
                triggerSide,
                triggerSqrtPriceX96: triggerPrice,
                error: error.message,
                retryCount,
                timestamp: new Date().toISOString(),
              });
            }
          } catch (notifyErr) {
            autoLog.methodError(log, 'handleMessage.notifyFailure', notifyErr, { orderId, positionId });
          }
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
    const onChainCloseOrderService = getOnChainCloseOrderService();
    const executionService = getCloseOrderExecutionService();
    const poolSubscriptionService = getPoolSubscriptionService();
    const signerClient = getSignerClient();
    const feeConfig = getFeeConfig();

    // Validate chain support
    if (!isSupportedChain(chainId)) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    // Get order details from explicit columns
    const order = await onChainCloseOrderService.findById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // triggerMode is already an int (0=LOWER, 1=UPPER) - no conversion needed
    const triggerMode = order.triggerMode;

    // Contract address is a direct column
    const contractAddress = order.contractAddress;
    if (!contractAddress) {
      throw new Error(`Contract address not configured for order: ${orderId}`);
    }

    // Operator address is a direct column
    const operatorAddress = order.operatorAddress;
    if (!operatorAddress) {
      throw new Error(`Operator address not configured for order: ${orderId}`);
    }

    // Get full position data (needed for signer service + price formatting)
    const positionService = getPositionService();
    const positionData = await positionService.findById(positionId);
    if (!positionData) {
      throw new Error(`Position not found: ${positionId}`);
    }
    // Cast to UniswapV3Position for typed config/state access
    const position = positionData as UniswapV3Position;
    const userId = position.userId;

    // Get quote token decimals for human-readable price formatting
    const quoteTokenDecimals = position.isToken0Quote
      ? position.pool.token0.decimals
      : position.pool.token1.decimals;

    // Get nftId from position config (required for executeOrder contract call)
    if (!position.typedConfig.nftId) {
      throw new Error(`Position has no nftId: ${positionId}`);
    }
    const nftId = BigInt(position.typedConfig.nftId);

    // =========================================================================
    // ON-CHAIN SWAP STATE: Read swap configuration from on-chain order
    // IMPORTANT: The contract decides whether to swap based on on-chain swapDirection,
    // not database config. We MUST use on-chain state to determine if swap params are needed.
    // =========================================================================
    const onChainOrder = await getOnChainOrder(
      chainId as SupportedChainId,
      contractAddress as `0x${string}`,
      nftId,
      triggerMode
    );

    // SwapDirection enum: 0=NONE, 1=TOKEN0_TO_1, 2=TOKEN1_TO_0
    const swapEnabled = onChainOrder.swapDirection !== 0;
    const swapDirection = onChainOrder.swapDirection === 1 ? 'TOKEN0_TO_1' : 'TOKEN1_TO_0';
    const swapSlippageBps = onChainOrder.swapSlippageBps;

    log.info({
      orderId,
      positionId,
      onChainSwapDirection: onChainOrder.swapDirection,
      swapEnabled,
      swapDirection: swapEnabled ? swapDirection : null,
      swapSlippageBps: swapEnabled ? swapSlippageBps : null,
      msg: 'On-chain swap configuration',
    });

    // Declare preflight outside if block so it's accessible in swap params section
    let preflight: PreflightValidation | undefined;

    // =========================================================================
    // PRE-FLIGHT VALIDATION: Check position state before execution
    // =========================================================================
    {
      log.info({
        orderId,
        positionId,
        nftId: nftId.toString(),
        contractAddress,
        msg: 'Running pre-flight validation',
      });

      preflight = await validatePositionForClose(
        chainId as SupportedChainId,
        nftId,
        position.typedState.ownerAddress as `0x${string}`,
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
        const orderTag = triggerSide === 'upper' ? 'TP' : 'SL';
        await automationLogService.logPreflightValidation(positionId, orderId, {
          platform: 'evm',
          chainId,
          orderTag,
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

    // Check if this is a retry attempt (order already in 'triggered' monitoring state)
    const isRetry = order.monitoringState === 'triggered';

    // Always fetch on-chain nonce before signing
    // Signer service is stateless and does not manage nonces
    const nonce = await getOnChainNonce(
      chainId as SupportedChainId,
      operatorAddress as `0x${string}`
    );

    log.info(
      { orderId, positionId, operatorAddress, nonce, isRetry },
      'Fetched on-chain nonce for signing'
    );

    // Only mark as triggering on first attempt, not retries
    const automationLogService = getAutomationLogService();
    if (!isRetry) {
      // Atomic transition: monitoring -> triggered (race-safe)
      await onChainCloseOrderService.atomicTransitionToTriggered(orderId);

      // Create execution record
      await executionService.create({
        onChainCloseOrderId: orderId,
        positionId,
        triggerSqrtPriceX96: triggerPrice,
        triggeredAt: new Date(),
      });

      // Log ORDER_TRIGGERED for user visibility
      const orderTagTriggered = triggerSide === 'upper' ? 'TP' : 'SL';
      await automationLogService.logOrderTriggered(positionId, orderId, {
        platform: 'evm',
        chainId,
        orderTag: orderTagTriggered,
        triggerSide,
        triggerPrice,
        currentPrice: _currentPrice,
        humanTriggerPrice: formatCurrency(triggerPrice, quoteTokenDecimals),
        humanCurrentPrice: formatCurrency(_currentPrice, quoteTokenDecimals),
      });
    }

    // Mark execution as executing (pending -> executing)
    const currentExecution = await executionService.findLatestByOrderId(orderId);
    if (currentExecution) {
      await executionService.markExecuting(currentExecution.id);
    }

    // =========================================================================
    // SWAP PARAMS: Compute optimal swap path via SwapRouterService
    // Uses on-chain swap configuration (swapDirection, swapSlippageBps) since
    // the contract decides whether to swap based on on-chain state.
    //
    // SwapRouterService discovers multi-hop paths, ranks them by estimated
    // output using local math, and applies CoinGecko fair-value slippage floor.
    // =========================================================================
    let swapParams: SwapParamsInput | undefined;

    if (swapEnabled) {
      log.info({
        orderId,
        positionId,
        swapDirection,
        swapSlippageBps,
        msg: 'Computing swap params via SwapRouterService',
      });

      // Read swapRouter address from PositionCloser ViewFacet
      const swapRouterAddress = await readSwapRouterAddress(
        chainId as SupportedChainId,
        contractAddress as `0x${string}`
      );

      // Fetch FRESH pool price for accurate position analysis
      const { sqrtPriceX96: freshPoolPrice } = await readPoolPrice(
        chainId as SupportedChainId,
        poolAddress as `0x${string}`
      );

      // Build pre-fetched position data from preflight validation
      if (!preflight?.positionData) {
        throw new Error(
          `Cannot calculate swap amount: preflight position data unavailable for order ${orderId}`
        );
      }

      const swapRouterService = new SwapRouterService();
      const swapResult: PostCloseSwapResult = await swapRouterService.computePostCloseSwapParams({
        chainId,
        nftId,
        swapRouterAddress,
        swapDirection: swapDirection as 'TOKEN0_TO_1' | 'TOKEN1_TO_0',
        maxDeviationBps: swapSlippageBps,
        positionData: {
          token0: preflight.positionData.token0 as `0x${string}`,
          token1: preflight.positionData.token1 as `0x${string}`,
          fee: preflight.positionData.fee,
          tickLower: preflight.positionData.tickLower,
          tickUpper: preflight.positionData.tickUpper,
          liquidity: preflight.positionData.liquidity,
          tokensOwed0: preflight.positionData.tokensOwed0,
          tokensOwed1: preflight.positionData.tokensOwed1,
        },
        currentSqrtPriceX96: freshPoolPrice,
      });

      if (swapResult.kind === 'do_not_execute') {
        throw new Error(
          `SwapRouterService: swap not executable — ${swapResult.reason}`
        );
      }

      // Convert SwapInstruction to SwapParamsInput for signer client
      swapParams = {
        minAmountOut: swapResult.minAmountOut.toString(),
        deadline: Number(swapResult.deadline),
        hops: swapResult.hops.map((hop) => ({
          venueId: hop.venueId,
          tokenIn: hop.tokenIn,
          tokenOut: hop.tokenOut,
          venueData: hop.venueData,
        })),
      };

      log.info({
        orderId,
        positionId,
        tokenIn: swapResult.tokenIn,
        tokenOut: swapResult.tokenOut,
        estimatedAmountIn: swapResult.estimatedAmountIn.toString(),
        minAmountOut: swapResult.minAmountOut.toString(),
        hopsCount: swapResult.hops.length,
        diagnostics: {
          pathsEnumerated: swapResult.diagnostics.pathsEnumerated,
          pathsQuoted: swapResult.diagnostics.pathsQuoted,
          bestEstimatedAmountOut: swapResult.diagnostics.bestEstimatedAmountOut.toString(),
          fairValuePrice: swapResult.diagnostics.fairValuePrice,
          absoluteFloorAmountOut: swapResult.diagnostics.absoluteFloorAmountOut.toString(),
          poolsDiscovered: swapResult.diagnostics.poolsDiscovered,
          backbonePoolsCacheHit: swapResult.diagnostics.backbonePoolsCacheHit,
          swapTokensCacheHit: swapResult.diagnostics.swapTokensCacheHit,
        },
        msg: 'SwapRouterService computed optimal swap params',
      });
    }

    // Build simulation swap params
    const simulationSwapParams: SimulationSwapParams | undefined = swapParams
      ? {
          minAmountOut: BigInt(swapParams.minAmountOut),
          deadline: BigInt(swapParams.deadline),
          hops: swapParams.hops.map((hop) => ({
            venueId: hop.venueId as `0x${string}`,
            tokenIn: hop.tokenIn as `0x${string}`,
            tokenOut: hop.tokenOut as `0x${string}`,
            venueData: hop.venueData as `0x${string}`,
          })),
        }
      : undefined;

    // =========================================================================
    // SIMULATION: Simulate transaction before signing to catch errors early
    // =========================================================================
    log.info({
      orderId,
      positionId,
      nftId: nftId.toString(),
      triggerMode,
      contractAddress,
      operatorAddress,
      msg: 'Simulating executeOrder transaction',
    });

    const simulation = await simulateExecuteOrder(
      chainId as SupportedChainId,
      contractAddress as `0x${string}`,
      nftId,
      triggerMode,
      feeConfig.recipient as `0x${string}`,
      feeConfig.bps,
      operatorAddress as `0x${string}`,
      simulationSwapParams
    );

    if (!simulation.success) {
      log.error({
        orderId,
        positionId,
        nftId: nftId.toString(),
        triggerMode,
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
            position.typedState.ownerAddress as `0x${string}`,
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
      const orderTagSim = triggerSide === 'upper' ? 'TP' : 'SL';
      await automationLogService.logSimulationFailed(positionId, orderId, {
        platform: 'evm',
        chainId,
        orderTag: orderTagSim,
        error: simulation.error || 'Unknown simulation error',
        decodedError: simulation.decodedError,
        nftId: nftId.toString(),
        triggerMode,
        contractAddress,
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
      hasSwap: !!swapParams,
    });

    // Sign the execution transaction (gas estimation done in signer-client)
    // Nonce is always fetched from chain - signer service is stateless
    const signedTx = await signerClient.signExecuteOrder({
      userId,
      chainId,
      contractAddress,
      nftId,
      triggerMode,
      feeRecipient: feeConfig.recipient,
      feeBps: feeConfig.bps,
      operatorAddress,
      nonce,
      swapParams,
    });

    autoLog.orderExecution(log, orderId, 'broadcasting', {
      txHash: signedTx.txHash,
    });

    // Log ORDER_EXECUTING for user visibility
    const orderTagExec = triggerSide === 'upper' ? 'TP' : 'SL';
    await automationLogService.logOrderExecuting(positionId, orderId, {
      platform: 'evm',
      chainId,
      orderTag: orderTagExec,
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
            position.typedState.ownerAddress as `0x${string}`,
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

    // Mark execution as completed and order as executed
    const completedExecution = await executionService.findLatestByOrderId(orderId);
    if (completedExecution) {
      await executionService.markCompleted(completedExecution.id, {
        txHash,
        executionSqrtPriceX96: _currentPrice,
        executionFeeBps: feeConfig.bps,
        amount0Out: '0', // TODO: Parse from tx receipt
        amount1Out: '0', // TODO: Parse from tx receipt
      });
    }
    await onChainCloseOrderService.markOnChainExecuted(orderId);

    // Decrement pool subscription order count
    // Use position.pool.id (database UUID), not poolAddress (contract address)
    try {
      await poolSubscriptionService.decrementOrderCount(position.pool.id);
      log.info({ orderId, poolId: position.pool.id, msg: 'Decremented pool subscription order count' });
    } catch (err) {
      log.warn({ orderId, poolId: position.pool.id, error: err, msg: 'Failed to decrement order count' });
    }

    // Log ORDER_EXECUTED for user visibility
    const orderTagCompleted = triggerSide === 'upper' ? 'TP' : 'SL';
    await automationLogService.logOrderExecuted(positionId, orderId, {
      platform: 'evm',
      chainId,
      orderTag: orderTagCompleted,
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

    // Publish execution success notification
    await this.publishExecutionNotification({
      userId,
      positionId,
      orderId,
      eventType: triggerSide === 'lower' ? 'STOP_LOSS_EXECUTED' : 'TAKE_PROFIT_EXECUTED',
      chainId,
      txHash,
      amount0Out: '0', // TODO: Parse from tx receipt
      amount1Out: '0', // TODO: Parse from tx receipt
      triggerSide,
      triggerSqrtPriceX96: triggerPrice,
      executionSqrtPriceX96: _currentPrice,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Publish execution result notification to the notifications queue
   */
  private async publishExecutionNotification(
    message: ExecutionResultNotificationMessage
  ): Promise<void> {
    try {
      const mq = getRabbitMQConnection();
      const content = serializeMessage(message);

      await mq.publish(
        EXCHANGES.NOTIFICATIONS,
        ROUTING_KEYS.NOTIFICATION_EXECUTION_RESULT,
        content
      );

      log.info(
        {
          userId: message.userId,
          positionId: message.positionId,
          orderId: message.orderId,
          eventType: message.eventType,
          routingKey: ROUTING_KEYS.NOTIFICATION_EXECUTION_RESULT,
        },
        'Execution result notification published'
      );
    } catch (err) {
      // Log but don't fail the main operation
      autoLog.methodError(log, 'publishExecutionNotification', err, {
        orderId: message.orderId,
        eventType: message.eventType,
      });
    }
  }
}
