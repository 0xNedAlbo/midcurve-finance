/**
 * Hyperliquid API Client
 *
 * Provides read-only access to Hyperliquid API for account state,
 * open orders, and market metadata.
 *
 * Features:
 * - Account state queries (positions, margin)
 * - Open orders lookup
 * - Market metadata (perps, spot)
 * - Distributed caching (PostgreSQL via CacheService)
 * - Rate limiting via RequestScheduler
 * - Singleton + dependency injection pattern
 *
 * Note: This client only wraps read operations (InfoClient).
 * Trading operations that require signing are handled by
 * midcurve-automation with access to the signer service.
 */

import { InfoClient, HttpTransport, type HttpTransportOptions } from '@nktkas/hyperliquid';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { CacheService } from '../../services/cache/index.js';
import { RequestScheduler } from '../../utils/request-scheduler/index.js';
import type {
  HyperliquidAccountState,
  HyperliquidOrder,
  HyperliquidPerpsMeta,
  HyperliquidSpotMeta,
  HyperliquidPerpsMetaAndAssetCtxs,
  HyperliquidPosition,
  HyperliquidLeverage,
  HyperliquidMarginSummary,
} from './types.js';

/**
 * Error thrown when Hyperliquid API request fails
 */
export class HyperliquidApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'HyperliquidApiError';
  }
}

/**
 * Dependencies for HyperliquidClient
 */
export interface HyperliquidClientDependencies {
  /**
   * Cache service for distributed caching
   * If not provided, the singleton CacheService instance will be used
   */
  cacheService?: CacheService;

  /**
   * Request scheduler for rate limiting
   * If not provided, a new RequestScheduler with 100ms spacing will be created
   */
  requestScheduler?: RequestScheduler;

  /**
   * Whether to use testnet API endpoints
   * @default false
   */
  isTestnet?: boolean;

  /**
   * Custom HTTP transport options
   */
  transportOptions?: Omit<HttpTransportOptions, 'isTestnet'>;
}

/**
 * Cache TTL constants (in seconds)
 */
const CACHE_TTL = {
  /** Account state - volatile, short TTL */
  ACCOUNT_STATE: 60,
  /** Open orders - volatile, short TTL */
  OPEN_ORDERS: 30,
  /** Perps metadata - changes rarely */
  PERPS_META: 300,
  /** Spot metadata - changes rarely */
  SPOT_META: 300,
  /** Asset context - market data, moderate TTL */
  ASSET_CONTEXT: 30,
} as const;

/**
 * Hyperliquid API Client
 *
 * Read-only client for Hyperliquid API interactions.
 * Uses singleton pattern for convenient default access.
 */
export class HyperliquidClient {
  private static instance: HyperliquidClient | null = null;

  private readonly infoClient: InfoClient;
  private readonly cacheService: CacheService;
  private readonly requestScheduler: RequestScheduler;
  private readonly logger: ServiceLogger;
  private readonly isTestnet: boolean;

  constructor(dependencies: HyperliquidClientDependencies = {}) {
    this.logger = createServiceLogger('HyperliquidClient');
    this.cacheService = dependencies.cacheService ?? CacheService.getInstance();
    this.requestScheduler =
      dependencies.requestScheduler ??
      new RequestScheduler({
        minSpacingMs: 100, // Hyperliquid has generous rate limits
        name: 'HyperliquidScheduler',
      });

    this.isTestnet = dependencies.isTestnet ?? false;

    // Create HTTP transport
    const transport = new HttpTransport({
      isTestnet: this.isTestnet,
      timeout: 15_000, // 15 second timeout
      ...dependencies.transportOptions,
    });

    // Create InfoClient
    this.infoClient = new InfoClient({ transport });

    this.logger.info(
      { isTestnet: this.isTestnet },
      'HyperliquidClient initialized'
    );
  }

  /**
   * Get singleton instance of HyperliquidClient
   */
  static getInstance(): HyperliquidClient {
    if (!HyperliquidClient.instance) {
      HyperliquidClient.instance = new HyperliquidClient();
    }
    return HyperliquidClient.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  static resetInstance(): void {
    HyperliquidClient.instance = null;
  }

  // ============================================================================
  // ACCOUNT METHODS
  // ============================================================================

  /**
   * Get account state for a user address
   *
   * Returns margin summary, positions, and withdrawable amount.
   *
   * @param address - User wallet address (0x...)
   * @returns Account state including positions and margin info
   * @throws HyperliquidApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = HyperliquidClient.getInstance();
   * const state = await client.getAccountState('0x...');
   * console.log('Account value:', state.marginSummary.accountValue);
   * console.log('Positions:', state.positions.length);
   * ```
   */
  async getAccountState(address: string): Promise<HyperliquidAccountState> {
    log.methodEntry(this.logger, 'getAccountState', { address });

    const cacheKey = `hyperliquid:account:${address.toLowerCase()}`;

    // Check cache first
    const cached = await this.cacheService.get<HyperliquidAccountState>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getAccountState', cacheKey);
      log.methodExit(this.logger, 'getAccountState', { fromCache: true });
      return cached;
    }

    log.cacheMiss(this.logger, 'getAccountState', cacheKey);

    try {
      const response = await this.requestScheduler.schedule(async () => {
        log.externalApiCall(this.logger, 'Hyperliquid', 'clearinghouseState', { address });
        return this.infoClient.clearinghouseState({ user: address as `0x${string}` });
      });

      // Map SDK response to our types
      const accountState = this.mapAccountState(response);

      // Cache the result
      await this.cacheService.set(cacheKey, accountState, CACHE_TTL.ACCOUNT_STATE);

      log.methodExit(this.logger, 'getAccountState', {
        positionCount: accountState.positions.length,
        accountValue: accountState.marginSummary.accountValue,
        fromCache: false,
      });

      return accountState;
    } catch (error) {
      const wrappedError = this.wrapError(error, 'Failed to get account state');
      log.methodError(this.logger, 'getAccountState', wrappedError, { address });
      throw wrappedError;
    }
  }

  /**
   * Get open orders for a user address
   *
   * @param address - User wallet address (0x...)
   * @returns List of open orders
   * @throws HyperliquidApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = HyperliquidClient.getInstance();
   * const orders = await client.getOpenOrders('0x...');
   * orders.forEach(order => {
   *   console.log(`${order.side} ${order.size} ${order.coin} @ ${order.limitPrice}`);
   * });
   * ```
   */
  async getOpenOrders(address: string): Promise<HyperliquidOrder[]> {
    log.methodEntry(this.logger, 'getOpenOrders', { address });

    const cacheKey = `hyperliquid:orders:${address.toLowerCase()}`;

    // Check cache first
    const cached = await this.cacheService.get<HyperliquidOrder[]>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getOpenOrders', cacheKey);
      log.methodExit(this.logger, 'getOpenOrders', { count: cached.length, fromCache: true });
      return cached;
    }

    log.cacheMiss(this.logger, 'getOpenOrders', cacheKey);

    try {
      const response = await this.requestScheduler.schedule(async () => {
        log.externalApiCall(this.logger, 'Hyperliquid', 'openOrders', { address });
        return this.infoClient.openOrders({ user: address as `0x${string}` });
      });

      // Map SDK response to our types
      const orders = response.map((order): HyperliquidOrder => ({
        orderId: order.oid,
        coin: order.coin,
        side: order.side === 'B' ? 'buy' : 'sell',
        limitPrice: order.limitPx,
        size: order.sz,
        remainingSize: order.sz, // Use sz as remaining (origSz is the original size)
        timestamp: order.timestamp,
        orderType: 'Limit', // Basic openOrders returns limit orders, detailed info requires frontendOpenOrders
        reduceOnly: order.reduceOnly ?? false,
      }));

      // Cache the result
      await this.cacheService.set(cacheKey, orders, CACHE_TTL.OPEN_ORDERS);

      log.methodExit(this.logger, 'getOpenOrders', { count: orders.length, fromCache: false });

      return orders;
    } catch (error) {
      const wrappedError = this.wrapError(error, 'Failed to get open orders');
      log.methodError(this.logger, 'getOpenOrders', wrappedError, { address });
      throw wrappedError;
    }
  }

  // ============================================================================
  // MARKET METADATA METHODS
  // ============================================================================

  /**
   * Get perpetuals market metadata
   *
   * Returns the list of available perpetual assets with their properties.
   *
   * @returns Perpetuals metadata including universe of assets
   * @throws HyperliquidApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = HyperliquidClient.getInstance();
   * const meta = await client.getPerpsMeta();
   * console.log('Available perps:', meta.universe.map(a => a.name));
   * ```
   */
  async getPerpsMeta(): Promise<HyperliquidPerpsMeta> {
    log.methodEntry(this.logger, 'getPerpsMeta');

    const cacheKey = 'hyperliquid:meta:perps';

    // Check cache first
    const cached = await this.cacheService.get<HyperliquidPerpsMeta>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getPerpsMeta', cacheKey);
      log.methodExit(this.logger, 'getPerpsMeta', { universeSize: cached.universe.length, fromCache: true });
      return cached;
    }

    log.cacheMiss(this.logger, 'getPerpsMeta', cacheKey);

    try {
      const response = await this.requestScheduler.schedule(async () => {
        log.externalApiCall(this.logger, 'Hyperliquid', 'meta', {});
        return this.infoClient.meta();
      });

      // Map SDK response to our types
      const meta: HyperliquidPerpsMeta = {
        universe: response.universe.map((asset) => ({
          name: asset.name,
          szDecimals: asset.szDecimals,
          maxLeverage: asset.maxLeverage,
          onlyIsolated: asset.onlyIsolated ?? false,
        })),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, meta, CACHE_TTL.PERPS_META);

      log.methodExit(this.logger, 'getPerpsMeta', { universeSize: meta.universe.length, fromCache: false });

      return meta;
    } catch (error) {
      const wrappedError = this.wrapError(error, 'Failed to get perps metadata');
      log.methodError(this.logger, 'getPerpsMeta', wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Get spot market metadata
   *
   * Returns the list of available spot tokens and pairs.
   *
   * @returns Spot metadata including tokens and pairs
   * @throws HyperliquidApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = HyperliquidClient.getInstance();
   * const meta = await client.getSpotMeta();
   * console.log('Spot tokens:', meta.tokens.map(t => t.name));
   * console.log('Spot pairs:', meta.universe.map(p => p.name));
   * ```
   */
  async getSpotMeta(): Promise<HyperliquidSpotMeta> {
    log.methodEntry(this.logger, 'getSpotMeta');

    const cacheKey = 'hyperliquid:meta:spot';

    // Check cache first
    const cached = await this.cacheService.get<HyperliquidSpotMeta>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getSpotMeta', cacheKey);
      log.methodExit(this.logger, 'getSpotMeta', {
        tokenCount: cached.tokens.length,
        pairCount: cached.universe.length,
        fromCache: true
      });
      return cached;
    }

    log.cacheMiss(this.logger, 'getSpotMeta', cacheKey);

    try {
      const response = await this.requestScheduler.schedule(async () => {
        log.externalApiCall(this.logger, 'Hyperliquid', 'spotMeta', {});
        return this.infoClient.spotMeta();
      });

      // Map SDK response to our types
      const meta: HyperliquidSpotMeta = {
        tokens: response.tokens.map((token) => ({
          name: token.name,
          szDecimals: token.szDecimals,
          weiDecimals: token.weiDecimals,
          index: token.index,
          tokenId: token.tokenId,
          isCanonical: token.isCanonical,
          evmContract: token.evmContract?.address ?? null,
          fullName: token.fullName ?? null,
        })),
        universe: response.universe.map((pair) => ({
          name: pair.name,
          tokens: pair.tokens as [number, number],
          index: pair.index,
          isCanonical: pair.isCanonical,
        })),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, meta, CACHE_TTL.SPOT_META);

      log.methodExit(this.logger, 'getSpotMeta', {
        tokenCount: meta.tokens.length,
        pairCount: meta.universe.length,
        fromCache: false
      });

      return meta;
    } catch (error) {
      const wrappedError = this.wrapError(error, 'Failed to get spot metadata');
      log.methodError(this.logger, 'getSpotMeta', wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Get perps metadata with asset contexts (current market data)
   *
   * Returns both metadata and current market data (prices, funding, OI) for all perps.
   *
   * @returns Perps metadata with asset contexts
   * @throws HyperliquidApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = HyperliquidClient.getInstance();
   * const data = await client.getPerpsMetaAndAssetCtxs();
   * const btcCtx = data.assetCtxs[0]; // BTC context
   * console.log('BTC mark price:', btcCtx.markPx);
   * ```
   */
  async getPerpsMetaAndAssetCtxs(): Promise<HyperliquidPerpsMetaAndAssetCtxs> {
    log.methodEntry(this.logger, 'getPerpsMetaAndAssetCtxs');

    const cacheKey = 'hyperliquid:meta:perps-with-ctx';

    // Check cache first
    const cached = await this.cacheService.get<HyperliquidPerpsMetaAndAssetCtxs>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getPerpsMetaAndAssetCtxs', cacheKey);
      log.methodExit(this.logger, 'getPerpsMetaAndAssetCtxs', { fromCache: true });
      return cached;
    }

    log.cacheMiss(this.logger, 'getPerpsMetaAndAssetCtxs', cacheKey);

    try {
      const response = await this.requestScheduler.schedule(async () => {
        log.externalApiCall(this.logger, 'Hyperliquid', 'metaAndAssetCtxs', {});
        return this.infoClient.metaAndAssetCtxs();
      });

      // Map SDK response to our types
      const result: HyperliquidPerpsMetaAndAssetCtxs = {
        meta: {
          universe: response[0].universe.map((asset) => ({
            name: asset.name,
            szDecimals: asset.szDecimals,
            maxLeverage: asset.maxLeverage,
            onlyIsolated: asset.onlyIsolated ?? false,
          })),
        },
        assetCtxs: response[1].map((ctx) => {
          const impactPxs = ctx.impactPxs ?? ['0', '0'];
          return {
            dayNtlVlm: ctx.dayNtlVlm,
            funding: ctx.funding,
            openInterest: ctx.openInterest,
            oraclePrice: ctx.oraclePx,
            premium: ctx.premium ?? '0',
            prevDayPx: ctx.prevDayPx,
            markPx: ctx.markPx,
            midPx: ctx.midPx ?? '0',
            impactPxs: [impactPxs[0] ?? '0', impactPxs[1] ?? '0'] as [string, string],
          };
        }),
      };

      // Cache with shorter TTL since this includes market data
      await this.cacheService.set(cacheKey, result, CACHE_TTL.ASSET_CONTEXT);

      log.methodExit(this.logger, 'getPerpsMetaAndAssetCtxs', {
        universeSize: result.meta.universe.length,
        fromCache: false
      });

      return result;
    } catch (error) {
      const wrappedError = this.wrapError(error, 'Failed to get perps meta and asset contexts');
      log.methodError(this.logger, 'getPerpsMetaAndAssetCtxs', wrappedError);
      throw wrappedError;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Map SDK clearinghouse state to our account state type
   */
  private mapAccountState(response: Awaited<ReturnType<InfoClient['clearinghouseState']>>): HyperliquidAccountState {
    const mapMarginSummary = (summary: {
      accountValue: string;
      totalNtlPos: string;
      totalRawUsd: string;
      totalMarginUsed: string;
    }): HyperliquidMarginSummary => ({
      accountValue: summary.accountValue,
      totalNotionalPosition: summary.totalNtlPos,
      totalRawUsd: summary.totalRawUsd,
      totalMarginUsed: summary.totalMarginUsed,
    });

    const mapPosition = (pos: (typeof response.assetPositions)[0]): HyperliquidPosition => {
      const p = pos.position;

      const leverage: HyperliquidLeverage = p.leverage.type === 'isolated'
        ? {
            type: 'isolated',
            value: p.leverage.value,
            rawUsd: p.leverage.rawUsd,
          }
        : {
            type: 'cross',
            value: p.leverage.value,
          };

      return {
        coin: p.coin,
        size: p.szi,
        entryPrice: p.entryPx,
        positionValue: p.positionValue,
        unrealizedPnl: p.unrealizedPnl,
        returnOnEquity: p.returnOnEquity,
        liquidationPrice: p.liquidationPx,
        marginUsed: p.marginUsed,
        leverage,
        maxLeverage: p.maxLeverage,
      };
    };

    return {
      marginSummary: mapMarginSummary(response.marginSummary),
      crossMarginSummary: mapMarginSummary(response.crossMarginSummary),
      crossMaintenanceMarginUsed: response.crossMaintenanceMarginUsed,
      withdrawable: response.withdrawable,
      positions: response.assetPositions.map(mapPosition),
      timestamp: response.time,
    };
  }

  /**
   * Wrap errors in HyperliquidApiError
   */
  private wrapError(error: unknown, message: string): HyperliquidApiError {
    if (error instanceof HyperliquidApiError) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new HyperliquidApiError(`${message}: ${errorMessage}`);
  }

  /**
   * Clear all Hyperliquid caches (useful for testing or manual refresh)
   *
   * @returns Number of cache entries cleared, or -1 on error
   */
  async clearCache(): Promise<number> {
    return await this.cacheService.clear('hyperliquid:');
  }
}
