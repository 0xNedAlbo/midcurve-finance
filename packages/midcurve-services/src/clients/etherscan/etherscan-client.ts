/**
 * Etherscan API Client
 *
 * Client for the Etherscan v2 unified API that works across all supported chains.
 * Uses a single endpoint and API key for Ethereum, Arbitrum, Base, Optimism, and Polygon.
 *
 * Features:
 * - Unified API endpoint for all chains
 * - Rate limiting with RequestScheduler
 * - Automatic retry with exponential backoff
 * - Event log parsing for Uniswap V3 position events
 * - Distributed caching for contract deployment blocks
 *
 * @see https://docs.etherscan.io/v/etherscan-v2
 */

import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { CacheService } from '../../services/cache/index.js';
import { RequestScheduler } from '../../utils/request-scheduler/index.js';
import type {
  EtherscanLog,
  EtherscanLogsResponse,
  EtherscanBlockNumberResponse,
  EtherscanContractCreationResponse,
  ContractCreationInfo,
  FetchLogsOptions,
  FetchPositionEventsOptions,
  RawPositionEvent,
  UniswapV3EventType,
} from './types.js';

/**
 * Etherscan v2 unified API base URL
 */
const API_BASE_URL = 'https://api.etherscan.io/v2/api';

/**
 * Uniswap V3 NFT Position Manager event signatures
 */
export const EVENT_SIGNATURES = {
  INCREASE_LIQUIDITY: '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f',
  DECREASE_LIQUIDITY: '0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4',
  COLLECT: '0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01',
} as const;

/**
 * Uniswap V3 NFT Position Manager addresses per chain
 */
export const NFT_POSITION_MANAGER_ADDRESSES: Record<number, string> = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Ethereum
  42161: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Arbitrum
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', // Base (deployed at block 1371714)
  10: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Optimism
  137: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Polygon
};

/**
 * Supported chain IDs for Etherscan v2 API
 */
export const SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 10, 137] as const;

/**
 * Error thrown when Etherscan API request fails
 */
export class EtherscanApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'EtherscanApiError';
  }
}

/**
 * Error thrown when API key is missing
 */
export class EtherscanApiKeyMissingError extends Error {
  constructor() {
    super(
      'ETHERSCAN_API_KEY environment variable is not set. ' +
        'Get your API key at: https://etherscan.io/myapikey'
    );
    this.name = 'EtherscanApiKeyMissingError';
  }
}

/**
 * Dependencies for EtherscanClient
 */
export interface EtherscanClientDependencies {
  /**
   * Cache service for distributed caching
   * If not provided, the singleton CacheService instance will be used
   */
  cacheService?: CacheService;

  /**
   * Request scheduler for rate limiting
   * If not provided, a new RequestScheduler with 220ms spacing will be created
   * @default new RequestScheduler({ minSpacingMs: 220, name: 'EtherscanScheduler' })
   */
  requestScheduler?: RequestScheduler;

  /**
   * Etherscan API key
   * If not provided, will use process.env.ETHERSCAN_API_KEY
   */
  apiKey?: string;
}

/**
 * Etherscan API Client
 *
 * Manages API requests to Etherscan v2 unified API with rate limiting and error handling.
 * Uses PostgreSQL-based caching to share cache across multiple processes, workers, and serverless functions.
 * Uses singleton pattern for convenient default access.
 */
export class EtherscanClient {
  private static instance: EtherscanClient | null = null;

  private readonly cacheService: CacheService;
  private readonly requestScheduler: RequestScheduler;
  private readonly apiKey: string;
  private readonly logger: ServiceLogger;

  // Cache contract deployment blocks permanently (they never change)
  private readonly contractCreationCacheTtl = 365 * 24 * 60 * 60; // 1 year

  constructor(dependencies: EtherscanClientDependencies = {}) {
    this.logger = createServiceLogger('EtherscanClient');

    // Get API key
    this.apiKey = dependencies.apiKey ?? process.env.ETHERSCAN_API_KEY ?? '';
    if (!this.apiKey) {
      throw new EtherscanApiKeyMissingError();
    }

    // Initialize dependencies
    this.cacheService = dependencies.cacheService ?? CacheService.getInstance();
    this.requestScheduler =
      dependencies.requestScheduler ??
      new RequestScheduler({
        minSpacingMs: 220, // ~4.5 requests per second
        name: 'EtherscanScheduler',
      });

    this.logger.info('EtherscanClient initialized');
  }

  /**
   * Get singleton instance of EtherscanClient
   */
  static getInstance(): EtherscanClient {
    if (!EtherscanClient.instance) {
      EtherscanClient.instance = new EtherscanClient();
    }
    return EtherscanClient.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  static resetInstance(): void {
    EtherscanClient.instance = null;
  }

  /**
   * Check if Etherscan API response indicates rate limiting
   */
  private isEtherscanRateLimited(data: EtherscanLogsResponse): boolean {
    return (
      data.status !== '1' &&
      data.message === 'NOTOK' &&
      typeof data.result === 'string' &&
      data.result.toLowerCase().includes('max calls per sec')
    );
  }

  /**
   * Scheduled fetch wrapper that combines rate limiting and retry logic
   *
   * All Etherscan API calls go through this method to ensure:
   * - Minimum 220ms spacing between requests (~4.5 req/sec)
   * - Automatic retry with exponential backoff for transient errors (429, 5xx, NOTOK)
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
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Midcurve-Services/1.0',
            },
          });

          // Success - return response
          if (response.ok) {
            // Check for Etherscan-specific rate limit in response body
            const text = await response.text();
            let data: EtherscanLogsResponse;

            try {
              data = JSON.parse(text);
            } catch {
              // Not JSON, return original response
              return new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            }

            // Check for NOTOK rate limit response
            if (this.isEtherscanRateLimited(data)) {
              if (attempt >= maxRetries) {
                // Out of retries, return response for caller to handle
                return new Response(text, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                });
              }

              // Calculate delay for rate limit
              const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
              const jitter = Math.floor(Math.random() * 200);

              this.logger.warn(
                {
                  attempt: attempt + 1,
                  maxRetries,
                  delay: delay + jitter,
                  result: data.result,
                },
                'Etherscan API rate limit detected (NOTOK), retrying'
              );

              await new Promise((resolve) => setTimeout(resolve, delay + jitter));
              continue;
            }

            // Success - return response with parsed JSON
            return new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
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
            'Retryable HTTP error, backing off'
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
   * Fetch event logs from Etherscan v2 unified API
   *
   * @param chainId - Chain ID (1, 42161, 8453, 10, 137)
   * @param contractAddress - Contract address to fetch logs from
   * @param options - Filtering options (block range, topics)
   * @returns Array of event logs
   * @throws EtherscanApiError if API request fails
   */
  async fetchLogs(
    chainId: number,
    contractAddress: string,
    options: FetchLogsOptions = {}
  ): Promise<EtherscanLog[]> {
    log.methodEntry(this.logger, 'fetchLogs', { chainId, contractAddress, options });

    this.validateChainId(chainId);

    const {
      fromBlock = 'earliest',
      toBlock = 'latest',
      topic0,
      topic1,
      topic2,
      topic3,
    } = options;

    const params = new URLSearchParams({
      chainid: chainId.toString(),
      module: 'logs',
      action: 'getLogs',
      address: contractAddress,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      apikey: this.apiKey,
    });

    // Add topic filters if provided
    if (topic0) params.append('topic0', topic0);
    if (topic1) params.append('topic1', topic1);
    if (topic2) params.append('topic2', topic2);
    if (topic3) params.append('topic3', topic3);

    const url = `${API_BASE_URL}?${params.toString()}`;

    try {
      log.externalApiCall(this.logger, 'Etherscan', '/logs/getLogs', {
        chainId,
        fromBlock,
        toBlock,
      });

      const response = await this.scheduledFetch(url);

      if (!response.ok) {
        const error = new EtherscanApiError(
          `Etherscan API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'fetchLogs', error, { statusCode: response.status });
        throw error;
      }

      const data = (await response.json()) as EtherscanLogsResponse;

      if (data.status !== '1') {
        // Special case: "No records found" is not an error
        if (data.message === 'No records found') {
          log.methodExit(this.logger, 'fetchLogs', { count: 0 });
          return [];
        }

        const error = new EtherscanApiError(
          `Etherscan API error: ${data.message} ${
            typeof data.result === 'string' ? data.result : ''
          }`
        );
        log.methodError(this.logger, 'fetchLogs', error);
        throw error;
      }

      const logs = Array.isArray(data.result) ? data.result : [];
      log.methodExit(this.logger, 'fetchLogs', { count: logs.length });
      return logs;
    } catch (error) {
      if (error instanceof EtherscanApiError) {
        throw error;
      }

      const wrappedError = new EtherscanApiError(
        `Failed to fetch logs from Etherscan: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      log.methodError(this.logger, 'fetchLogs', wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Get contract creation block number with distributed caching
   *
   * Contract deployment blocks are cached permanently since they never change.
   *
   * @param chainId - Chain ID
   * @param contractAddress - Contract address
   * @returns Block number as string
   * @throws EtherscanApiError if API request fails
   */
  async getContractCreationBlock(chainId: number, contractAddress: string): Promise<string> {
    log.methodEntry(this.logger, 'getContractCreationBlock', { chainId, contractAddress });

    this.validateChainId(chainId);

    const cacheKey = `etherscan:contract-creation:${chainId}:${contractAddress.toLowerCase()}`;

    // Check cache first
    const cached = await this.cacheService.get<ContractCreationInfo>(cacheKey);
    if (cached) {
      log.cacheHit(this.logger, 'getContractCreationBlock', cacheKey);
      log.methodExit(this.logger, 'getContractCreationBlock', {
        blockNumber: cached.blockNumber,
        fromCache: true,
      });
      return cached.blockNumber;
    }

    log.cacheMiss(this.logger, 'getContractCreationBlock', cacheKey);

    const params = new URLSearchParams({
      chainid: chainId.toString(),
      module: 'contract',
      action: 'getcontractcreation',
      contractaddresses: contractAddress,
      apikey: this.apiKey,
    });

    const url = `${API_BASE_URL}?${params.toString()}`;

    try {
      log.externalApiCall(this.logger, 'Etherscan', '/contract/getcontractcreation', {
        chainId,
        contractAddress,
      });

      const response = await this.scheduledFetch(url);

      if (!response.ok) {
        const error = new EtherscanApiError(
          `Etherscan API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'getContractCreationBlock', error, {
          statusCode: response.status,
        });
        throw error;
      }

      const data = (await response.json()) as EtherscanContractCreationResponse;

      if (data.status !== '1') {
        const error = new EtherscanApiError(
          `Etherscan API error: ${data.message} ${
            typeof data.result === 'string' ? data.result : ''
          }`
        );
        log.methodError(this.logger, 'getContractCreationBlock', error);
        throw error;
      }

      if (!Array.isArray(data.result) || data.result.length === 0) {
        const error = new EtherscanApiError(
          `Contract creation not found for ${contractAddress} on chain ${chainId}`
        );
        log.methodError(this.logger, 'getContractCreationBlock', error);
        throw error;
      }

      const info = data.result[0];

      // TypeScript narrowing: we already checked array is not empty
      if (!info) {
        const error = new EtherscanApiError(
          `Contract creation not found for ${contractAddress} on chain ${chainId}`
        );
        log.methodError(this.logger, 'getContractCreationBlock', error);
        throw error;
      }

      // Cache permanently
      await this.cacheService.set(cacheKey, info, this.contractCreationCacheTtl);

      log.methodExit(this.logger, 'getContractCreationBlock', {
        blockNumber: info.blockNumber,
        fromCache: false,
      });
      return info.blockNumber;
    } catch (error) {
      if (error instanceof EtherscanApiError) {
        throw error;
      }

      const wrappedError = new EtherscanApiError(
        `Failed to fetch contract creation info: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      log.methodError(this.logger, 'getContractCreationBlock', wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Get block number for timestamp
   *
   * @param chainId - Chain ID
   * @param timestamp - Unix timestamp in seconds
   * @param closest - "before" or "after" (default: "before")
   * @returns Block number as string
   * @throws EtherscanApiError if API request fails
   */
  async getBlockNumberForTimestamp(
    chainId: number,
    timestamp: number,
    closest: 'before' | 'after' = 'before'
  ): Promise<string> {
    log.methodEntry(this.logger, 'getBlockNumberForTimestamp', {
      chainId,
      timestamp,
      closest,
    });

    this.validateChainId(chainId);

    const params = new URLSearchParams({
      chainid: chainId.toString(),
      module: 'block',
      action: 'getblocknobytime',
      timestamp: timestamp.toString(),
      closest,
      apikey: this.apiKey,
    });

    const url = `${API_BASE_URL}?${params.toString()}`;

    try {
      log.externalApiCall(this.logger, 'Etherscan', '/block/getblocknobytime', {
        chainId,
        timestamp,
        closest,
      });

      const response = await this.scheduledFetch(url);

      if (!response.ok) {
        const error = new EtherscanApiError(
          `Etherscan API error: ${response.status} ${response.statusText}`,
          response.status
        );
        log.methodError(this.logger, 'getBlockNumberForTimestamp', error, {
          statusCode: response.status,
        });
        throw error;
      }

      const data = (await response.json()) as EtherscanBlockNumberResponse;

      if (data.status !== '1') {
        // Check for invalid timestamp error
        if (data.message?.includes('Invalid timestamp')) {
          const error = new EtherscanApiError(
            `Timestamp too old or too new: ${new Date(timestamp * 1000).toISOString()}`
          );
          log.methodError(this.logger, 'getBlockNumberForTimestamp', error);
          throw error;
        }

        const error = new EtherscanApiError(
          `Etherscan API error: ${data.message} ${data.result}`
        );
        log.methodError(this.logger, 'getBlockNumberForTimestamp', error);
        throw error;
      }

      log.methodExit(this.logger, 'getBlockNumberForTimestamp', {
        blockNumber: data.result,
      });
      return data.result;
    } catch (error) {
      if (error instanceof EtherscanApiError) {
        throw error;
      }

      const wrappedError = new EtherscanApiError(
        `Failed to fetch block number for timestamp: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      log.methodError(this.logger, 'getBlockNumberForTimestamp', wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Fetch all position events for a Uniswap V3 NFT
   *
   * Fetches INCREASE_LIQUIDITY, DECREASE_LIQUIDITY, and COLLECT events,
   * parses the raw log data, deduplicates, and sorts by blockchain order.
   *
   * @param chainId - Chain ID
   * @param nftId - NFT token ID (decimal string or number)
   * @param options - Fetch options (block range, event types)
   * @returns Array of parsed position events, sorted by blockchain order
   * @throws EtherscanApiError if API request fails
   */
  async fetchPositionEvents(
    chainId: number,
    nftId: string | number,
    options: FetchPositionEventsOptions = {}
  ): Promise<RawPositionEvent[]> {
    log.methodEntry(this.logger, 'fetchPositionEvents', { chainId, nftId, options });

    this.validateChainId(chainId);

    const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[chainId];
    if (!nftManagerAddress) {
      const error = new EtherscanApiError(`No NFT Position Manager address for chain ${chainId}`);
      log.methodError(this.logger, 'fetchPositionEvents', error);
      throw error;
    }

    // Determine block range
    let fromBlock = options.fromBlock;
    if (fromBlock === undefined) {
      // Default: start from contract deployment block
      fromBlock = await this.getContractCreationBlock(chainId, nftManagerAddress);
    }
    const toBlock = options.toBlock ?? 'latest';

    // Determine event types to fetch
    const eventTypes: UniswapV3EventType[] = options.eventTypes ?? [
      'INCREASE_LIQUIDITY',
      'DECREASE_LIQUIDITY',
      'COLLECT',
    ];

    // Create topic filter for NFT token ID (topic[1])
    const tokenIdHex = '0x' + BigInt(nftId).toString(16).padStart(64, '0');

    this.logger.debug(
      { nftId, tokenIdHex, fromBlock, toBlock, eventTypes },
      'Fetching position events'
    );

    const allEvents: RawPositionEvent[] = [];

    // Fetch events for each event type
    for (const eventType of eventTypes) {
      try {
        this.logger.debug({ eventType }, `Fetching ${eventType} events`);

        const logs = await this.fetchLogs(chainId, nftManagerAddress, {
          fromBlock,
          toBlock,
          topic0: EVENT_SIGNATURES[eventType],
          topic1: tokenIdHex,
        });

        this.logger.debug({ eventType, logCount: logs.length }, 'Retrieved raw logs');

        // Parse each log
        for (const log of logs) {
          try {
            const parsed = this.parseEventLog(log, eventType, chainId);
            if (parsed) {
              allEvents.push(parsed);
            }
          } catch (error) {
            const errorMsg = `Failed to parse ${eventType} log ${log.transactionHash}:${log.logIndex}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`;
            this.logger.error({ error, log }, errorMsg);
            throw new EtherscanApiError(errorMsg);
          }
        }
      } catch (error) {
        if (error instanceof EtherscanApiError) {
          throw error;
        }

        const errorMsg = `Failed to fetch ${eventType} events: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        this.logger.error({ error, eventType }, errorMsg);
        throw new EtherscanApiError(errorMsg);
      }
    }

    this.logger.debug({ totalEventCount: allEvents.length }, 'Total events before deduplication');

    // Deduplicate and sort
    const finalEvents = this.deduplicateAndSort(allEvents);

    this.logger.debug({ finalEventCount: finalEvents.length }, 'Final events after deduplication');

    log.methodExit(this.logger, 'fetchPositionEvents', { count: finalEvents.length });
    return finalEvents;
  }

  /**
   * Parse raw Etherscan log into RawPositionEvent
   */
  private parseEventLog(
    log: EtherscanLog,
    eventType: UniswapV3EventType,
    chainId: number
  ): RawPositionEvent | null {
    const blockNumber = BigInt(log.blockNumber);
    const blockTimestamp = new Date(parseInt(log.timeStamp) * 1000);
    const transactionIndex = parseInt(log.transactionIndex);
    const logIndex = parseInt(log.logIndex);

    // Extract tokenId from topic[1]
    const tokenIdTopic = log.topics[1];
    if (!tokenIdTopic) {
      throw new Error('Missing tokenId in event topics');
    }
    const tokenId = BigInt(tokenIdTopic).toString();

    const baseEvent = {
      eventType,
      tokenId,
      transactionHash: log.transactionHash,
      blockNumber,
      transactionIndex,
      logIndex,
      blockTimestamp,
      chainId,
    };

    // Parse event-specific data from log.data
    switch (eventType) {
      case 'INCREASE_LIQUIDITY': {
        // IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
        const { liquidity, amount0, amount1 } = this.decodeIncreaseLiquidityData(log.data);
        return {
          ...baseEvent,
          liquidity: liquidity.toString(),
          amount0: amount0.toString(),
          amount1: amount1.toString(),
        };
      }

      case 'DECREASE_LIQUIDITY': {
        // DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
        const { liquidity, amount0, amount1 } = this.decodeDecreaseLiquidityData(log.data);
        return {
          ...baseEvent,
          liquidity: liquidity.toString(),
          amount0: amount0.toString(),
          amount1: amount1.toString(),
        };
      }

      case 'COLLECT': {
        // Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)
        const { recipient, amount0, amount1 } = this.decodeCollectData(log.data);
        return {
          ...baseEvent,
          amount0: amount0.toString(),
          amount1: amount1.toString(),
          recipient,
        };
      }

      default:
        return null;
    }
  }

  /**
   * Decode IncreaseLiquidity event data
   */
  private decodeIncreaseLiquidityData(data: string): {
    liquidity: bigint;
    amount0: bigint;
    amount1: bigint;
  } {
    // Remove 0x prefix and split into 32-byte chunks
    const hex = data.slice(2);
    const chunks = hex.match(/.{64}/g) || [];

    if (chunks.length < 3) {
      throw new Error(`Invalid IncreaseLiquidity data: expected 3 chunks, got ${chunks.length}`);
    }

    return {
      liquidity: BigInt('0x' + chunks[0]!),
      amount0: BigInt('0x' + chunks[1]!),
      amount1: BigInt('0x' + chunks[2]!),
    };
  }

  /**
   * Decode DecreaseLiquidity event data
   */
  private decodeDecreaseLiquidityData(data: string): {
    liquidity: bigint;
    amount0: bigint;
    amount1: bigint;
  } {
    // Same structure as IncreaseLiquidity
    return this.decodeIncreaseLiquidityData(data);
  }

  /**
   * Decode Collect event data
   */
  private decodeCollectData(data: string): {
    recipient: string;
    amount0: bigint;
    amount1: bigint;
  } {
    // Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)
    // data contains: recipient (32 bytes) + amount0 (32 bytes) + amount1 (32 bytes)

    const hex = data.slice(2);
    const chunks = hex.match(/.{64}/g) || [];

    if (chunks.length < 3) {
      throw new Error(`Invalid Collect data: expected 3 chunks, got ${chunks.length}`);
    }

    // Extract recipient address (last 20 bytes of first chunk)
    const recipientHex = chunks[0]!.slice(24); // Remove first 12 bytes (padding)
    const recipient = '0x' + recipientHex;

    return {
      recipient,
      amount0: BigInt('0x' + chunks[1]!),
      amount1: BigInt('0x' + chunks[2]!),
    };
  }

  /**
   * Remove duplicates and sort events by blockchain order
   */
  private deduplicateAndSort(events: RawPositionEvent[]): RawPositionEvent[] {
    // Create unique key for deduplication
    const uniqueEvents = new Map<string, RawPositionEvent>();

    for (const event of events) {
      const key = `${event.transactionHash}-${event.logIndex}`;
      if (!uniqueEvents.has(key)) {
        uniqueEvents.set(key, event);
      }
    }

    // Sort by blockchain order
    return Array.from(uniqueEvents.values()).sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return Number(a.blockNumber - b.blockNumber);
      }
      if (a.transactionIndex !== b.transactionIndex) {
        return a.transactionIndex - b.transactionIndex;
      }
      return a.logIndex - b.logIndex;
    });
  }

  /**
   * Validate chain ID is supported
   */
  private validateChainId(chainId: number): void {
    if (!SUPPORTED_CHAIN_IDS.includes(chainId as any)) {
      throw new EtherscanApiError(
        `Unsupported chain ID: ${chainId}. Supported chains: ${SUPPORTED_CHAIN_IDS.join(', ')}`
      );
    }
  }

  /**
   * Get supported chain IDs
   */
  getSupportedChainIds(): readonly number[] {
    return SUPPORTED_CHAIN_IDS;
  }

  /**
   * Check if chain is supported
   */
  isChainSupported(chainId: number): boolean {
    return SUPPORTED_CHAIN_IDS.includes(chainId as any);
  }
}
