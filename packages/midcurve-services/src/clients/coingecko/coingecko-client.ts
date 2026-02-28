/**
 * CoinGecko API Client
 *
 * Provides access to CoinGecko token metadata including logos, market caps,
 * and token identification across multiple chains.
 *
 * Features:
 * - Token list caching (1-hour TTL)
 * - Multi-chain support (Ethereum, Arbitrum, Base, BSC, Polygon, Optimism)
 * - Market cap and logo URL fetching
 * - Address-based token lookup
 */

import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { CacheService } from '../../services/cache/index.js';
import { RequestScheduler } from '../../utils/request-scheduler/index.js';
import { getAddress, isAddress } from 'viem';

/**
 * CoinGecko token representation from the coins list API
 */
export interface CoinGeckoToken {
  /** CoinGecko coin ID (e.g., 'usd-coin') */
  id: string;
  /** Token symbol (e.g., 'USDC') */
  symbol: string;
  /** Token name (e.g., 'USD Coin') */
  name: string;
  /** Platform addresses keyed by CoinGecko platform ID */
  platforms: Record<string, string>;
}

/**
 * Detailed coin information from the coins/{id} API
 */
export interface CoinGeckoDetailedCoin {
  /** CoinGecko coin ID */
  id: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Logo URLs in various sizes */
  image: {
    thumb: string;
    small: string;
    large: string;
  };
  /** Market data including market cap */
  market_data: {
    market_cap: {
      usd: number;
    };
  };
  /** Platform addresses */
  platforms: Record<string, string>;
}

/**
 * Market data from the /coins/markets endpoint (batch operation)
 */
export interface CoinGeckoMarketData {
  /** CoinGecko coin ID */
  id: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Logo URL */
  image: string;
  /** Market cap in USD */
  market_cap: number;
}

/**
 * Response from /simple/price endpoint
 */
export interface CoinGeckoSimplePrices {
  [coinId: string]: {
    usd: number;
    usd_24h_change?: number;
  };
}

/**
 * Response from /coins/{id}/market_chart/range endpoint
 */
export interface CoinGeckoMarketChartData {
  /** Array of [timestamp_ms, price_usd] */
  prices: [number, number][];
  /** Array of [timestamp_ms, market_cap_usd] */
  market_caps: [number, number][];
  /** Array of [timestamp_ms, volume_usd] */
  total_volumes: [number, number][];
}

/**
 * Find the closest price point to a target timestamp from a market chart dataset.
 *
 * Performs binary search on the sorted prices array to find the entry with
 * minimum absolute time distance from the target.
 *
 * @param prices - Sorted array of [timestamp_ms, price_usd] from market chart
 * @param targetTimestampMs - Target timestamp in milliseconds
 * @returns USD price at the nearest data point
 */
export function findClosestPrice(
  prices: [number, number][],
  targetTimestampMs: number,
): number {
  if (prices.length === 0) return 0;
  if (prices.length === 1) return prices[0]![1];

  let lo = 0;
  let hi = prices.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid]![0] < targetTimestampMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is the first index >= target. Compare with lo-1 if it exists.
  if (lo === 0) return prices[0]![1];
  const before = prices[lo - 1]!;
  const after = prices[lo]!;
  const diffBefore = targetTimestampMs - before[0];
  const diffAfter = after[0] - targetTimestampMs;
  return diffBefore <= diffAfter ? before[1] : after[1];
}

/**
 * Response from /coins/{id}/history endpoint
 */
export interface CoinGeckoHistoricalData {
  /** CoinGecko coin ID */
  id: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Market data at the historical date */
  market_data?: {
    current_price?: { usd?: number };
    market_cap?: { usd?: number };
    total_volume?: { usd?: number };
  };
}

/**
 * Enrichment data extracted from CoinGecko
 */
export interface EnrichmentData {
  /** CoinGecko coin ID */
  coingeckoId: string;
  /** Logo URL (small size, ~32x32) */
  logoUrl: string;
  /** Market cap in USD */
  marketCap: number;
  /** Token symbol from CoinGecko */
  symbol: string;
  /** Token name from CoinGecko */
  name: string;
}

/**
 * Error thrown when token is not found in CoinGecko
 */
export class TokenNotFoundInCoinGeckoError extends Error {
  constructor(chainId: number, address: string) {
    super(
      `Token not found in CoinGecko for chain ${chainId} and address ${address}`
    );
    this.name = 'TokenNotFoundInCoinGeckoError';
  }
}

/**
 * Error thrown when CoinGecko API request fails
 */
export class CoinGeckoApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'CoinGeckoApiError';
  }
}

export interface CoinGeckoClientDependencies {
  /**
   * Cache service for distributed caching
   * If not provided, the singleton CacheService instance will be used
   */
  cacheService?: CacheService;

  /**
   * Request scheduler for rate limiting
   * If not provided, a new RequestScheduler will be created with spacing
   * based on the API tier (250ms for Pro, 2200ms for free).
   */
  requestScheduler?: RequestScheduler;

  /**
   * CoinGecko API key for Pro API access.
   * If not provided, reads from COINGECKO_API_KEY env var.
   * When set, uses pro-api.coingecko.com with higher rate limits.
   */
  apiKey?: string;
}

/**
 * CoinGecko API Client
 *
 * Manages API requests to CoinGecko with distributed caching and error handling.
 * Uses PostgreSQL-based caching to share cache across multiple processes, workers, and serverless functions.
 * Uses singleton pattern for convenient default access.
 */
export class CoinGeckoClient {
  private static instance: CoinGeckoClient | null = null;

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly cacheService: CacheService;
  private readonly requestScheduler: RequestScheduler;
  private readonly cacheTimeout = 3600; // 1 hour in seconds

  private readonly logger: ServiceLogger;

  /**
   * Map chain IDs to CoinGecko platform IDs
   * See: https://api.coingecko.com/api/v3/asset_platforms
   */
  private readonly chainIdToPlatformId: Record<number, string> = {
    1: 'ethereum', // Ethereum
    42161: 'arbitrum-one', // Arbitrum One
    8453: 'base', // Base
    56: 'binance-smart-chain', // BNB Smart Chain
    137: 'polygon-pos', // Polygon
    10: 'optimistic-ethereum', // Optimism
  };

  constructor(dependencies: CoinGeckoClientDependencies = {}) {
    this.logger = createServiceLogger('CoinGeckoClient');
    this.cacheService = dependencies.cacheService ?? CacheService.getInstance();

    // Determine API tier from key
    this.apiKey = dependencies.apiKey ?? process.env.COINGECKO_API_KEY ?? undefined;
    // Empty string means no key configured
    if (this.apiKey === '') this.apiKey = undefined;

    this.baseUrl = this.apiKey
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';

    this.requestScheduler =
      dependencies.requestScheduler ??
      new RequestScheduler({
        // Basic plan: 250 rpm → 250ms spacing. Free: ~27 rpm → 2200ms spacing.
        minSpacingMs: this.apiKey ? 250 : 2200,
        name: 'CoinGeckoScheduler',
      });

    this.logger.info(
      { apiTier: this.apiKey ? 'pro' : 'free', baseUrl: this.baseUrl },
      'CoinGeckoClient initialized'
    );
  }

  /**
   * Get singleton instance of CoinGeckoClient
   */
  static getInstance(): CoinGeckoClient {
    if (!CoinGeckoClient.instance) {
      CoinGeckoClient.instance = new CoinGeckoClient();
    }
    return CoinGeckoClient.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  static resetInstance(): void {
    CoinGeckoClient.instance = null;
  }

  /**
   * Scheduled fetch wrapper that combines rate limiting and retry logic
   *
   * All CoinGecko API calls go through this method to ensure:
   * - Minimum 2200ms spacing between requests (~27 rpm)
   * - Automatic retry with exponential backoff for transient errors (429, 5xx)
   * - Respect for Retry-After headers
   *
   * @param url - Full URL to fetch
   * @returns Promise<Response> from fetch
   * @throws Error if all retry attempts fail
   */
  private async scheduledFetch(url: string): Promise<Response> {
    return this.requestScheduler.schedule(async () => {
      // Manual retry logic with exponential backoff
      const maxRetries = 6;
      const baseDelayMs = 800;
      const maxDelayMs = 8000;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const fetchOptions: RequestInit = {};
          if (this.apiKey) {
            fetchOptions.headers = { 'x-cg-pro-api-key': this.apiKey };
          }
          const response = await fetch(url, fetchOptions);

          // Success - return response
          if (response.ok) {
            return response;
          }

          // Check if error is retryable
          const isRetryable =
            response.status === 429 || (response.status >= 500 && response.status < 600);

          if (!isRetryable || attempt >= maxRetries) {
            // Non-retryable or out of retries - return response for caller to handle
            return response;
          }

          // Calculate delay with Retry-After header support
          const retryAfterHeader = response.headers.get('Retry-After');
          let delay: number;

          if (retryAfterHeader) {
            const retryAfterSeconds = Number(retryAfterHeader);
            if (!isNaN(retryAfterSeconds)) {
              delay = Math.min(maxDelayMs, Math.max(baseDelayMs, retryAfterSeconds * 1000));
            } else {
              const retryAfterDate = new Date(retryAfterHeader);
              delay = Math.min(
                maxDelayMs,
                Math.max(baseDelayMs, retryAfterDate.getTime() - Date.now())
              );
            }
          } else {
            // Exponential backoff
            delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
          }

          // Add jitter
          delay += Math.floor(Math.random() * 200);

          this.logger.warn(
            {
              attempt: attempt + 1,
              maxRetries,
              status: response.status,
              delay,
              hasRetryAfter: !!retryAfterHeader,
            },
            'Retryable error, backing off'
          );

          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, delay));
        } catch (error) {
          // Network error
          if (attempt >= maxRetries) {
            throw error;
          }

          const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
          const jitter = Math.floor(Math.random() * 200);

          this.logger.warn(
            { attempt: attempt + 1, delay: delay + jitter, error },
            'Network error, retrying with backoff'
          );

          await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        }
      }

      // Should never reach here
      throw new Error('Unexpected end of retry loop');
    });
  }

  /**
   * Get all tokens from CoinGecko with distributed caching
   *
   * Fetches the complete token list from CoinGecko and filters to only
   * include tokens available on supported chains. Results are cached
   * in PostgreSQL for 1 hour to minimize API calls and share cache across
   * all application instances, workers, and serverless functions.
   *
   * @returns Array of CoinGecko tokens on supported chains
   * @throws CoinGeckoApiError if API request fails
   */
  async getAllTokens(): Promise<CoinGeckoToken[]> {
    log.methodEntry(this.logger, 'getAllTokens');

    const cacheKey = 'coingecko:tokens:all';

    // Check distributed cache first
    const cached = await this.cacheService.get<CoinGeckoToken[]>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getAllTokens', cacheKey);
      log.methodExit(this.logger, 'getAllTokens', {
        count: cached.length,
        fromCache: true,
      });
      return cached;
    }

    log.cacheMiss(this.logger, 'getAllTokens', cacheKey);

    try {
      log.externalApiCall(
        this.logger,
        'CoinGecko',
        '/coins/list',
        { include_platform: true }
      );

      const response = await this.scheduledFetch(
        `${this.baseUrl}/coins/list?include_platform=true`
      );

      if (!response.ok) {
        const error = new CoinGeckoApiError(
          `CoinGecko API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'getAllTokens', error, {
          statusCode: response.status,
        });
        throw error;
      }

      const allTokens = (await response.json()) as CoinGeckoToken[];
      this.logger.debug(
        { totalTokens: allTokens.length },
        'Received tokens from CoinGecko API'
      );

      // Filter to only include tokens on supported chains
      const supportedPlatformIds = Object.values(this.chainIdToPlatformId);
      const filteredTokens = allTokens.filter((token) => {
        return supportedPlatformIds.some(
          (platformId) =>
            token.platforms[platformId] &&
            token.platforms[platformId].trim() !== ''
        );
      });

      this.logger.info(
        {
          totalTokens: allTokens.length,
          filteredTokens: filteredTokens.length,
        },
        'Filtered tokens for supported chains'
      );

      // Store in distributed cache
      await this.cacheService.set(cacheKey, filteredTokens, this.cacheTimeout);

      log.methodExit(this.logger, 'getAllTokens', {
        count: filteredTokens.length,
        fromCache: false,
      });
      return filteredTokens;
    } catch (error) {
      // Re-throw CoinGeckoApiError
      if (error instanceof CoinGeckoApiError) {
        throw error;
      }

      // Wrap other errors
      const wrappedError = new CoinGeckoApiError(
        `Failed to fetch tokens from CoinGecko: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      log.methodError(this.logger, 'getAllTokens', wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Find CoinGecko coin ID by contract address and chain ID
   *
   * @param chainId - Chain ID (e.g., 1 for Ethereum)
   * @param address - Token contract address (case-insensitive)
   * @returns CoinGecko coin ID or null if not found
   * @throws CoinGeckoApiError if API request fails
   */
  async findCoinByAddress(
    chainId: number,
    address: string
  ): Promise<string | null> {
    log.methodEntry(this.logger, 'findCoinByAddress', {
      chainId,
      address,
    });

    const tokens = await this.getAllTokens();
    const platformId = this.chainIdToPlatformId[chainId];

    if (!platformId) {
      this.logger.debug({ chainId }, 'Chain not supported');
      log.methodExit(this.logger, 'findCoinByAddress', {
        found: false,
      });
      return null;
    }

    const normalizedAddress = address.toLowerCase();
    const token = tokens.find(
      (token) =>
        token.platforms[platformId] &&
        token.platforms[platformId].toLowerCase() === normalizedAddress
    );

    if (token) {
      this.logger.debug(
        { chainId, address, coinId: token.id },
        'Token found in CoinGecko'
      );
    } else {
      this.logger.debug({ chainId, address }, 'Token not found in CoinGecko');
    }

    log.methodExit(this.logger, 'findCoinByAddress', {
      coinId: token?.id || null,
    });
    return token ? token.id : null;
  }

  /**
   * Get detailed coin information including market cap and logo with distributed caching
   *
   * @param coinId - CoinGecko coin ID
   * @returns Detailed coin information
   * @throws CoinGeckoApiError if API request fails or coin not found
   */
  async getCoinDetails(coinId: string): Promise<CoinGeckoDetailedCoin> {
    log.methodEntry(this.logger, 'getCoinDetails', { coinId });

    const cacheKey = `coingecko:coin:${coinId}`;

    // Check distributed cache first
    const cached = await this.cacheService.get<CoinGeckoDetailedCoin>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getCoinDetails', cacheKey);
      log.methodExit(this.logger, 'getCoinDetails', {
        coinId: cached.id,
        fromCache: true,
      });
      return cached;
    }

    log.cacheMiss(this.logger, 'getCoinDetails', cacheKey);

    try {
      log.externalApiCall(this.logger, 'CoinGecko', `/coins/${coinId}`, {
        market_data: true,
      });

      const response = await this.scheduledFetch(
        `${this.baseUrl}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`
      );

      if (!response.ok) {
        const error = new CoinGeckoApiError(
          `CoinGecko API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'getCoinDetails', error, {
          coinId,
          statusCode: response.status,
        });
        throw error;
      }

      const coin = (await response.json()) as CoinGeckoDetailedCoin;
      this.logger.debug(
        { coinId, symbol: coin.symbol, name: coin.name },
        'Retrieved coin details'
      );

      // Store in distributed cache
      await this.cacheService.set(cacheKey, coin, this.cacheTimeout);

      log.methodExit(this.logger, 'getCoinDetails', {
        coinId: coin.id,
        fromCache: false,
      });
      return coin;
    } catch (error) {
      // Re-throw CoinGeckoApiError
      if (error instanceof CoinGeckoApiError) {
        throw error;
      }

      // Wrap other errors
      const wrappedError = new CoinGeckoApiError(
        `Failed to fetch coin details for ${coinId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      log.methodError(this.logger, 'getCoinDetails', wrappedError, {
        coinId,
      });
      throw wrappedError;
    }
  }

  /**
   * Get market data for multiple coins in a single batch request
   *
   * This method uses the /coins/markets endpoint which is much more efficient
   * than making individual /coins/{id} requests for each token.
   *
   * Use this for cache warming or when you need data for multiple tokens.
   *
   * @param coinIds - Array of CoinGecko coin IDs (e.g., ['bitcoin', 'ethereum', 'usd-coin'])
   * @returns Array of market data for the requested coins
   * @throws CoinGeckoApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = CoinGeckoClient.getInstance();
   * const marketData = await client.getCoinsMarketData(['usd-coin', 'weth', 'dai']);
   * // Returns array with logo URLs and market caps for all three tokens
   * ```
   */
  async getCoinsMarketData(coinIds: string[]): Promise<CoinGeckoMarketData[]> {
    log.methodEntry(this.logger, 'getCoinsMarketData', { coinIds, count: coinIds.length });

    if (coinIds.length === 0) {
      log.methodExit(this.logger, 'getCoinsMarketData', { count: 0 });
      return [];
    }

    // Build cache key from sorted coin IDs for consistency
    const sortedIds = [...coinIds].sort();
    const cacheKey = `coingecko:markets:${sortedIds.join(',')}`;

    // Check distributed cache first
    const cached = await this.cacheService.get<CoinGeckoMarketData[]>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getCoinsMarketData', cacheKey);
      log.methodExit(this.logger, 'getCoinsMarketData', {
        count: cached.length,
        fromCache: true,
      });
      return cached;
    }

    log.cacheMiss(this.logger, 'getCoinsMarketData', cacheKey);

    try {
      // Join coin IDs with commas (CoinGecko accepts up to ~250 IDs)
      const idsParam = coinIds.join(',');

      log.externalApiCall(this.logger, 'CoinGecko', '/coins/markets', {
        ids: idsParam,
        vs_currency: 'usd',
      });

      // Build URL with all required parameters for token enrichment
      const url = new URL(`${this.baseUrl}/coins/markets`);
      url.searchParams.set('vs_currency', 'usd');
      url.searchParams.set('ids', idsParam);
      url.searchParams.set('sparkline', 'false');
      url.searchParams.set('locale', 'en');
      url.searchParams.set('precision', '2');
      url.searchParams.set('per_page', '250');

      const response = await this.scheduledFetch(url.toString());

      if (!response.ok) {
        const error = new CoinGeckoApiError(
          `CoinGecko API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'getCoinsMarketData', error, {
          coinIds,
          statusCode: response.status,
        });
        throw error;
      }

      const marketData = (await response.json()) as CoinGeckoMarketData[];
      this.logger.debug(
        { requestedCount: coinIds.length, receivedCount: marketData.length },
        'Retrieved market data from CoinGecko API'
      );

      // Store in distributed cache
      await this.cacheService.set(cacheKey, marketData, this.cacheTimeout);

      log.methodExit(this.logger, 'getCoinsMarketData', {
        count: marketData.length,
        fromCache: false,
      });
      return marketData;
    } catch (error) {
      // Re-throw CoinGeckoApiError
      if (error instanceof CoinGeckoApiError) {
        throw error;
      }

      // Wrap other errors
      const wrappedError = new CoinGeckoApiError(
        `Failed to fetch market data for coins: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      log.methodError(this.logger, 'getCoinsMarketData', wrappedError, { coinIds });
      throw wrappedError;
    }
  }

  /**
   * Get enrichment data for an ERC-20 token by address and chain ID
   *
   * This is the primary method for enriching ERC-20 tokens. It finds the token
   * in CoinGecko's database, fetches detailed information, and returns
   * structured enrichment data.
   *
   * @param chainId - EVM chain ID where the token exists
   * @param address - ERC-20 token contract address (case-insensitive)
   * @returns Enrichment data (coingeckoId, logoUrl, marketCap, symbol, name)
   * @throws TokenNotFoundInCoinGeckoError if token not found
   * @throws CoinGeckoApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = CoinGeckoClient.getInstance();
   * const data = await client.getErc20EnrichmentData(
   *   1,
   *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
   * );
   * // { coingeckoId: 'usd-coin', logoUrl: '...', marketCap: 28000000000, ... }
   * ```
   */
  async getErc20EnrichmentData(
    chainId: number,
    address: string
  ): Promise<EnrichmentData> {
    log.methodEntry(this.logger, 'getErc20EnrichmentData', {
      chainId,
      address,
    });

    try {
      // Find coin ID by address
      const coinId = await this.findCoinByAddress(chainId, address);

      if (!coinId) {
        const error = new TokenNotFoundInCoinGeckoError(chainId, address);
        log.methodError(
          this.logger,
          'getErc20EnrichmentData',
          error,
          { chainId, address }
        );
        throw error;
      }

      this.logger.info(
        { chainId, address, coinId },
        'Found token in CoinGecko, fetching enrichment data'
      );

      // Fetch detailed coin information
      const coinDetails = await this.getCoinDetails(coinId);

      // Validate market cap data
      const marketCapUsd = coinDetails.market_data?.market_cap?.usd;
      if (!marketCapUsd || marketCapUsd <= 0) {
        const error = new CoinGeckoApiError(
          `Market cap data not available for ${coinId}`
        );
        log.methodError(
          this.logger,
          'getErc20EnrichmentData',
          error,
          { coinId, chainId, address }
        );
        throw error;
      }

      const enrichmentData = {
        coingeckoId: coinId,
        logoUrl: coinDetails.image.small,
        marketCap: marketCapUsd,
        symbol: coinDetails.symbol.toUpperCase(),
        name: coinDetails.name,
      };

      this.logger.info(
        {
          chainId,
          address,
          coingeckoId: enrichmentData.coingeckoId,
          symbol: enrichmentData.symbol,
          marketCap: enrichmentData.marketCap,
        },
        'Successfully enriched token data'
      );

      log.methodExit(this.logger, 'getErc20EnrichmentData', {
        coingeckoId: enrichmentData.coingeckoId,
      });

      return enrichmentData;
    } catch (error) {
      // Errors are already logged by log.methodError in the try block
      // or by the called methods. Just re-throw.
      throw error;
    }
  }

  // ============================================================================
  // PRICE DISCOVERY METHODS
  // ============================================================================

  /**
   * Short cache timeout for current prices (60 seconds)
   * Current prices are volatile and change frequently
   */
  private readonly priceCacheTimeout = 60;

  /**
   * Long cache timeout for historical prices (30 days)
   * Historical data is immutable - once recorded, it doesn't change
   */
  private readonly historicalCacheTimeout = 30 * 24 * 3600;

  /**
   * Long cache timeout for supported vs_currencies (24 hours)
   * This list changes rarely (new currencies added occasionally)
   */
  private readonly vsCurrenciesCacheTimeout = 24 * 3600;

  /**
   * List of stablecoin CoinGecko IDs
   * Used to optimize price lookups (assume 1:1 with USD)
   */
  private readonly stablecoinIds = [
    'tether',
    'usd-coin',
    'dai',
    'binance-usd',
    'true-usd',
    'frax',
    'usdd',
    'pax-dollar',
    'gemini-dollar',
  ];

  /**
   * Get current prices for multiple tokens in USD
   *
   * Uses the /simple/price endpoint which is efficient for batch price lookups.
   * Results are cached for 60 seconds as prices are volatile.
   *
   * @param coinIds - Array of CoinGecko coin IDs (e.g., ['bitcoin', 'ethereum'])
   * @returns Object mapping coin IDs to their USD prices
   * @throws CoinGeckoApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = CoinGeckoClient.getInstance();
   * const prices = await client.getSimplePrices(['bitcoin', 'ethereum']);
   * // { bitcoin: { usd: 50000 }, ethereum: { usd: 3000 } }
   * ```
   */
  async getSimplePrices(coinIds: string[]): Promise<CoinGeckoSimplePrices> {
    log.methodEntry(this.logger, 'getSimplePrices', { coinIds, count: coinIds.length });

    if (coinIds.length === 0) {
      log.methodExit(this.logger, 'getSimplePrices', { count: 0 });
      return {};
    }

    // Cache key: sorted IDs for consistency
    const sortedIds = [...coinIds].sort();
    const cacheKey = `coingecko:prices:${sortedIds.join(',')}`;

    // Check distributed cache first
    const cached = await this.cacheService.get<CoinGeckoSimplePrices>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getSimplePrices', cacheKey);
      log.methodExit(this.logger, 'getSimplePrices', {
        count: Object.keys(cached).length,
        fromCache: true,
      });
      return cached;
    }

    log.cacheMiss(this.logger, 'getSimplePrices', cacheKey);

    try {
      const idsParam = coinIds.join(',');

      log.externalApiCall(this.logger, 'CoinGecko', '/simple/price', {
        ids: idsParam,
        vs_currencies: 'usd',
      });

      const response = await this.scheduledFetch(
        `${this.baseUrl}/simple/price?ids=${encodeURIComponent(idsParam)}&vs_currencies=usd&include_24hr_change=true`
      );

      if (!response.ok) {
        const error = new CoinGeckoApiError(
          `CoinGecko API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'getSimplePrices', error, {
          coinIds,
          statusCode: response.status,
        });
        throw error;
      }

      const prices = (await response.json()) as CoinGeckoSimplePrices;

      this.logger.debug(
        { requestedCount: coinIds.length, receivedCount: Object.keys(prices).length },
        'Retrieved prices from CoinGecko API'
      );

      // Store in distributed cache (short TTL for current prices)
      await this.cacheService.set(cacheKey, prices, this.priceCacheTimeout);

      log.methodExit(this.logger, 'getSimplePrices', {
        count: Object.keys(prices).length,
        fromCache: false,
      });

      return prices;
    } catch (error) {
      if (error instanceof CoinGeckoApiError) {
        throw error;
      }

      const wrappedError = new CoinGeckoApiError(
        `Failed to fetch prices from CoinGecko: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      log.methodError(this.logger, 'getSimplePrices', wrappedError, { coinIds });
      throw wrappedError;
    }
  }

  /**
   * Get historical price at a specific date (00:00 UTC)
   *
   * Uses the /coins/{id}/history endpoint which returns the price at 00:00 UTC
   * for the specified date. Results are cached for 30 days since historical
   * data is immutable.
   *
   * Note: Data is available ~35 minutes after midnight UTC for each day.
   *
   * @param coinId - CoinGecko coin ID (e.g., 'bitcoin')
   * @param date - Date to get price for (will use 00:00 UTC of that day)
   * @returns Object with USD price at that date
   * @throws CoinGeckoApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = CoinGeckoClient.getInstance();
   * const price = await client.getHistoricalPrice('bitcoin', new Date('2023-01-15'));
   * // { usd: 21000 }
   * ```
   */
  async getHistoricalPrice(coinId: string, date: Date): Promise<{ usd: number }> {
    // Format date as DD-MM-YYYY (CoinGecko's required format)
    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = date.getUTCFullYear();
    const dateStr = `${day}-${month}-${year}`;

    log.methodEntry(this.logger, 'getHistoricalPrice', { coinId, date: dateStr });

    // Cache key: includes coin and date
    const cacheKey = `coingecko:history:${coinId}:${dateStr}`;

    // Check distributed cache first
    const cached = await this.cacheService.get<{ usd: number }>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getHistoricalPrice', cacheKey);
      log.methodExit(this.logger, 'getHistoricalPrice', {
        coinId,
        date: dateStr,
        usd: cached.usd,
        fromCache: true,
      });
      return cached;
    }

    log.cacheMiss(this.logger, 'getHistoricalPrice', cacheKey);

    try {
      log.externalApiCall(this.logger, 'CoinGecko', `/coins/${coinId}/history`, {
        date: dateStr,
      });

      const response = await this.scheduledFetch(
        `${this.baseUrl}/coins/${coinId}/history?date=${dateStr}&localization=false`
      );

      if (!response.ok) {
        const error = new CoinGeckoApiError(
          `CoinGecko API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'getHistoricalPrice', error, {
          coinId,
          date: dateStr,
          statusCode: response.status,
        });
        throw error;
      }

      const data = (await response.json()) as CoinGeckoHistoricalData;

      // Extract price, default to 0 if not available
      const price = {
        usd: data.market_data?.current_price?.usd ?? 0,
      };

      if (price.usd === 0) {
        this.logger.warn(
          { coinId, date: dateStr },
          'Historical price data not available from CoinGecko'
        );
      } else {
        this.logger.debug(
          { coinId, date: dateStr, usd: price.usd },
          'Retrieved historical price from CoinGecko API'
        );
      }

      // Store in distributed cache (long TTL for historical data)
      await this.cacheService.set(cacheKey, price, this.historicalCacheTimeout);

      log.methodExit(this.logger, 'getHistoricalPrice', {
        coinId,
        date: dateStr,
        usd: price.usd,
        fromCache: false,
      });

      return price;
    } catch (error) {
      if (error instanceof CoinGeckoApiError) {
        throw error;
      }

      const wrappedError = new CoinGeckoApiError(
        `Failed to fetch historical price for ${coinId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      log.methodError(this.logger, 'getHistoricalPrice', wrappedError, {
        coinId,
        date: dateStr,
      });
      throw wrappedError;
    }
  }

  /**
   * Get historical price time series for a date range.
   *
   * Uses the /coins/{id}/market_chart/range endpoint which returns price data
   * at varying auto-granularity based on the range:
   *   - 1 day (past): hourly data
   *   - 2–90 days: hourly data
   *   - 90+ days: daily data (00:00 UTC)
   *
   * Results are cached for 30 days (immutable historical data).
   *
   * @param coinId - CoinGecko coin ID (e.g., 'ethereum')
   * @param fromTimestamp - Start of range in Unix seconds
   * @param toTimestamp - End of range in Unix seconds
   * @returns Market chart data with prices, market_caps, total_volumes arrays
   * @throws CoinGeckoApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = CoinGeckoClient.getInstance();
   * const chart = await client.getMarketChartRange('ethereum', 1700000000, 1702000000);
   * // chart.prices = [[1700000000000, 2050.5], [1700003600000, 2052.1], ...]
   * ```
   */
  async getMarketChartRange(
    coinId: string,
    fromTimestamp: number,
    toTimestamp: number,
  ): Promise<CoinGeckoMarketChartData> {
    log.methodEntry(this.logger, 'getMarketChartRange', { coinId, fromTimestamp, toTimestamp });

    const cacheKey = `coingecko:market-chart:${coinId}:${fromTimestamp}:${toTimestamp}`;

    // Check distributed cache first
    const cached = await this.cacheService.get<CoinGeckoMarketChartData>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getMarketChartRange', cacheKey);
      log.methodExit(this.logger, 'getMarketChartRange', {
        coinId,
        pricePoints: cached.prices.length,
        fromCache: true,
      });
      return cached;
    }

    log.cacheMiss(this.logger, 'getMarketChartRange', cacheKey);

    try {
      log.externalApiCall(this.logger, 'CoinGecko', `/coins/${coinId}/market_chart/range`, {
        fromTimestamp,
        toTimestamp,
      });

      const response = await this.scheduledFetch(
        `${this.baseUrl}/coins/${coinId}/market_chart/range?vs_currency=usd&from=${fromTimestamp}&to=${toTimestamp}`
      );

      if (!response.ok) {
        const error = new CoinGeckoApiError(
          `CoinGecko API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'getMarketChartRange', error, {
          coinId,
          fromTimestamp,
          toTimestamp,
          statusCode: response.status,
        });
        throw error;
      }

      const data = (await response.json()) as CoinGeckoMarketChartData;

      this.logger.debug(
        { coinId, pricePoints: data.prices.length, fromTimestamp, toTimestamp },
        'Retrieved market chart range from CoinGecko API'
      );

      // Store in distributed cache (long TTL for historical data)
      await this.cacheService.set(cacheKey, data, this.historicalCacheTimeout);

      log.methodExit(this.logger, 'getMarketChartRange', {
        coinId,
        pricePoints: data.prices.length,
        fromCache: false,
      });

      return data;
    } catch (error) {
      if (error instanceof CoinGeckoApiError) {
        throw error;
      }

      const wrappedError = new CoinGeckoApiError(
        `Failed to fetch market chart range for ${coinId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      log.methodError(this.logger, 'getMarketChartRange', wrappedError, {
        coinId,
        fromTimestamp,
        toTimestamp,
      });
      throw wrappedError;
    }
  }

  /**
   * Get token price in quote token units
   *
   * Calculates the cross-rate between two tokens using USD as the intermediary.
   * For stablecoins (USDC, USDT, DAI, etc.), assumes 1:1 with USD for efficiency.
   *
   * @param tokenCoinGeckoId - CoinGecko ID of the token to price
   * @param quoteCoinGeckoId - CoinGecko ID of the quote token (unit of account)
   * @param date - Optional date for historical price (omit for current price)
   * @returns Price of token in quote token units (floating point)
   *
   * @example
   * ```typescript
   * const client = CoinGeckoClient.getInstance();
   *
   * // Current ETH price in USDC (stablecoin optimization)
   * const ethInUsdc = await client.getTokenPriceInQuote('ethereum', 'usd-coin');
   * // 3000.50
   *
   * // ETH price in BTC (cross-rate calculation)
   * const ethInBtc = await client.getTokenPriceInQuote('ethereum', 'bitcoin');
   * // 0.06
   *
   * // Historical ETH price in USDC
   * const historicalEth = await client.getTokenPriceInQuote(
   *   'ethereum',
   *   'usd-coin',
   *   new Date('2023-01-15')
   * );
   * // 1500.25
   * ```
   */
  async getTokenPriceInQuote(
    tokenCoinGeckoId: string,
    quoteCoinGeckoId: string,
    date?: Date
  ): Promise<number> {
    log.methodEntry(this.logger, 'getTokenPriceInQuote', {
      tokenCoinGeckoId,
      quoteCoinGeckoId,
      date: date?.toISOString(),
    });

    try {
      // If same token, price is 1
      if (tokenCoinGeckoId === quoteCoinGeckoId) {
        log.methodExit(this.logger, 'getTokenPriceInQuote', { price: 1 });
        return 1;
      }

      // Optimization: If quote token is a stablecoin, just get token price in USD
      if (this.stablecoinIds.includes(quoteCoinGeckoId)) {
        if (date) {
          const historical = await this.getHistoricalPrice(tokenCoinGeckoId, date);
          log.methodExit(this.logger, 'getTokenPriceInQuote', {
            price: historical.usd,
            method: 'stablecoin-historical',
          });
          return historical.usd;
        }

        const prices = await this.getSimplePrices([tokenCoinGeckoId]);
        const price = prices[tokenCoinGeckoId]?.usd ?? 0;
        log.methodExit(this.logger, 'getTokenPriceInQuote', {
          price,
          method: 'stablecoin-current',
        });
        return price;
      }

      // Get both prices and calculate cross-rate
      if (date) {
        const [tokenPrice, quotePrice] = await Promise.all([
          this.getHistoricalPrice(tokenCoinGeckoId, date),
          this.getHistoricalPrice(quoteCoinGeckoId, date),
        ]);

        if (quotePrice.usd === 0) {
          this.logger.warn(
            { quoteCoinGeckoId, date: date.toISOString() },
            'Quote token price is 0, cannot calculate cross-rate'
          );
          log.methodExit(this.logger, 'getTokenPriceInQuote', { price: 0 });
          return 0;
        }

        const price = tokenPrice.usd / quotePrice.usd;
        log.methodExit(this.logger, 'getTokenPriceInQuote', {
          price,
          method: 'cross-rate-historical',
        });
        return price;
      }

      // Current prices
      const prices = await this.getSimplePrices([tokenCoinGeckoId, quoteCoinGeckoId]);
      const tokenUsd = prices[tokenCoinGeckoId]?.usd ?? 0;
      const quoteUsd = prices[quoteCoinGeckoId]?.usd ?? 0;

      if (quoteUsd === 0) {
        this.logger.warn(
          { quoteCoinGeckoId },
          'Quote token price is 0, cannot calculate cross-rate'
        );
        log.methodExit(this.logger, 'getTokenPriceInQuote', { price: 0 });
        return 0;
      }

      const price = tokenUsd / quoteUsd;
      log.methodExit(this.logger, 'getTokenPriceInQuote', {
        price,
        method: 'cross-rate-current',
      });
      return price;
    } catch (error) {
      this.logger.warn(
        {
          tokenCoinGeckoId,
          quoteCoinGeckoId,
          date: date?.toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get token price in quote'
      );
      log.methodExit(this.logger, 'getTokenPriceInQuote', { price: 0, error: true });
      return 0;
    }
  }

  /**
   * Clear all CoinGecko caches (useful for testing or manual refresh)
   *
   * @returns Number of cache entries cleared, or -1 on error
   */
  async clearCache(): Promise<number> {
    return await this.cacheService.clear('coingecko:');
  }

  /**
   * Check if service has valid cached data for token list
   *
   * @returns true if tokens are cached, false otherwise
   */
  async hasCachedData(): Promise<boolean> {
    const cached = await this.cacheService.get<CoinGeckoToken[]>('coingecko:tokens:all');
    return cached !== null;
  }

  // ============================================================================
  // SUPPORTED VS CURRENCIES
  // ============================================================================

  /**
   * Get supported vs_currencies from CoinGecko
   *
   * Returns the list of currencies that can be used as the 'vs_currencies' parameter
   * in price queries. This is used to validate basic currency symbols in manifests.
   *
   * Results are cached for 24 hours since this list rarely changes.
   *
   * @returns Array of supported currency identifiers (lowercase, e.g., ['btc', 'eth', 'usd', 'eur', ...])
   * @throws CoinGeckoApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = CoinGeckoClient.getInstance();
   * const currencies = await client.getSupportedVsCurrencies();
   * // ['btc', 'eth', 'ltc', 'bch', 'bnb', 'eos', 'xrp', 'xlm', 'usd', 'aed', ...]
   *
   * // Check if a currency is supported
   * const isUsdSupported = currencies.includes('usd'); // true
   * const isInvalidSupported = currencies.includes('invalid'); // false
   * ```
   */
  async getSupportedVsCurrencies(): Promise<string[]> {
    log.methodEntry(this.logger, 'getSupportedVsCurrencies');

    const cacheKey = 'coingecko:vs_currencies';

    // Check distributed cache first
    const cached = await this.cacheService.get<string[]>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getSupportedVsCurrencies', cacheKey);
      log.methodExit(this.logger, 'getSupportedVsCurrencies', {
        count: cached.length,
        fromCache: true,
      });
      return cached;
    }

    log.cacheMiss(this.logger, 'getSupportedVsCurrencies', cacheKey);

    try {
      log.externalApiCall(
        this.logger,
        'CoinGecko',
        '/simple/supported_vs_currencies',
        {}
      );

      const response = await this.scheduledFetch(
        `${this.baseUrl}/simple/supported_vs_currencies`
      );

      if (!response.ok) {
        const error = new CoinGeckoApiError(
          `CoinGecko API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'getSupportedVsCurrencies', error, {
          statusCode: response.status,
        });
        throw error;
      }

      const currencies = (await response.json()) as string[];

      this.logger.info(
        { count: currencies.length },
        'Retrieved supported vs_currencies from CoinGecko'
      );

      // Store in distributed cache (24 hour TTL)
      await this.cacheService.set(cacheKey, currencies, this.vsCurrenciesCacheTimeout);

      log.methodExit(this.logger, 'getSupportedVsCurrencies', {
        count: currencies.length,
        fromCache: false,
      });

      return currencies;
    } catch (error) {
      // Re-throw CoinGeckoApiError
      if (error instanceof CoinGeckoApiError) {
        throw error;
      }

      // Wrap other errors
      const wrappedError = new CoinGeckoApiError(
        `Failed to fetch supported vs_currencies from CoinGecko: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      log.methodError(this.logger, 'getSupportedVsCurrencies', wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Validate if a currency symbol is supported by CoinGecko as a vs_currency
   *
   * This is a convenience method that checks if a given symbol (case-insensitive)
   * is in the list of supported vs_currencies. Returns the lowercase version
   * of the currency if valid, null otherwise.
   *
   * @param symbol - Currency symbol to validate (e.g., 'USD', 'usd', 'ETH')
   * @returns Lowercase currency identifier if valid, null if not supported
   *
   * @example
   * ```typescript
   * const client = CoinGeckoClient.getInstance();
   *
   * const usd = await client.validateVsCurrency('USD');
   * // 'usd'
   *
   * const eth = await client.validateVsCurrency('ETH');
   * // 'eth'
   *
   * const invalid = await client.validateVsCurrency('INVALID');
   * // null
   * ```
   */
  async validateVsCurrency(symbol: string): Promise<string | null> {
    log.methodEntry(this.logger, 'validateVsCurrency', { symbol });

    try {
      const currencies = await this.getSupportedVsCurrencies();
      const normalizedSymbol = symbol.toLowerCase();

      const isValid = currencies.includes(normalizedSymbol);

      this.logger.debug(
        { symbol, normalizedSymbol, isValid },
        'Validated vs_currency'
      );

      log.methodExit(this.logger, 'validateVsCurrency', {
        symbol,
        isValid,
        result: isValid ? normalizedSymbol : null,
      });

      return isValid ? normalizedSymbol : null;
    } catch (error) {
      this.logger.warn(
        { symbol, error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to validate vs_currency, returning null'
      );
      log.methodExit(this.logger, 'validateVsCurrency', { symbol, error: true });
      return null;
    }
  }

  /**
   * Get supported chain IDs
   */
  getSupportedChainIds(): number[] {
    return Object.keys(this.chainIdToPlatformId).map(Number);
  }

  /**
   * Check if chain is supported
   */
  isChainSupported(chainId: number): boolean {
    return chainId in this.chainIdToPlatformId;
  }

  /**
   * Search for tokens by symbol, name, and/or address on a specific platform (platform-agnostic)
   *
   * This method is platform-agnostic and works with CoinGecko platform IDs.
   * It searches the cached token list and returns matching tokens.
   *
   * All provided search criteria are combined with AND logic - a token must match
   * ALL specified parameters to be included in results.
   *
   * Platform IDs examples:
   * - 'ethereum' (Ethereum mainnet)
   * - 'arbitrum-one' (Arbitrum)
   * - 'base' (Base)
   * - 'binance-smart-chain' (BSC)
   * - 'polygon-pos' (Polygon)
   * - 'optimistic-ethereum' (Optimism)
   * - 'solana' (Solana - future)
   *
   * @param params.platform - CoinGecko platform ID (e.g., 'ethereum', 'arbitrum-one')
   * @param params.symbol - Optional partial symbol match (case-insensitive)
   * @param params.name - Optional partial name match (case-insensitive)
   * @param params.address - Optional contract address match (case-insensitive, normalized)
   * @returns Array of matching tokens (max 10, sorted by symbol)
   * @throws Error if no search parameters provided
   * @throws CoinGeckoApiError if API request fails
   *
   * @example
   * ```typescript
   * const client = CoinGeckoClient.getInstance();
   *
   * // Search for tokens with "usd" in symbol on Ethereum
   * const results = await client.searchTokens({
   *   platform: 'ethereum',
   *   symbol: 'usd'
   * });
   * // Returns: [{ coingeckoId: 'usd-coin', symbol: 'USDC', name: 'USD Coin', address: '0x...' }, ...]
   *
   * // Search by exact address
   * const byAddress = await client.searchTokens({
   *   platform: 'ethereum',
   *   address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
   * });
   * // Returns: [{ coingeckoId: 'usd-coin', ... }]
   * ```
   */
  async searchTokens(params: {
    platform: string;
    symbol?: string;
    name?: string;
    address?: string;
  }): Promise<Array<{ coingeckoId: string; symbol: string; name: string; address: string }>> {
    const { platform, symbol, name, address } = params;
    log.methodEntry(this.logger, 'searchTokens', { platform, symbol, name, address });

    try {
      // Validate at least one search term provided
      if (!symbol && !name && !address) {
        const error = new Error(
          'At least one search parameter (symbol, name, or address) must be provided'
        );
        log.methodError(this.logger, 'searchTokens', error, { platform });
        throw error;
      }

      // Get all tokens (uses distributed cache)
      const allTokens = await this.getAllTokens();

      // Filter by platform and search criteria
      const normalizedSymbol = symbol?.toLowerCase();
      const normalizedName = name?.toLowerCase();
      const normalizedAddress = address?.toLowerCase();

      const matchingTokens = allTokens
        .filter((token) => {
          // Must have address on specified platform
          const tokenAddress = token.platforms[platform];
          if (!tokenAddress || tokenAddress.trim() === '') {
            return false;
          }

          // Match address if provided (case-insensitive exact match)
          if (normalizedAddress) {
            const tokenAddressLower = tokenAddress.toLowerCase();
            if (tokenAddressLower !== normalizedAddress) {
              return false;
            }
          }

          // Match symbol if provided (substring match)
          if (normalizedSymbol) {
            const tokenSymbol = token.symbol.toLowerCase();
            if (!tokenSymbol.includes(normalizedSymbol)) {
              return false;
            }
          }

          // Match name if provided (substring match)
          if (normalizedName) {
            const tokenName = token.name.toLowerCase();
            if (!tokenName.includes(normalizedName)) {
              return false;
            }
          }

          return true;
        })
        .slice(0, 10) // Limit to 10 results
        .sort((a, b) => a.symbol.localeCompare(b.symbol)) // Sort alphabetically by symbol
        .map((token) => {
          const rawAddress = token.platforms[platform]!; // Safe to assert non-null due to filter above

          // Ensure address is properly checksummed (EIP-55)
          // CoinGecko may return addresses without proper checksumming
          let checksummedAddress = rawAddress;
          if (isAddress(rawAddress)) {
            try {
              checksummedAddress = getAddress(rawAddress);
            } catch (error) {
              // If checksumming fails, log warning and use raw address
              this.logger.warn(
                { address: rawAddress, error },
                'Failed to checksum address from CoinGecko'
              );
            }
          }

          return {
            coingeckoId: token.id,
            symbol: token.symbol.toUpperCase(),
            name: token.name,
            address: checksummedAddress,
          };
        });

      this.logger.info(
        { platform, symbol, name, address, count: matchingTokens.length },
        'Token search completed'
      );

      log.methodExit(this.logger, 'searchTokens', {
        count: matchingTokens.length,
      });

      return matchingTokens;
    } catch (error) {
      // Only log if not already logged
      if (
        !(
          error instanceof Error &&
          error.message.includes('At least one search parameter')
        )
      ) {
        log.methodError(this.logger, 'searchTokens', error as Error, {
          platform,
          symbol,
          name,
          address,
        });
      }
      throw error;
    }
  }
}
