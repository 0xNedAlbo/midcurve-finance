/**
 * RetryHandler
 *
 * Generic retry logic with exponential backoff for handling transient failures.
 * Designed for rate-limited APIs and unreliable network conditions.
 *
 * Features:
 * - Exponential backoff with jitter
 * - Respects `Retry-After` header (takes priority)
 * - Configurable retry attempts and delays
 * - Only retries transient errors (429, 5xx)
 * - Detailed logging
 *
 * Use Cases:
 * - Rate-limited APIs (CoinGecko, Twitter, GitHub)
 * - Unreliable network conditions
 * - Temporary server errors (5xx)
 *
 * @example
 * ```typescript
 * const response = await withRetries(
 *   () => fetch('https://api.example.com/data'),
 *   { retries: 5, baseDelayMs: 1000 }
 * );
 * ```
 */

import { createServiceLogger, log } from '../../logging/index.js';

export interface RetryOptions {
  /**
   * Maximum number of retry attempts
   * @default 6
   */
  retries?: number;

  /**
   * Base delay in milliseconds for exponential backoff
   * @default 800
   */
  baseDelayMs?: number;

  /**
   * Maximum delay in milliseconds
   * @default 8000
   */
  maxDelayMs?: number;

  /**
   * Optional name for logging purposes
   * @default 'RetryHandler'
   */
  name?: string;

  /**
   * Function to determine if an error is retryable
   * @default Retries 429 and 5xx status codes
   */
  isRetryable?: (status: number) => boolean;
}

/**
 * Default function to determine if an HTTP status code is retryable
 *
 * @param status - HTTP status code
 * @returns true if the status code represents a transient error
 */
function defaultIsRetryable(status: number): boolean {
  // 429 Too Many Requests
  if (status === 429) return true;

  // 5xx Server Errors (transient)
  if (status >= 500 && status < 600) return true;

  return false;
}

/**
 * Sleep for specified milliseconds
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic and exponential backoff
 *
 * @param call - Function that returns a Promise<Response>
 * @param options - Retry configuration options
 * @returns Promise that resolves with the parsed JSON response
 * @throws Error if all retry attempts fail
 *
 * @example
 * ```typescript
 * // Simple usage
 * const data = await withRetries<MyType>(
 *   () => fetch('https://api.example.com/data')
 * );
 *
 * // Custom options
 * const data = await withRetries<MyType>(
 *   () => fetch('https://api.example.com/data'),
 *   {
 *     retries: 3,
 *     baseDelayMs: 500,
 *     maxDelayMs: 5000
 *   }
 * );
 * ```
 */
export async function withRetries<T>(
  call: () => Promise<Response>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retries = 6,
    baseDelayMs = 800,
    maxDelayMs = 8000,
    name = 'RetryHandler',
    isRetryable = defaultIsRetryable,
  } = options;

  const logger = createServiceLogger(name);
  let attempt = 0;

  while (true) {
    let response: Response;

    try {
      log.methodEntry(logger, 'withRetries', { attempt, maxRetries: retries });
      response = await call();
    } catch (error) {
      // Network error or other non-Response error
      log.methodError(logger, 'withRetries', error as Error, { attempt });

      if (attempt >= retries) {
        logger.error(
          { attempt, maxRetries: retries, error },
          'All retry attempts exhausted for network error'
        );
        throw error;
      }

      // Retry network errors with exponential backoff
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = Math.floor(Math.random() * 200);
      const totalDelay = delay + jitter;

      logger.warn(
        { attempt, delay: totalDelay, error },
        'Network error, retrying with backoff'
      );

      await sleep(totalDelay);
      attempt++;
      continue;
    }

    // Successful response
    if (response.ok) {
      log.methodExit(logger, 'withRetries', { attempt, status: response.status });
      return response.json() as Promise<T>;
    }

    // Error response
    const status = response.status;
    const bodyText = await response.text().catch(() => '');

    // Check if error is retryable
    const shouldRetry = isRetryable(status);

    if (!shouldRetry || attempt >= retries) {
      const error = new Error(
        `HTTP ${status} ${response.statusText}${bodyText ? `: ${bodyText}` : ''}`
      );
      log.methodError(logger, 'withRetries', error, {
        attempt,
        status,
        retryable: shouldRetry,
      });

      if (attempt >= retries) {
        logger.error(
          { attempt, maxRetries: retries, status, bodyText },
          'All retry attempts exhausted'
        );
      } else {
        logger.error(
          { attempt, status, bodyText },
          'Non-retryable error, not retrying'
        );
      }

      throw error;
    }

    // Calculate delay with Retry-After header support
    const retryAfterHeader = response.headers.get('Retry-After');
    let delay: number;

    if (retryAfterHeader) {
      // Retry-After can be in seconds or an HTTP date
      const retryAfterSeconds = Number(retryAfterHeader);

      if (!isNaN(retryAfterSeconds)) {
        // It's a number of seconds
        delay = Math.min(maxDelayMs, Math.max(baseDelayMs, retryAfterSeconds * 1000));
        logger.info(
          { retryAfterSeconds, calculatedDelayMs: delay },
          'Using Retry-After header for delay'
        );
      } else {
        // It's an HTTP date - parse and calculate
        const retryAfterDate = new Date(retryAfterHeader);
        const retryAfterMs = retryAfterDate.getTime() - Date.now();
        delay = Math.min(maxDelayMs, Math.max(baseDelayMs, retryAfterMs));
        logger.info(
          { retryAfterDate, calculatedDelayMs: delay },
          'Using Retry-After date for delay'
        );
      }
    } else {
      // Exponential backoff
      delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    }

    // Add jitter to prevent thundering herd
    const jitter = Math.floor(Math.random() * 200);
    const totalDelay = delay + jitter;

    logger.warn(
      {
        attempt: attempt + 1,
        maxRetries: retries,
        status,
        delay: totalDelay,
        hasRetryAfter: !!retryAfterHeader,
      },
      'Retryable error, backing off'
    );

    await sleep(totalDelay);
    attempt++;
  }
}

/**
 * Specialized error class for API errors
 *
 * Preserves HTTP status code for error handling
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: Response
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Execute an async function with retry logic, throwing ApiError on failure
 *
 * @param call - Function that returns a Promise<Response>
 * @param options - Retry configuration options
 * @returns Promise that resolves with the parsed JSON response
 * @throws ApiError if all retry attempts fail
 */
export async function withRetriesApiError<T>(
  call: () => Promise<Response>,
  options: RetryOptions = {}
): Promise<T> {
  try {
    return await withRetries<T>(call, options);
  } catch (error) {
    if (error instanceof Error) {
      // Parse status code from error message if available
      const statusMatch = error.message.match(/HTTP (\d+)/);
      const statusCode = statusMatch ? Number(statusMatch[1]) : undefined;

      throw new ApiError(error.message, statusCode);
    }
    throw error;
  }
}
