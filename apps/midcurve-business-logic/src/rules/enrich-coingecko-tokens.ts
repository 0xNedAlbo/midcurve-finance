/**
 * EnrichCoingeckoTokensRule
 *
 * A scheduled business rule that enriches CoinGecko tokens with market data
 * (imageUrl, marketCapUsd) from the /coins/markets API endpoint.
 *
 * Features:
 * - Runs every 5 minutes (cron expression: 0/5 * * * *)
 * - Finds tokens where enrichedAt is null OR older than 24 hours
 * - Limits to 100 tokens per run to stay within rate limits
 * - Updates imageUrl, marketCapUsd, and enrichedAt fields
 *
 * This rule ensures token logo URLs and market caps are kept up-to-date.
 */

import { prisma } from '@midcurve/database';
import { CoingeckoTokenService } from '@midcurve/services';
import { BusinessRule } from './base';
import { ruleLog } from '../lib/logger';

/**
 * EnrichCoingeckoTokensRule
 *
 * Scheduled rule to enrich CoinGecko tokens with market data every 5 minutes.
 */
export class EnrichCoingeckoTokensRule extends BusinessRule {
  readonly ruleName = 'enrich-coingecko-tokens';
  readonly ruleDescription =
    'Enriches CoinGecko tokens with market data (imageUrl, marketCapUsd) every 5 minutes';

  private readonly coingeckoTokenService: CoingeckoTokenService;

  constructor() {
    super();
    this.coingeckoTokenService = new CoingeckoTokenService({ prisma });
  }

  /**
   * Register the cron schedule on startup.
   *
   * Schedule: every 5 minutes (UTC)
   */
  protected async onStartup(): Promise<void> {
    this.registerSchedule(
      '*/5 * * * *',
      'Enrich CoinGecko tokens with market data',
      () => this.executeEnrichment(),
      { timezone: 'UTC', runOnStart: false }
    );

    this.logger.info(
      { schedule: '*/5 * * * * (UTC)' },
      'Registered CoinGecko token enrichment schedule'
    );
  }

  /**
   * No cleanup needed - schedules are automatically unregistered by base class.
   */
  protected async onShutdown(): Promise<void> {
    // Schedules are automatically cleaned up by the base class
  }

  /**
   * Execute the token enrichment.
   *
   * Calls refreshTokenDetails(100) to process up to 100 tokens per run.
   */
  private async executeEnrichment(): Promise<void> {
    ruleLog.eventProcessing(
      this.logger,
      this.ruleName,
      'scheduled-enrichment',
      'coingecko-tokens'
    );

    const startTime = Date.now();

    try {
      this.logger.info(
        { ruleName: this.ruleName },
        'Starting CoinGecko token enrichment'
      );

      const updatedCount =
        await this.coingeckoTokenService.refreshTokenDetails(100);

      const durationMs = Date.now() - startTime;

      this.logger.info(
        {
          ruleName: this.ruleName,
          updated: updatedCount,
          durationMs,
        },
        'CoinGecko token enrichment completed'
      );

      ruleLog.eventProcessed(
        this.logger,
        this.ruleName,
        'scheduled-enrichment',
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
        'CoinGecko token enrichment failed'
      );

      // Re-throw to let scheduler handle error tracking
      throw error;
    }
  }
}
