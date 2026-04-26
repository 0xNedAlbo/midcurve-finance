/**
 * VolatilityService
 *
 * Per-token σ vs USD across the 60d and 365d windows. Reusable beyond pool
 * selection (asset-risk dashboards, peg monitors, alerts).
 *
 * Token-oriented — keyed on a CoinGecko ID, has no concept of pools.
 */

import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { TokenPriceSeriesService } from './token-price-series-service.js';
import type { DailyPriceSeries, SigmaResult, TokenVolatility } from './types.js';
import { sigmaForWindow } from './volatility-math.js';

const WINDOW_60D = 60;
const WINDOW_365D = 365;

export interface VolatilityServiceDependencies {
  tokenPriceSeriesService?: TokenPriceSeriesService;
}

export class VolatilityService {
  private static instance: VolatilityService | null = null;

  private readonly tokenPriceSeriesService: TokenPriceSeriesService;
  private readonly logger: ServiceLogger;

  constructor(deps: VolatilityServiceDependencies = {}) {
    this.tokenPriceSeriesService =
      deps.tokenPriceSeriesService ?? TokenPriceSeriesService.getInstance();
    this.logger = createServiceLogger('VolatilityService');
  }

  static getInstance(): VolatilityService {
    if (!VolatilityService.instance) {
      VolatilityService.instance = new VolatilityService();
    }
    return VolatilityService.instance;
  }

  static resetInstance(): void {
    VolatilityService.instance = null;
  }

  /**
   * Get σ vs USD for a single token, both 60d and 365d windows.
   *
   * Status precedence (PRD §3.3): if the underlying daily series is non-ok,
   * the per-window results inherit that status. If the series is ok but
   * doesn't have enough returns for a window, that window reports
   * `insufficient_history`.
   *
   * @param coingeckoId - CoinGecko coin ID.
   * @param ref - tokenHash for the response (e.g. `erc20/8453/0x...`); defaults
   *              to `coingecko/{coingeckoId}` if not provided.
   */
  async getTokenVolatility(
    coingeckoId: string,
    ref?: string,
  ): Promise<TokenVolatility> {
    log.methodEntry(this.logger, 'getTokenVolatility', { coingeckoId });

    const series = await this.tokenPriceSeriesService.getDailySeries(coingeckoId);
    const result = this.computeFromSeries(series, ref);

    log.methodExit(this.logger, 'getTokenVolatility', {
      coingeckoId,
      status: result.status,
      sigma60dStatus: result.sigma60d.status,
      sigma365dStatus: result.sigma365d.status,
    });

    return result;
  }

  /**
   * Pure computation step — exposed for testing.
   */
  computeFromSeries(
    series: DailyPriceSeries,
    refOverride?: string,
  ): TokenVolatility {
    const ref = refOverride ?? series.ref;

    if (series.status !== 'ok' || !series.closes) {
      const sigmaResult: SigmaResult = { status: series.status };
      return {
        ref,
        status: series.status,
        sigma60d: sigmaResult,
        sigma365d: sigmaResult,
      };
    }

    const sigma60d = sigmaForWindow(series.closes, WINDOW_60D);
    const sigma365d = sigmaForWindow(series.closes, WINDOW_365D);

    // Token-level status reflects the *better* (lower-rank) of the two
    // windows — if at least one window is ok, the token series itself is ok.
    // Per-window granularity is preserved in `sigma60d` / `sigma365d`.
    const tokenStatus =
      sigma60d.status === 'ok' || sigma365d.status === 'ok' ? 'ok' : sigma60d.status;

    return {
      ref,
      status: tokenStatus,
      sigma60d,
      sigma365d,
    };
  }
}
