/**
 * Order Executor Worker
 *
 * RabbitMQ consumer that processes triggered orders.
 * Uses competing consumers pattern for parallel execution.
 *
 * Execution lifecycle tracked via UniswapV3CloseOrderService (single automationState field):
 * - First attempt: atomicTransitionToExecuting (monitoring|retrying → executing, attempts++)
 * - Success: markExecuted (executing → executed)
 * - Failure: transitionToRetrying (executing → retrying), then setTimeout:
 *   - Price still meets trigger + attempts < MAX → re-publish to queue
 *   - Price moved away → resetToMonitoring (attempts=0)
 *   - Attempts >= MAX → markFailed (terminal)
 */

import { formatCurrency, UniswapV3Position } from '@midcurve/shared';
import { ParaswapSwapService, isParaswapSupportedChain, publishCloseOrderEventsFromReceipt } from '@midcurve/services';
import { getUniswapV3CloseOrderService, getAutomationSubscriptionService, getAutomationLogService, getPositionService, getUserNotificationService } from '../../lib/services';
import {
  broadcastTransaction,
  waitForTransaction,
  getRevertReason,
  checkContractTokenBalances,
  getOnChainNonce,
  readPoolPrice,
  readSwapRouterAddress,
  readParaswapAdapterAddress,
  computeWithdrawMinAmounts,
  EMPTY_SWAP_PARAMS,
  getPublicClient,
  type SupportedChainId,
  type SimulationSwapParams,
  type SimulationFeeParams,
} from '../../lib/evm';
import {
  validateNftPosition,
  simulateNftExecution,
  getNftOnChainOrder,
  encodeNftExecuteOrderCalldata,
  type NftPreflightValidation,
  type OnChainOrderConfig,
} from './uniswapv3-nft-execution';
import {
  validateVaultPosition,
  simulateVaultExecution,
  getVaultOnChainOrder,
  computeVaultWithdrawMinAmounts,
  encodeVaultExecuteOrderCalldata,
  type VaultPreflightValidation,
} from './uniswapv3-vault-execution';
import { isSupportedChain, getWorkerConfig } from '../../lib/config';
import { computeDynamicFeeBps } from '../../lib/dynamic-fee';
import { resolveFeeRecipient } from '../../lib/fee-recipient';
import { automationLogger, autoLog } from '../../lib/logger';
import { getRabbitMQConnection, type ConsumeMessage } from '../../mq/connection-manager';
import { QUEUES, EXCHANGES, ROUTING_KEYS, ORDER_RETRY_DELAY_MS } from '../../mq/topology';
import {
  deserializeMessage,
  serializeMessage,
  type OrderTriggerMessage,
} from '../../mq/messages';
import { getSignerClient } from '../../clients/signer-client';
import type { WithdrawParamsInput, SwapParamsInput, FeeParamsInput } from '../../clients/signer-client';

const log = automationLogger.child({ component: 'CloseOrderExecutor' });

// Maximum number of execution attempts before marking order as permanently failed
const MAX_EXECUTION_ATTEMPTS = 3;

// =============================================================================
// Types
// =============================================================================

export interface CloseOrderExecutorStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  consumerCount: number;
  processedTotal: number;
  failedTotal: number;
  lastProcessedAt: string | null;
}

// =============================================================================
// Worker
// =============================================================================

export class CloseOrderExecutor {
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
      log.warn({ msg: 'CloseOrderExecutor already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'CloseOrderExecutor', 'starting');
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

    // Startup recovery: schedule retry timeouts for any orders stuck in 'retrying' state
    await this.recoverRetryingOrders();

    autoLog.workerLifecycle(log, 'CloseOrderExecutor', 'started', {
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

    autoLog.workerLifecycle(log, 'CloseOrderExecutor', 'stopping');
    this.status = 'stopping';

    const mq = getRabbitMQConnection();

    // Cancel all consumers
    for (const tag of this.consumerTags) {
      await mq.cancelConsumer(tag);
    }
    this.consumerTags = [];

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'CloseOrderExecutor', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): CloseOrderExecutorStatus {
    return {
      status: this.status,
      consumerCount: this.consumerCount,
      processedTotal: this.processedTotal,
      failedTotal: this.failedTotal,
      lastProcessedAt: this.lastProcessedAt?.toISOString() || null,
    };
  }

  /**
   * Recover orders stuck in 'retrying' state (e.g., process died mid-retry).
   * Schedules a retry timeout for each.
   */
  private async recoverRetryingOrders(): Promise<void> {
    try {
      const closeOrderService = getUniswapV3CloseOrderService();
      const retryingOrders = await closeOrderService.findRetryingOrders();

      if (retryingOrders.length === 0) return;

      log.info({
        count: retryingOrders.length,
        msg: 'Recovering orders stuck in retrying state',
      });

      for (const order of retryingOrders) {
        const config = (order.config ?? {}) as Record<string, unknown>;
        const state = (order.state ?? {}) as Record<string, unknown>;
        this.scheduleRetry({
          orderId: order.id,
          positionId: order.positionId,
          chainId: config.chainId as number,
          poolAddress: (state.pool as string) ?? '',
          triggerTick: state.triggerTick as number,
          triggerMode: config.triggerMode as number,
          triggerSide: (config.triggerMode as number) === 0 ? 'lower' : 'upper',
        });
      }
    } catch (err) {
      log.warn({ error: err, msg: 'Failed to recover retrying orders (will be picked up on next trigger)' });
    }
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

    const closeOrderService = getUniswapV3CloseOrderService();

    try {
      // Atomic CAS: monitoring|retrying → executing (increments executionAttempts)
      const transitioned = await closeOrderService.atomicTransitionToExecuting(orderId);
      if (!transitioned) {
        // Order is no longer in a valid state for execution (already executing, executed, failed, etc.)
        log.warn({ orderId, positionId, msg: 'Order not in valid state for execution, dropping message' });
        await mq.ack(msg);
        return;
      }

      await this.executeOrder(orderId, positionId, poolAddress, chainId, currentPrice, triggerPrice, triggerSide);

      // Acknowledge successful processing
      await mq.ack(msg);
      this.processedTotal++;
      this.lastProcessedAt = new Date();
    } catch (err) {
      const error = err as Error;
      autoLog.methodError(log, 'handleMessage.execute', error, { orderId, positionId });

      const automationLogService = getAutomationLogService();

      try {
        // Get current order to check attempts
        const order = await closeOrderService.findById(orderId);
        if (!order) {
          log.warn({ orderId, msg: 'Order not found after failure, dropping message' });
          await mq.ack(msg);
          this.failedTotal++;
          return;
        }

        const retryCount = order.executionAttempts;
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

        // Transition to retrying (sets lastError)
        await closeOrderService.transitionToRetrying(orderId, error.message);
        await mq.ack(msg);

        if (willRetry) {
          // Log retry scheduled
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

          // Extract trigger info for retry check
          const config = (order.config ?? {}) as Record<string, unknown>;
          const state = (order.state ?? {}) as Record<string, unknown>;

          // Schedule retry with price check after delay
          this.scheduleRetry({
            orderId,
            positionId,
            chainId,
            poolAddress,
            triggerTick: state.triggerTick as number,
            triggerMode: config.triggerMode as number,
            triggerSide,
          });

          log.warn({
            orderId,
            positionId,
            retryCount,
            maxAttempts: MAX_EXECUTION_ATTEMPTS,
            retryDelayMs: ORDER_RETRY_DELAY_MS,
            msg: `Order execution failed, retry scheduled after ${ORDER_RETRY_DELAY_MS / 1000}s delay with price check`,
          });
        } else {
          // Permanently failed
          await closeOrderService.markFailed(orderId, error.message);

          log.error(
            { orderId, positionId, retryCount, error: error.message },
            'Order permanently failed after max attempts'
          );

          // Send failure notification
          try {
            const positionService = getPositionService();
            const position = await positionService.findById(positionId);
            if (position) {
              const userNotificationService = getUserNotificationService();
              const notifyMethod = triggerSide === 'lower'
                ? userNotificationService.notifyStopLossFailed
                : userNotificationService.notifyTakeProfitFailed;

              await notifyMethod.call(userNotificationService, {
                userId: position.userId,
                positionId,
                orderId,
                chainId,
                triggerSqrtPriceX96: triggerPrice,
                error: error.message,
                retryCount,
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
          await mq.ack(msg);
          log.warn(
            { orderId, positionId, error: trackingError.message },
            'Order not found in database, dropping message'
          );
        } else {
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
   * Schedule a retry with price check after delay.
   *
   * After ORDER_RETRY_DELAY_MS:
   * 1. Read current pool price
   * 2. If trigger NOT met → resetToMonitoring (attempts=0, back to watching)
   * 3. If trigger still met AND attempts < MAX → publish to orders.pending for retry
   * 4. If trigger still met AND attempts >= MAX → markFailed (terminal)
   */
  private scheduleRetry(params: {
    orderId: string;
    positionId: string;
    chainId: number;
    poolAddress: string;
    triggerTick: number;
    triggerMode: number;
    triggerSide: 'lower' | 'upper';
  }): void {
    const { orderId, positionId, chainId, poolAddress, triggerTick, triggerMode, triggerSide } = params;

    setTimeout(async () => {
      try {
        const closeOrderService = getUniswapV3CloseOrderService();

        // Re-fetch order to get latest state
        const order = await closeOrderService.findById(orderId);
        if (!order || order.automationState !== 'retrying') {
          log.debug({ orderId, msg: 'Order no longer in retrying state, skipping retry' });
          return;
        }

        // Read current pool price
        const { tick: currentTick, sqrtPriceX96 } = await readPoolPrice(
          chainId as SupportedChainId,
          poolAddress as `0x${string}`
        );

        // Check if trigger condition is still met
        const triggerStillMet = triggerMode === 0
          ? currentTick <= triggerTick  // LOWER
          : currentTick >= triggerTick; // UPPER

        if (!triggerStillMet) {
          // Price moved away — reset to monitoring (attempts=0)
          await closeOrderService.resetToMonitoring(orderId);
          log.info({
            orderId,
            positionId,
            currentTick,
            triggerTick,
            triggerMode,
            msg: 'Price moved away from trigger, resetting to monitoring',
          });
          return;
        }

        if (order.executionAttempts >= MAX_EXECUTION_ATTEMPTS) {
          // Max attempts reached with trigger still met — permanently failed
          await closeOrderService.markFailed(orderId, order.lastError ?? 'Max execution attempts exhausted');
          log.error({
            orderId,
            positionId,
            executionAttempts: order.executionAttempts,
            msg: 'Order permanently failed after max attempts (trigger still met)',
          });
          return;
        }

        // Re-publish to orders.pending for any executor to pick up
        const triggerMessage: OrderTriggerMessage = {
          orderId,
          positionId,
          poolAddress,
          chainId,
          currentPrice: sqrtPriceX96.toString(),
          triggerPrice: sqrtPriceX96.toString(),
          triggerSide,
          triggeredAt: new Date().toISOString(),
        };

        const mq = getRabbitMQConnection();
        await mq.publish(EXCHANGES.TRIGGERS, ROUTING_KEYS.ORDER_TRIGGERED, serializeMessage(triggerMessage));

        log.info({
          orderId,
          positionId,
          executionAttempts: order.executionAttempts,
          currentTick,
          triggerTick,
          msg: 'Retry: trigger still met, re-published to pending queue',
        });
      } catch (err) {
        log.error({
          orderId,
          positionId,
          error: (err as Error).message,
          msg: 'Error during retry price check',
        });
      }
    }, ORDER_RETRY_DELAY_MS);
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
    const closeOrderService = getUniswapV3CloseOrderService();
    const automationSubscriptionService = getAutomationSubscriptionService();
    const signerClient = getSignerClient();

    // Validate chain support
    if (!isSupportedChain(chainId)) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    // Get order details — protocol-specific data is in config/state JSON
    const order = await closeOrderService.findById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const orderConfig = (order.config ?? {}) as Record<string, unknown>;

    // triggerMode from config JSON (0=LOWER, 1=UPPER)
    const triggerMode = orderConfig.triggerMode as number;

    // Contract address from config JSON
    const contractAddress = orderConfig.contractAddress as string | undefined;
    if (!contractAddress) {
      throw new Error(`Contract address not configured for order: ${orderId}`);
    }

    // Operator address from signer service (single operator key for all users)
    const operatorAddress = await signerClient.getOperatorAddress();

    // Get full position data (needed for signer service + price formatting)
    const positionService = getPositionService();
    const positionData = await positionService.findById(positionId);
    if (!positionData) {
      throw new Error(`Position not found: ${positionId}`);
    }
    // Position is protocol-agnostic at this level — cast to UniswapV3Position
    // for shared fields (pool, tokens, userId). Protocol-specific access is
    // handled by the NFT/vault execution modules below.
    const position = positionData as UniswapV3Position;
    const userId = position.userId;
    const protocol = position.protocol; // 'uniswapv3' or 'uniswapv3-vault'
    const isVault = protocol === 'uniswapv3-vault';

    // Get quote token decimals for human-readable price formatting
    const quoteTokenDecimals = position.isToken0Quote
      ? position.pool.token0.decimals
      : position.pool.token1.decimals;

    // =========================================================================
    // ON-CHAIN SWAP STATE: Read swap configuration from on-chain order
    // IMPORTANT: The contract decides whether to swap based on on-chain swapDirection,
    // not database config. We MUST use on-chain state to determine if swap params are needed.
    // =========================================================================
    let onChainOrder: OnChainOrderConfig;
    let nftId: bigint | undefined;
    let vaultAddress: `0x${string}` | undefined;
    let ownerAddress: `0x${string}` | undefined;
    let onChainShares: bigint | undefined;

    if (isVault) {
      // Vault: position identifier is vault address + owner
      const posConfig = position.config as Record<string, unknown>;
      vaultAddress = posConfig.vaultAddress as `0x${string}`;
      ownerAddress = (position.state as Record<string, unknown>).ownerAddress as `0x${string}`;
      if (!vaultAddress || !ownerAddress) {
        throw new Error(`Vault position missing vaultAddress or ownerAddress: ${positionId}`);
      }
      const vaultOrder = await getVaultOnChainOrder(
        chainId as SupportedChainId,
        contractAddress as `0x${string}`,
        vaultAddress,
        ownerAddress,
        triggerMode
      );
      onChainOrder = vaultOrder;
      onChainShares = vaultOrder.shares;
    } else {
      // NFT: position identifier is nftId
      if (!position.typedConfig.nftId) {
        throw new Error(`Position has no nftId: ${positionId}`);
      }
      nftId = BigInt(position.typedConfig.nftId);
      onChainOrder = await getNftOnChainOrder(
        chainId as SupportedChainId,
        contractAddress as `0x${string}`,
        nftId,
        triggerMode
      );
    }

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

    // =========================================================================
    // PRE-FLIGHT VALIDATION: Check position state before execution
    // =========================================================================
    let nftPreflight: NftPreflightValidation | undefined;
    let vaultPreflight: VaultPreflightValidation | undefined;

    log.info({
      orderId,
      positionId,
      protocol,
      contractAddress,
      msg: 'Running pre-flight validation',
    });

    if (isVault) {
      vaultPreflight = await validateVaultPosition(
        chainId as SupportedChainId,
        vaultAddress!,
        ownerAddress!,
        contractAddress as `0x${string}`,
        onChainShares ?? 0n
      );

      if (vaultPreflight.vaultData) {
        log.info({
          orderId,
          positionId,
          preflight: {
            isValid: vaultPreflight.isValid,
            reason: vaultPreflight.reason,
            sharesBalance: vaultPreflight.vaultData.sharesBalance.toString(),
            sharesToClose: vaultPreflight.vaultData.sharesToClose.toString(),
            totalSupply: vaultPreflight.vaultData.totalSupply.toString(),
            vaultLiquidity: vaultPreflight.vaultData.vaultLiquidity.toString(),
            owner: vaultPreflight.owner,
            isApproved: vaultPreflight.isApproved,
          },
          msg: 'Vault pre-flight validation result',
        });
      }

      if (!vaultPreflight.isValid) {
        throw new Error(`Pre-flight validation failed: ${vaultPreflight.reason}`);
      }
    } else {
      nftPreflight = await validateNftPosition(
        chainId as SupportedChainId,
        nftId!,
        position.typedState.ownerAddress as `0x${string}`,
        contractAddress as `0x${string}`
      );

      if (nftPreflight.positionData) {
        log.info({
          orderId,
          positionId,
          preflight: {
            isValid: nftPreflight.isValid,
            reason: nftPreflight.reason,
            liquidity: nftPreflight.positionData.liquidity.toString(),
            token0: nftPreflight.positionData.token0,
            token1: nftPreflight.positionData.token1,
            tickLower: nftPreflight.positionData.tickLower,
            tickUpper: nftPreflight.positionData.tickUpper,
            tokensOwed0: nftPreflight.positionData.tokensOwed0.toString(),
            tokensOwed1: nftPreflight.positionData.tokensOwed1.toString(),
            owner: nftPreflight.owner,
            isApproved: nftPreflight.isApproved,
            isApprovedForAll: nftPreflight.isApprovedForAll,
          },
          msg: 'NFT pre-flight validation result',
        });

        // Log to database for UI visibility
        const automationLogService = getAutomationLogService();
        const orderTag = triggerSide === 'upper' ? 'TP' : 'SL';
        await automationLogService.logPreflightValidation(positionId, orderId, {
          platform: 'evm',
          chainId,
          orderTag,
          isValid: nftPreflight.isValid,
          reason: nftPreflight.reason,
          liquidity: nftPreflight.positionData.liquidity.toString(),
          token0: nftPreflight.positionData.token0,
          token1: nftPreflight.positionData.token1,
          tickLower: nftPreflight.positionData.tickLower,
          tickUpper: nftPreflight.positionData.tickUpper,
          tokensOwed0: nftPreflight.positionData.tokensOwed0.toString(),
          tokensOwed1: nftPreflight.positionData.tokensOwed1.toString(),
          owner: nftPreflight.owner,
          isApproved: nftPreflight.isApproved,
          isApprovedForAll: nftPreflight.isApprovedForAll,
        });
      }

      if (!nftPreflight.isValid) {
        throw new Error(`Pre-flight validation failed: ${nftPreflight.reason}`);
      }
    }

    // Always fetch on-chain nonce before signing
    // Signer service is stateless and does not manage nonces
    const nonce = await getOnChainNonce(
      chainId as SupportedChainId,
      operatorAddress as `0x${string}`
    );

    log.info(
      { orderId, positionId, operatorAddress, nonce, executionAttempts: order.executionAttempts },
      'Fetched on-chain nonce for signing'
    );

    // Log ORDER_TRIGGERED for user visibility (on first attempt only)
    const automationLogService = getAutomationLogService();
    if (order.executionAttempts === 1) {
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

    // =========================================================================
    // WITHDRAW PARAMS: Compute off-chain withdrawal mins (amount0Min, amount1Min)
    // =========================================================================
    let withdrawParams;

    if (isVault) {
      if (!vaultPreflight?.vaultData) {
        throw new Error(`Cannot compute withdraw params: vault preflight data unavailable for order ${orderId}`);
      }
      withdrawParams = await computeVaultWithdrawMinAmounts(
        chainId as SupportedChainId,
        poolAddress as `0x${string}`,
        vaultPreflight.vaultData,
        onChainOrder.slippageBps
      );
    } else {
      if (!nftPreflight?.positionData) {
        throw new Error(`Cannot compute withdraw params: NFT preflight data unavailable for order ${orderId}`);
      }
      withdrawParams = await computeWithdrawMinAmounts(
        chainId as SupportedChainId,
        poolAddress as `0x${string}`,
        nftPreflight.positionData.liquidity,
        nftPreflight.positionData.tickLower,
        nftPreflight.positionData.tickUpper,
        onChainOrder.slippageBps
      );
    }

    log.info({
      orderId,
      positionId,
      amount0Min: withdrawParams.amount0Min.toString(),
      amount1Min: withdrawParams.amount1Min.toString(),
      slippageBps: onChainOrder.slippageBps,
      msg: 'Computed WithdrawParams',
    });

    // =========================================================================
    // DYNAMIC FEE: Compute feeBps based on gas cost vs withdrawal value
    // =========================================================================
    const dynamicFee = await computeDynamicFeeBps({
      chainId,
      gasLimit: 500_000n, // Conservative estimate for gas estimation
      gasPrice: await getPublicClient(chainId as SupportedChainId).getGasPrice(),
      token0CoingeckoId: position.pool.token0.coingeckoId ?? undefined,
      token1CoingeckoId: position.pool.token1.coingeckoId ?? undefined,
      token0Decimals: position.pool.token0.decimals,
      token1Decimals: position.pool.token1.decimals,
      estimatedAmount0: withdrawParams.amount0Min,
      estimatedAmount1: withdrawParams.amount1Min,
    });

    if (!dynamicFee.canCoverGas) {
      const automationLogService = getAutomationLogService();
      log.warn({
        orderId,
        positionId,
        estimatedGasCostWei: dynamicFee.estimatedGasCostWei.toString(),
        estimatedWithdrawalValueWei: dynamicFee.estimatedWithdrawalValueWei.toString(),
        rawFeeBps: dynamicFee.rawFeeBps,
        maxFeeBps: 100,
        msg: 'Fee does not cover gas costs — skipping execution',
      });

      await automationLogService.logExecutionSkipped(positionId, orderId, {
        platform: 'evm',
        chainId,
        orderTag: triggerSide === 'upper' ? 'TP' : 'SL',
        reason: 'fee does not cover gas costs',
        estimatedGasCostWei: dynamicFee.estimatedGasCostWei.toString(),
        estimatedWithdrawalValueWei: dynamicFee.estimatedWithdrawalValueWei.toString(),
        computedFeeBps: dynamicFee.rawFeeBps,
        maxFeeBps: 100,
      });

      // Transition back to monitoring — don't count as a failed attempt
      await closeOrderService.resetToMonitoring(orderId);
      return;
    }

    // =========================================================================
    // SWAP PARAMS: Get Paraswap quote for guaranteed swap portion
    // =========================================================================
    let swapParamsInput: SwapParamsInput = {
      guaranteedAmountIn: '0',
      minAmountOut: '0',
      deadline: 0,
      hops: [],
    };

    let simulationSwapParams: SimulationSwapParams = { ...EMPTY_SWAP_PARAMS };

    if (swapEnabled) {
      log.info({
        orderId,
        positionId,
        swapDirection,
        swapSlippageBps,
        msg: 'Computing Paraswap swap params',
      });

      // Determine which token amount is the swap input (based on direction)
      // TOKEN0_TO_1 = swap token0 → token1, so guaranteed = amount0Min after fees
      // TOKEN1_TO_0 = swap token1 → token0, so guaranteed = amount1Min after fees
      const swapTokenMin = onChainOrder.swapDirection === 1
        ? withdrawParams.amount0Min
        : withdrawParams.amount1Min;

      // Deduct fee to get guaranteed amount (contract deducts fees before swapping)
      const guaranteedAmountIn = (swapTokenMin * BigInt(10000 - dynamicFee.feeBps)) / 10000n;

      log.info({
        orderId,
        swapTokenMin: swapTokenMin.toString(),
        feeBps: dynamicFee.feeBps,
        guaranteedAmountIn: guaranteedAmountIn.toString(),
        msg: 'Computed guaranteedAmountIn (after fee deduction)',
      });

      if (guaranteedAmountIn > 0n) {
        if (!isParaswapSupportedChain(chainId)) {
          // Unsupported chain (local fork, BSC, Polygon, etc.) — skip Paraswap.
          // Empty swap params → contract routes 100% through Phase 2
          // (surplus path: direct UniswapV3 swap through position's own pool).
          log.info({
            orderId,
            chainId,
            guaranteedAmountIn: guaranteedAmountIn.toString(),
            msg: 'Chain not supported by Paraswap — skipping Phase 1, full amount via pool surplus swap',
          });
        } else {
          const swapRouterAddress = await readSwapRouterAddress(
            chainId as SupportedChainId,
            contractAddress as `0x${string}`
          );

          const paraswapAdapterAddress = await readParaswapAdapterAddress(
            chainId as SupportedChainId,
            swapRouterAddress
          );

          // Determine tokenIn/tokenOut from swap direction (use pool token addresses)
          const tokenIn = onChainOrder.swapDirection === 1
            ? (position.pool.token0.config as Record<string, unknown>).address as string
            : (position.pool.token1.config as Record<string, unknown>).address as string;
          const tokenOut = onChainOrder.swapDirection === 1
            ? (position.pool.token1.config as Record<string, unknown>).address as string
            : (position.pool.token0.config as Record<string, unknown>).address as string;

          // Get token decimals from the pool tokens
          const tokenInDecimals = onChainOrder.swapDirection === 1
            ? position.pool.token0.decimals
            : position.pool.token1.decimals;
          const tokenOutDecimals = onChainOrder.swapDirection === 1
            ? position.pool.token1.decimals
            : position.pool.token0.decimals;

          const paraswapService = new ParaswapSwapService();
          const swapResult = await paraswapService.computeParaswapSwapParams({
            chainId,
            tokenIn: tokenIn as `0x${string}`,
            tokenOut: tokenOut as `0x${string}`,
            tokenInDecimals,
            tokenOutDecimals,
            guaranteedAmountIn,
            swapSlippageBps,
            paraswapAdapterAddress,
          });

          if (swapResult.kind === 'do_not_execute') {
            throw new Error(
              `Paraswap swap price protection: ${swapResult.reason}`
            );
          }

          swapParamsInput = {
            guaranteedAmountIn: guaranteedAmountIn.toString(),
            minAmountOut: swapResult.minAmountOut.toString(),
            deadline: Number(swapResult.deadline),
            hops: swapResult.hops.map((hop) => ({
              venueId: hop.venueId,
              tokenIn: hop.tokenIn,
              tokenOut: hop.tokenOut,
              venueData: hop.venueData,
            })),
          };

          simulationSwapParams = {
            guaranteedAmountIn,
            minAmountOut: swapResult.minAmountOut,
            deadline: swapResult.deadline,
            hops: swapResult.hops.map((hop) => ({
              venueId: hop.venueId as `0x${string}`,
              tokenIn: hop.tokenIn as `0x${string}`,
              tokenOut: hop.tokenOut as `0x${string}`,
              venueData: hop.venueData as `0x${string}`,
            })),
          };

          log.info({
            orderId,
            positionId,
            tokenIn,
            tokenOut,
            guaranteedAmountIn: guaranteedAmountIn.toString(),
            minAmountOut: swapResult.minAmountOut.toString(),
            hopsCount: swapResult.hops.length,
            msg: 'Paraswap swap params computed',
          });
        }
      }
    }

    const feeRecipient = await resolveFeeRecipient(chainId);

    const feeParamsInput: FeeParamsInput = {
      feeRecipient,
      feeBps: dynamicFee.feeBps,
    };

    const simulationFeeParams: SimulationFeeParams = {
      feeRecipient: feeRecipient as `0x${string}`,
      feeBps: dynamicFee.feeBps,
    };

    // =========================================================================
    // SIMULATION: Simulate transaction before signing to catch errors early
    // =========================================================================
    log.info({
      orderId,
      positionId,
      protocol,
      triggerMode,
      contractAddress,
      operatorAddress,
      msg: 'Simulating executeOrder transaction',
    });

    const simulation = isVault
      ? await simulateVaultExecution(
          chainId as SupportedChainId,
          contractAddress as `0x${string}`,
          vaultAddress!,
          ownerAddress!,
          triggerMode,
          withdrawParams,
          simulationSwapParams,
          simulationFeeParams,
          operatorAddress as `0x${string}`
        )
      : await simulateNftExecution(
          chainId as SupportedChainId,
          contractAddress as `0x${string}`,
          nftId!,
          triggerMode,
          withdrawParams,
          simulationSwapParams,
          simulationFeeParams,
          operatorAddress as `0x${string}`
        );

    if (!simulation.success) {
      log.error({
        orderId,
        positionId,
        protocol,
        triggerMode,
        simulation,
        msg: 'Transaction simulation failed',
      });

      let contractBalances: {
        token0Symbol: string;
        token0Balance: string;
        token1Symbol: string;
        token1Balance: string;
      } | undefined;

      // Diagnostic: check contract token balances on simulation failure
      {
        try {
          const balances = await checkContractTokenBalances(
            chainId as SupportedChainId,
            (position.pool.token0.config as Record<string, unknown>).address as string as `0x${string}`,
            (position.pool.token1.config as Record<string, unknown>).address as string as `0x${string}`,
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
        } catch (balanceErr) {
          log.warn({
            orderId,
            positionId,
            error: (balanceErr as Error).message,
            msg: 'Failed to fetch contract balances for diagnostics',
          });
        }
      }

      const orderTagSim = triggerSide === 'upper' ? 'TP' : 'SL';
      await automationLogService.logSimulationFailed(positionId, orderId, {
        platform: 'evm',
        chainId,
        orderTag: orderTagSim,
        error: simulation.error || 'Unknown simulation error',
        decodedError: simulation.decodedError,
        nftId: nftId?.toString() ?? vaultAddress ?? '',
        triggerMode,
        contractAddress,
        feeRecipient: operatorAddress,
        feeBps: dynamicFee.feeBps,
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
      hasSwap: swapParamsInput.hops.length > 0,
    });

    const withdrawParamsInput: WithdrawParamsInput = {
      amount0Min: withdrawParams.amount0Min.toString(),
      amount1Min: withdrawParams.amount1Min.toString(),
    };

    // Encode calldata and sign using the protocol-appropriate ABI and endpoint
    const callData = isVault
      ? encodeVaultExecuteOrderCalldata({
          vaultAddress: vaultAddress!,
          ownerAddress: ownerAddress!,
          triggerMode,
          withdrawParams,
          swapParams: simulationSwapParams,
          feeParams: simulationFeeParams,
        })
      : encodeNftExecuteOrderCalldata({
          nftId: nftId!,
          triggerMode,
          withdrawParams,
          swapParams: simulationSwapParams,
          feeParams: simulationFeeParams,
        });

    const signerEndpoint = isVault
      ? '/api/sign/automation/uniswapv3/vault-position-closer/execute-order'
      : '/api/sign/automation/uniswapv3/position-closer/execute-order';

    const signedTx = await signerClient.signTransaction({
      userId,
      chainId,
      contractAddress,
      operatorAddress,
      nonce,
      callData,
      signerEndpoint,
      signerPayload: {
        ...(isVault
          ? { vaultAddress, ownerAddress }
          : { nftId: nftId!.toString() }),
        triggerMode,
        withdrawParams: withdrawParamsInput,
        swapParams: swapParamsInput,
        feeParams: feeParamsInput,
      },
    });

    autoLog.orderExecution(log, orderId, 'broadcasting', {
      txHash: signedTx.txHash,
    });

    const orderTagExec = triggerSide === 'upper' ? 'TP' : 'SL';
    await automationLogService.logOrderExecuting(positionId, orderId, {
      platform: 'evm',
      chainId,
      orderTag: orderTagExec,
      txHash: signedTx.txHash,
      operatorAddress,
    });

    const txHash = await broadcastTransaction(
      chainId as SupportedChainId,
      signedTx.signedTransaction as `0x${string}`
    );

    autoLog.orderExecution(log, orderId, 'waiting', { txHash });

    const receipt = await waitForTransaction(chainId as SupportedChainId, txHash);

    if (receipt.status === 'reverted') {
      const revertReason = await getRevertReason(chainId as SupportedChainId, txHash);

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

      {
        try {
          // Re-run preflight to get post-revert state for diagnostics
          if (!isVault && nftId) {
            const postRevertPreflight = await validateNftPosition(
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
          }

          // Check contract token balances for diagnostics (works for both protocols)
          const balances = await checkContractTokenBalances(
            chainId as SupportedChainId,
            (position.pool.token0.config as Record<string, unknown>).address as string as `0x${string}`,
            (position.pool.token1.config as Record<string, unknown>).address as string as `0x${string}`,
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

    // Publish close order events from receipt to close-order-events exchange.
    // This triggers the ProcessCloseOrderEventsRule downstream (DB cleanup, domain events).
    try {
      const channel = await getRabbitMQConnection().getChannel();
      const { eventsPublished } = await publishCloseOrderEventsFromReceipt(
        channel,
        chainId,
        txHash as `0x${string}`,
        contractAddress,
      );
      log.info({ orderId, txHash, eventsPublished, msg: 'Published close order events from execution receipt' });
    } catch (err) {
      log.warn({
        orderId,
        txHash,
        error: err instanceof Error ? err.message : String(err),
        msg: 'Failed to publish close order events from receipt (will be picked up by fallback poller)',
      });
    }

    // Remove per-order DB subscription (trivial — no "remaining orders?" check needed)
    try {
      await automationSubscriptionService.removeOrderSubscription(orderId);
      log.info({ orderId, msg: 'Removed close-order subscription' });
    } catch (err) {
      log.warn({ orderId, error: err, msg: 'Failed to remove close-order subscription' });
    }

    const orderTagCompleted = triggerSide === 'upper' ? 'TP' : 'SL';
    await automationLogService.logOrderExecuted(positionId, orderId, {
      platform: 'evm',
      chainId,
      orderTag: orderTagCompleted,
      txHash,
      gasUsed: receipt.gasUsed.toString(),
      amount0Out: '0', // TODO: Parse from tx receipt
      amount1Out: '0', // TODO: Parse from tx receipt
      executionFeeBps: dynamicFee.feeBps,
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

    await positionService.refresh(positionId);

    // Send execution success notification
    try {
      const userNotificationService = getUserNotificationService();
      const notifyMethod = triggerSide === 'lower'
        ? userNotificationService.notifyStopLossExecuted
        : userNotificationService.notifyTakeProfitExecuted;

      await notifyMethod.call(userNotificationService, {
        userId,
        positionId,
        orderId,
        chainId,
        txHash,
        amount0Out: '0', // TODO: Parse from tx receipt
        amount1Out: '0', // TODO: Parse from tx receipt
        triggerSqrtPriceX96: triggerPrice,
        executionSqrtPriceX96: _currentPrice,
      });
    } catch (notifyErr) {
      autoLog.methodError(log, 'executeOrder.notify', notifyErr, { orderId, positionId });
    }
  }
}
