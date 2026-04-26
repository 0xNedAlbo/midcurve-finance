/**
 * TokenPriceSeriesService
 *
 * Single source of CoinGecko historical-price fetches for σ computation.
 *
 * Wraps `CoinGeckoClient.getMarketChartRange()` once per token per ~24h,
 * buckets the response down to one observation per UTC date, and caches the
 * processed series in `CacheService`. Downstream `VolatilityService` and
 * `PoolSigmaFilterService` consume the cached series without ever touching
 * CoinGecko directly.
 *
 * See PRD §6.1.
 */

import { CoinGeckoClient } from '../../clients/coingecko/index.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { CacheService } from '../cache/index.js';
import { bucketByIsoDate } from './volatility-math.js';
import type { DailyPriceSeries } from './types.js';

/** Cache version — bump this to invalidate all cached series after a math fix. */
const CACHE_KEY_VERSION = 'v1';

/** Days fetched on each refresh — comfortably > 365 for 365d windows. */
const FETCH_WINDOW_DAYS = 400;

const SECONDS_PER_DAY = 86_400;

/** TTL for an OK series — 24h, refresh once per day per token. */
const TTL_OK_SECONDS = 24 * 3600;

/** TTL for transient fetch failures — 1h, retry-friendly. */
const TTL_FETCH_FAILED_SECONDS = 3600;

/**
 * TTL for `token_not_listed` — 7 days. PRD §6.1 says "permanent" but cache
 * eviction at 7d limits damage if a token gets listed later or the lookup
 * table is updated.
 */
const TTL_NOT_LISTED_SECONDS = 7 * 24 * 3600;

export interface TokenPriceSeriesServiceDependencies {
  coinGeckoClient?: CoinGeckoClient;
  cacheService?: CacheService;
}

export class TokenPriceSeriesService {
  private static instance: TokenPriceSeriesService | null = null;

  private readonly coinGeckoClient: CoinGeckoClient;
  private readonly cacheService: CacheService;
  private readonly logger: ServiceLogger;

  constructor(deps: TokenPriceSeriesServiceDependencies = {}) {
    this.coinGeckoClient = deps.coinGeckoClient ?? CoinGeckoClient.getInstance();
    this.cacheService = deps.cacheService ?? CacheService.getInstance();
    this.logger = createServiceLogger('TokenPriceSeriesService');
  }

  static getInstance(): TokenPriceSeriesService {
    if (!TokenPriceSeriesService.instance) {
      TokenPriceSeriesService.instance = new TokenPriceSeriesService();
    }
    return TokenPriceSeriesService.instance;
  }

  static resetInstance(): void {
    TokenPriceSeriesService.instance = null;
  }

  /**
   * Get the daily USD price series for a token, with caching.
   *
   * @param coingeckoId - CoinGecko coin ID, e.g. `'ethereum'`, `'usd-coin'`.
   * @returns A `DailyPriceSeries` with status. `closes` present iff `'ok'`.
   */
  async getDailySeries(coingeckoId: string): Promise<DailyPriceSeries> {
    log.methodEntry(this.logger, 'getDailySeries', { coingeckoId });

    const cacheKey = `volatility:series:${coingeckoId}:${CACHE_KEY_VERSION}`;

    const cached = await this.cacheService.get<DailyPriceSeries>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getDailySeries', cacheKey);
      log.methodExit(this.logger, 'getDailySeries', {
        coingeckoId,
        status: cached.status,
        observations: cached.closes?.length ?? 0,
        fromCache: true,
      });
      return cached;
    }
    log.cacheMiss(this.logger, 'getDailySeries', cacheKey);

    const series = await this.fetchAndBucket(coingeckoId);
    const ttl = this.ttlFor(series.status);
    await this.cacheService.set(cacheKey, series, ttl);

    log.methodExit(this.logger, 'getDailySeries', {
      coingeckoId,
      status: series.status,
      observations: series.closes?.length ?? 0,
      fromCache: false,
      ttlSeconds: ttl,
    });

    return series;
  }

  // -------------------- internals --------------------

  private async fetchAndBucket(coingeckoId: string): Promise<DailyPriceSeries> {
    const fetchedAt = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    const fromSec = nowSec - FETCH_WINDOW_DAYS * SECONDS_PER_DAY;

    try {
      const raw = await this.coinGeckoClient.getMarketChartRange(
        coingeckoId,
        fromSec,
        nowSec,
      );
      const closes = bucketByIsoDate(raw.prices);
      this.logger.debug(
        { coingeckoId, rawPoints: raw.prices.length, dailyPoints: closes.length },
        'TokenPriceSeriesService bucketed daily series',
      );
      return {
        ref: `coingecko/${coingeckoId}`,
        pivotCurrency: 'usd',
        status: 'ok',
        closes,
        fetchedAt,
      };
    } catch (error) {
      this.logger.warn(
        {
          coingeckoId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'TokenPriceSeriesService fetch failed',
      );
      return {
        ref: `coingecko/${coingeckoId}`,
        pivotCurrency: 'usd',
        status: 'fetch_failed',
        fetchedAt,
      };
    }
  }

  private ttlFor(status: DailyPriceSeries['status']): number {
    switch (status) {
      case 'ok':
        return TTL_OK_SECONDS;
      case 'fetch_failed':
        return TTL_FETCH_FAILED_SECONDS;
      case 'token_not_listed':
        return TTL_NOT_LISTED_SECONDS;
      case 'insufficient_history':
        // Series itself shouldn't carry this status — that classification
        // happens at the σ-computation layer. Fall back to OK TTL.
        return TTL_OK_SECONDS;
    }
  }
}
