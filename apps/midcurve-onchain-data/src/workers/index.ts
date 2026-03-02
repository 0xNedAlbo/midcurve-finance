/**
 * WorkerManager
 *
 * Coordinates workers and services for the onchain data service.
 * Manages lifecycle: start, stop, and status reporting.
 *
 * Workers:
 * - PoolPriceSubscriber: Subscribes to Swap events for pools with active positions
 * - PositionLiquiditySubscriber: Subscribes to NFPM events for active positions
 * - Erc20ApprovalSubscriber: Subscribes to ERC-20 Approval events for token approvals
 * - Erc20BalanceSubscriber: Subscribes to ERC-20 Transfer events for token balances
 * - EvmTxStatusSubscriber: Polls RPC for EVM transaction status updates
 * - NfpmTransferSubscriber: Subscribes to ERC-721 Transfer events for position lifecycle (mint/burn/transfer)
 *
 * Event Consumers:
 * - PositionEventHandler: Handles position.created, position.closed, and position.deleted
 *   events, notifying both subscribers to dynamically update their WebSocket subscriptions
 */

import { onchainDataLogger, priceLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { PositionEventHandler } from '../events';
import { PoolPriceSubscriber } from './pool-price-subscriber';
import { PositionLiquiditySubscriber } from './position-liquidity-subscriber';
import { Erc20ApprovalSubscriber } from './erc20-approval-subscriber';
import { Erc20BalanceSubscriber } from './erc20-balance-subscriber';
import { EvmTxStatusSubscriber } from './evm-tx-status-subscriber';
import { UniswapV3PoolPriceSubscriber } from './uniswapv3-pool-price-subscriber';
import { CloseOrderSubscriber } from './close-order-subscriber';
import { NfpmTransferSubscriber } from './nfpm-transfer-subscriber';

const log = onchainDataLogger.child({ component: 'WorkerManager' });

/**
 * WorkerManager coordinates all workers and services.
 */
export class WorkerManager {
  private poolPriceSubscriber: PoolPriceSubscriber;
  private positionLiquiditySubscriber: PositionLiquiditySubscriber;
  private erc20ApprovalSubscriber: Erc20ApprovalSubscriber;
  private erc20BalanceSubscriber: Erc20BalanceSubscriber;
  private evmTxStatusSubscriber: EvmTxStatusSubscriber;
  private uniswapV3PoolPriceSubscriber: UniswapV3PoolPriceSubscriber;
  private closeOrderSubscriber: CloseOrderSubscriber;
  private nfpmTransferSubscriber: NfpmTransferSubscriber;
  private positionEventHandler: PositionEventHandler;
  private isRunning = false;

  constructor() {
    this.poolPriceSubscriber = new PoolPriceSubscriber();
    this.positionLiquiditySubscriber = new PositionLiquiditySubscriber();
    this.erc20ApprovalSubscriber = new Erc20ApprovalSubscriber();
    this.erc20BalanceSubscriber = new Erc20BalanceSubscriber();
    this.evmTxStatusSubscriber = new EvmTxStatusSubscriber();
    this.uniswapV3PoolPriceSubscriber = new UniswapV3PoolPriceSubscriber();
    this.closeOrderSubscriber = new CloseOrderSubscriber();
    this.nfpmTransferSubscriber = new NfpmTransferSubscriber();
    this.positionEventHandler = new PositionEventHandler();

    // Wire both subscribers to event handler
    // Position events trigger updates in both:
    // - PositionLiquiditySubscriber: NFPM event subscriptions
    // - PoolPriceSubscriber: pool price subscriptions
    this.positionEventHandler.setPositionSubscriber(this.positionLiquiditySubscriber);
    this.positionEventHandler.setPoolPriceSubscriber(this.poolPriceSubscriber);
  }

  /**
   * Start the worker manager.
   * Connects to RabbitMQ and starts all workers and event consumers.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'WorkerManager already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'WorkerManager', 'starting');

    try {
      // Connect to RabbitMQ first (this also sets up topology for both exchanges)
      log.info({ msg: 'Connecting to RabbitMQ...' });
      const mq = getRabbitMQConnection();
      const channel = await mq.getChannel();

      // Start event consumer BEFORE loading positions
      // This ensures we don't miss any events during startup
      log.info({ msg: 'Starting domain event consumer...' });
      await this.positionEventHandler.start(channel);

      // Start all subscribers in parallel (initial DB load + WebSocket connections)
      log.info({ msg: 'Starting subscribers...' });
      await Promise.all([
        this.poolPriceSubscriber.start(),
        this.positionLiquiditySubscriber.start(),
        this.erc20ApprovalSubscriber.start(),
        this.erc20BalanceSubscriber.start(),
        this.evmTxStatusSubscriber.start(),
        this.uniswapV3PoolPriceSubscriber.start(),
        this.closeOrderSubscriber.start(),
        this.nfpmTransferSubscriber.start(),
      ]);

      this.isRunning = true;
      priceLog.workerLifecycle(log, 'WorkerManager', 'started');
    } catch (error) {
      priceLog.workerLifecycle(log, 'WorkerManager', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the worker manager.
   * Gracefully stops all workers, event consumers, and disconnects from services.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'WorkerManager not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'WorkerManager', 'stopping');

    try {
      // Stop event consumer first
      log.info({ msg: 'Stopping domain event consumer...' });
      await this.positionEventHandler.stop();

      // Stop all subscribers in parallel
      log.info({ msg: 'Stopping subscribers...' });
      await Promise.all([
        this.poolPriceSubscriber.stop(),
        this.positionLiquiditySubscriber.stop(),
        this.erc20ApprovalSubscriber.stop(),
        this.erc20BalanceSubscriber.stop(),
        this.evmTxStatusSubscriber.stop(),
        this.uniswapV3PoolPriceSubscriber.stop(),
        this.closeOrderSubscriber.stop(),
        this.nfpmTransferSubscriber.stop(),
      ]);

      // Close RabbitMQ connection
      log.info({ msg: 'Closing RabbitMQ connection...' });
      const mq = getRabbitMQConnection();
      await mq.close();

      this.isRunning = false;
      priceLog.workerLifecycle(log, 'WorkerManager', 'stopped');
    } catch (error) {
      priceLog.workerLifecycle(log, 'WorkerManager', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get the status of the worker manager and all workers.
   */
  getStatus(): {
    isRunning: boolean;
    poolPriceSubscriber: ReturnType<PoolPriceSubscriber['getStatus']>;
    positionLiquiditySubscriber: ReturnType<PositionLiquiditySubscriber['getStatus']>;
    erc20ApprovalSubscriber: ReturnType<Erc20ApprovalSubscriber['getStatus']>;
    erc20BalanceSubscriber: ReturnType<Erc20BalanceSubscriber['getStatus']>;
    evmTxStatusSubscriber: ReturnType<EvmTxStatusSubscriber['getStatus']>;
    uniswapV3PoolPriceSubscriber: ReturnType<UniswapV3PoolPriceSubscriber['getStatus']>;
    closeOrderSubscriber: ReturnType<CloseOrderSubscriber['getStatus']>;
    nfpmTransferSubscriber: ReturnType<NfpmTransferSubscriber['getStatus']>;
    eventConsumer: {
      positionEvents: { isRunning: boolean };
    };
    rabbitmq: {
      isConnected: boolean;
    };
  } {
    const mq = getRabbitMQConnection();

    return {
      isRunning: this.isRunning,
      poolPriceSubscriber: this.poolPriceSubscriber.getStatus(),
      positionLiquiditySubscriber: this.positionLiquiditySubscriber.getStatus(),
      erc20ApprovalSubscriber: this.erc20ApprovalSubscriber.getStatus(),
      erc20BalanceSubscriber: this.erc20BalanceSubscriber.getStatus(),
      evmTxStatusSubscriber: this.evmTxStatusSubscriber.getStatus(),
      uniswapV3PoolPriceSubscriber: this.uniswapV3PoolPriceSubscriber.getStatus(),
      closeOrderSubscriber: this.closeOrderSubscriber.getStatus(),
      nfpmTransferSubscriber: this.nfpmTransferSubscriber.getStatus(),
      eventConsumer: {
        positionEvents: { isRunning: this.positionEventHandler.isRunning() },
      },
      rabbitmq: {
        isConnected: mq.isConnected(),
      },
    };
  }

  /**
   * @deprecated Use poolPriceSubscriber instead. Kept for backward compatibility.
   */
  get subscriber(): PoolPriceSubscriber {
    return this.poolPriceSubscriber;
  }
}

/**
 * Export subscribers for direct usage if needed.
 */
export { PoolPriceSubscriber } from './pool-price-subscriber';
export { PositionLiquiditySubscriber } from './position-liquidity-subscriber';
export { Erc20ApprovalSubscriber } from './erc20-approval-subscriber';
export { Erc20BalanceSubscriber } from './erc20-balance-subscriber';
export { EvmTxStatusSubscriber } from './evm-tx-status-subscriber';
export { UniswapV3PoolPriceSubscriber } from './uniswapv3-pool-price-subscriber';
export { CloseOrderSubscriber } from './close-order-subscriber';
export { NfpmTransferSubscriber } from './nfpm-transfer-subscriber';
