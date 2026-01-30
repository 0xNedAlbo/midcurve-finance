/**
 * RefreshCoingeckoTokensRule
 *
 * A scheduled business rule that refreshes the entire CoinGecko token list
 * and persists it to the database. Runs daily at 3:17 AM.
 *
 * Features:
 * - Runs on a cron schedule (17 3 * * *)
 * - Tracks last run time using the distributed cache
 * - Only refreshes if last run is older than 24 hours
 * - Uses CoingeckoTokenService.refresh() for fetch + persist
 *
 * This rule ensures the CoingeckoToken lookup table stays up-to-date
 * with the latest token mappings from CoinGecko.
 */

import { prisma } from '@midcurve/database';
import {
  CacheService,
  CoingeckoTokenService,
} from '@midcurve/services';
import { BusinessRule } from './base';
import { ruleLog } from '../lib/logger';

// Cache key for tracking last successful run
const CACHE_KEY = 'rule:refresh-coingecko-tokens:last-run';

// 24 hours in milliseconds
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Cache TTL: 25 hours (buffer to ensure value persists until next check)
const CACHE_TTL_SECONDS = 25 * 60 * 60;

/**
 * RefreshCoingeckoTokensRule
 *
 * Scheduled rule to refresh the CoinGecko token list daily.
 */
export class RefreshCoingeckoTokensRule extends BusinessRule {
  readonly ruleName = 'refresh-coingecko-tokens';
  readonly ruleDescription =
    'Refreshes the CoinGecko token list daily at 3:17 AM and persists to database';

  private readonly coingeckoTokenService: CoingeckoTokenService;
  private readonly cacheService: CacheService;

  constructor() {
    super();
    this.coingeckoTokenService = new CoingeckoTokenService({ prisma });
    this.cacheService = CacheService.getInstance();
  }

  /**
   * Register the cron schedule on startup.
   *
   * Schedule: 17 3 * * * (3:17 AM every day, UTC)
   */
  protected async onStartup(): Promise<void> {
    // Register cron schedule: minute 17, hour 3, every day
    // runOnStart: true ensures the table is populated on first startup
    this.registerSchedule(
      '17 3 * * *',
      'Refresh CoinGecko token list',
      () => this.executeRefresh(),
      { timezone: 'UTC', runOnStart: true }
    );

    this.logger.info(
      { schedule: '17 3 * * * (UTC)' },
      'Registered CoinGecko token refresh schedule'
    );
  }

  /**
   * No cleanup needed - schedules are automatically unregistered by base class.
   */
  protected async onShutdown(): Promise<void> {
    // Schedules are automatically cleaned up by the base class
  }

  /**
   * Execute the token list refresh.
   *
   * Checks if the last run was more than 24 hours ago before refreshing.
   * This provides idempotency in case the scheduler fires multiple times.
   */
  private async executeRefresh(): Promise<void> {
    ruleLog.eventProcessing(
      this.logger,
      this.ruleName,
      'scheduled-refresh',
      'coingecko-tokens'
    );

    const startTime = Date.now();

    try {
      // Check last run time
      const shouldRefresh = await this.shouldRefresh();

      if (!shouldRefresh) {
        this.logger.info(
          { ruleName: this.ruleName },
          'Skipping refresh - last run was less than 24 hours ago'
        );
        return;
      }

      // Execute the refresh
      this.logger.info(
        { ruleName: this.ruleName },
        'Starting CoinGecko token list refresh'
      );

      const result = await this.coingeckoTokenService.refresh();

      // Store successful run timestamp
      await this.cacheService.set(
        CACHE_KEY,
        { timestamp: Date.now() },
        CACHE_TTL_SECONDS
      );

      const durationMs = Date.now() - startTime;

      this.logger.info(
        {
          ruleName: this.ruleName,
          added: result.added,
          total: result.total,
          durationMs,
        },
        'CoinGecko token list refresh completed'
      );

      ruleLog.eventProcessed(
        this.logger,
        this.ruleName,
        'scheduled-refresh',
        'coingecko-tokens',
        durationMs
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;

      this.logger.error(
        {
          ruleName: this.ruleName,
          error: error instanceof Error ? error.message : String(error),
          durationMs,
        },
        'CoinGecko token list refresh failed'
      );

      // Re-throw to let scheduler handle error tracking
      throw error;
    }
  }

  /**
   * Check if a refresh should be performed.
   *
   * Returns true if:
   * - No last run recorded (first run)
   * - Last run was more than 24 hours ago
   */
  private async shouldRefresh(): Promise<boolean> {
    const cached = await this.cacheService.get<{ timestamp: number }>(CACHE_KEY);

    if (!cached || !cached.timestamp) {
      this.logger.debug(
        { ruleName: this.ruleName },
        'No previous run recorded - will refresh'
      );
      return true;
    }

    const elapsed = Date.now() - cached.timestamp;
    const shouldRefresh = elapsed >= REFRESH_INTERVAL_MS;

    this.logger.debug(
      {
        ruleName: this.ruleName,
        lastRun: new Date(cached.timestamp).toISOString(),
        elapsedHours: (elapsed / (60 * 60 * 1000)).toFixed(2),
        shouldRefresh,
      },
      'Checked last run time'
    );

    return shouldRefresh;
  }
}
