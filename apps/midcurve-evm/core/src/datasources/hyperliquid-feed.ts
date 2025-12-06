import { Hyperliquid } from 'hyperliquid';
import type { Hex } from 'viem';
import { keccak256, toHex } from 'viem';
import type pino from 'pino';
import type { CoreOrchestrator } from '../orchestrator/orchestrator.js';
import type { OhlcEvent, OhlcCandle } from '../stores/types.js';
import {
  TIMEFRAME_TO_INTERVAL,
  INTERVAL_TO_TIMEFRAME,
  type HyperliquidFeedConfig,
  type HyperliquidInterval,
  type HyperliquidCandle,
} from './types.js';

// Note: WebSocket polyfill is set up in setup-websocket.ts (imported first in main.ts)

/**
 * Precision for converting floating point prices to bigint
 * 18 decimals (standard ERC-20 precision)
 */
const PRICE_PRECISION = 10n ** 18n;

/**
 * HyperliquidFeed provides real-time OHLC candle data from Hyperliquid.
 *
 * Features:
 * - WebSocket-based real-time candle updates
 * - Automatic reconnection handling
 * - Symbol and interval subscription management
 * - Converts Hyperliquid data format to SEMSEE format
 */
export class HyperliquidFeed {
  private client: Hyperliquid;
  private logger: pino.Logger;
  private orchestrator: CoreOrchestrator | null = null;

  /** Active subscriptions: "symbol:interval" -> callback unsubscribe key */
  private activeSubscriptions: Map<string, boolean> = new Map();

  /** Whether the feed is started */
  private isStarted = false;

  constructor(logger: pino.Logger, config: HyperliquidFeedConfig = {}) {
    this.logger = logger.child({ component: 'hyperliquid-feed' });

    // Create Hyperliquid client with config
    this.client = new Hyperliquid({
      testnet: config.testnet ?? false,
      enableWs: true,
    });

    this.logger.info(
      { testnet: config.testnet ?? false },
      'HyperliquidFeed created'
    );
  }

  /**
   * Set the orchestrator for event publishing
   */
  setOrchestrator(orchestrator: CoreOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  /**
   * Start the Hyperliquid WebSocket connection
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    this.logger.info('Starting HyperliquidFeed...');

    try {
      // Connect to Hyperliquid (initializes WebSocket connection)
      await this.client.connect();

      // The connect() method returns before WebSocket is actually ready.
      // We need to wait for the WebSocket to be in OPEN state before proceeding.
      await this.waitForConnection();

      this.isStarted = true;
      this.logger.info('HyperliquidFeed started and WebSocket connected');
    } catch (error) {
      // Log the actual error message for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ errorMessage }, 'Failed to start HyperliquidFeed');
      throw error;
    }
  }

  /**
   * Wait for the WebSocket connection to be ready.
   * Polls the connection state until it's open or timeout is reached.
   */
  private async waitForConnection(
    timeoutMs: number = 10000,
    pollIntervalMs: number = 100
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      // Try a test subscription to see if WebSocket is ready
      // The Hyperliquid SDK doesn't expose WebSocket state directly,
      // so we check by attempting a lightweight operation
      try {
        // Check if we can access the subscriptions API without error
        // This is a heuristic - the WebSocket needs to be open for subscriptions to work
        const ws = (this.client as unknown as { ws?: { isConnected?: boolean; readyState?: number } }).ws;

        // If we can access internal ws state
        if (ws) {
          if (ws.isConnected === true || ws.readyState === 1) {
            this.logger.debug('WebSocket connection confirmed ready');
            return;
          }
        }

        // Alternative: wait a bit after connect() for the socket to stabilize
        // This is a fallback if we can't inspect internal state
        if (Date.now() - startTime >= 2000) {
          // After 2 seconds, assume ready and let errors surface naturally
          this.logger.debug('WebSocket assumed ready after wait period');
          return;
        }
      } catch {
        // Ignore errors during checking, just wait and retry
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`WebSocket connection timeout after ${timeoutMs}ms`);
  }

  /**
   * Stop the Hyperliquid WebSocket connection
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.logger.info('Stopping HyperliquidFeed...');

    // Unsubscribe from all active subscriptions
    for (const key of this.activeSubscriptions.keys()) {
      const [symbol, interval] = key.split(':');
      try {
        await this.client.subscriptions.unsubscribeFromCandle(
          symbol,
          interval
        );
      } catch (error) {
        this.logger.warn(
          { symbol, interval, error },
          'Failed to unsubscribe during shutdown'
        );
      }
    }

    this.activeSubscriptions.clear();

    // Disconnect WebSocket
    this.client.disconnect();
    this.isStarted = false;

    this.logger.info('HyperliquidFeed stopped');
  }

  /**
   * Subscribe to candle updates for a market
   *
   * @param symbol The trading symbol (e.g., "BTC", "ETH")
   * @param timeframe The timeframe in minutes
   */
  async subscribeMarket(symbol: string, timeframe: number): Promise<void> {
    if (!this.isStarted) {
      throw new Error('HyperliquidFeed not started');
    }

    const interval = TIMEFRAME_TO_INTERVAL[timeframe];
    if (!interval) {
      throw new Error(`Unsupported timeframe: ${timeframe} minutes`);
    }

    const subscriptionKey = `${symbol}:${interval}`;

    // Check if already subscribed
    if (this.activeSubscriptions.has(subscriptionKey)) {
      this.logger.debug(
        { symbol, interval },
        'Already subscribed to market'
      );
      return;
    }

    this.logger.info({ symbol, interval, timeframe }, 'Subscribing to market');

    try {
      // Subscribe to candle updates
      await this.client.subscriptions.subscribeToCandle(
        symbol,
        interval,
        (candle: HyperliquidCandle) => {
          this.handleCandle(candle);
        }
      );

      this.activeSubscriptions.set(subscriptionKey, true);

      this.logger.info(
        { symbol, interval },
        'Subscribed to market candles'
      );
    } catch (error) {
      this.logger.error(
        {
          symbol,
          interval,
          error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        },
        'Failed to subscribe to market'
      );
      throw error;
    }
  }

  /**
   * Unsubscribe from candle updates for a market
   *
   * @param symbol The trading symbol
   * @param timeframe The timeframe in minutes
   */
  async unsubscribeMarket(symbol: string, timeframe: number): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    const interval = TIMEFRAME_TO_INTERVAL[timeframe];
    if (!interval) {
      return;
    }

    const subscriptionKey = `${symbol}:${interval}`;

    if (!this.activeSubscriptions.has(subscriptionKey)) {
      return;
    }

    this.logger.info({ symbol, interval }, 'Unsubscribing from market');

    try {
      await this.client.subscriptions.unsubscribeFromCandle(symbol, interval);
      this.activeSubscriptions.delete(subscriptionKey);

      this.logger.info(
        { symbol, interval },
        'Unsubscribed from market candles'
      );
    } catch (error) {
      this.logger.warn(
        { symbol, interval, error },
        'Failed to unsubscribe from market'
      );
    }
  }

  /**
   * Handle incoming candle data from Hyperliquid
   */
  private handleCandle(candle: HyperliquidCandle): void {
    if (!this.orchestrator) {
      this.logger.warn('Received candle but no orchestrator set');
      return;
    }

    // Convert Hyperliquid candle to SEMSEE format
    const interval = candle.i as HyperliquidInterval;
    const timeframe = INTERVAL_TO_TIMEFRAME[interval] ?? 1;

    const ohlcEvent: OhlcEvent = {
      type: 'ohlc',
      marketId: this.generateMarketId(candle.s),
      timeframe,
      candle: this.convertCandle(candle),
    };

    this.logger.debug(
      {
        symbol: candle.s,
        interval: candle.i,
        close: candle.c,
      },
      'Received candle update'
    );

    // Publish to orchestrator (async, fire-and-forget)
    this.orchestrator.publishEvent(ohlcEvent).catch((error) => {
      this.logger.error(
        { symbol: candle.s, error },
        'Failed to publish candle event'
      );
    });
  }

  /**
   * Convert Hyperliquid candle to SEMSEE OhlcCandle format
   */
  private convertCandle(candle: HyperliquidCandle): OhlcCandle {
    return {
      timestamp: BigInt(candle.t),
      open: this.priceToFixed(candle.o),
      high: this.priceToFixed(candle.h),
      low: this.priceToFixed(candle.l),
      close: this.priceToFixed(candle.c),
      volume: this.priceToFixed(candle.v),
    };
  }

  /**
   * Convert a floating point price to fixed-point bigint (18 decimals)
   */
  private priceToFixed(price: number): bigint {
    // Handle potential floating point issues
    const scaled = Math.round(price * Number(PRICE_PRECISION));
    return BigInt(scaled);
  }

  /**
   * Generate a market ID from a symbol
   * Format: keccak256("symbol/USD")
   */
  private generateMarketId(symbol: string): Hex {
    const normalizedSymbol = symbol.toUpperCase();
    return keccak256(toHex(`${normalizedSymbol}/USD`));
  }

  /**
   * Get the number of active subscriptions
   */
  get subscriptionCount(): number {
    return this.activeSubscriptions.size;
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.isStarted;
  }

  /**
   * Get list of active subscriptions
   */
  getActiveSubscriptions(): Array<{ symbol: string; interval: string }> {
    return Array.from(this.activeSubscriptions.keys()).map((key) => {
      const [symbol, interval] = key.split(':');
      return { symbol, interval };
    });
  }
}
