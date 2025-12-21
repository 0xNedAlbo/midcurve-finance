/**
 * Strategy Logs Endpoint Types
 *
 * Types for retrieving strategy execution logs (DEBUG, INFO, WARN, ERROR).
 */

import { z } from 'zod';

// =============================================================================
// LOG LEVEL
// =============================================================================

/**
 * Log level numeric values
 * - 0: DEBUG - Detailed debugging information
 * - 1: INFO - General operational information
 * - 2: WARN - Warning conditions
 * - 3: ERROR - Error conditions
 */
export type LogLevel = 0 | 1 | 2 | 3;

/**
 * Log level names
 */
export type LogLevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Log level schema for validation
 */
export const LogLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

// =============================================================================
// QUERY PARAMETERS
// =============================================================================

/**
 * GET /api/v1/strategies/:id/logs - Query parameters
 */
export interface StrategyLogsParams {
  /**
   * Filter by log level (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
   */
  level?: LogLevel;

  /**
   * Start of time range (ISO 8601)
   */
  from?: string;

  /**
   * End of time range (ISO 8601)
   */
  to?: string;

  /**
   * Maximum results per page (1-1000)
   * @default 100
   */
  limit?: number;

  /**
   * Pagination cursor (log ID for cursor-based pagination)
   */
  cursor?: string;
}

/**
 * Zod schema for strategy logs query parameters
 */
export const StrategyLogsQuerySchema = z.object({
  level: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? parseInt(val, 10) : undefined))
    .pipe(LogLevelSchema.optional()),

  from: z.string().datetime({ offset: true }).optional(),

  to: z.string().datetime({ offset: true }).optional(),

  limit: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? parseInt(val, 10) : 100))
    .pipe(z.number().min(1).max(1000).default(100)),

  cursor: z.string().optional(),
});

/**
 * Inferred type from schema
 */
export type StrategyLogsQuery = z.infer<typeof StrategyLogsQuerySchema>;

// =============================================================================
// RESPONSE DATA
// =============================================================================

/**
 * Single strategy log entry
 */
export interface StrategyLogData {
  /**
   * Unique log entry ID
   */
  id: string;

  /**
   * When the log was emitted (ISO 8601)
   */
  timestamp: string;

  /**
   * Log level (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
   */
  level: LogLevel;

  /**
   * Human-readable log level name
   */
  levelName: LogLevelName;

  /**
   * Log topic (bytes32 hex hash)
   */
  topic: string;

  /**
   * Human-readable topic name (if decoded)
   */
  topicName: string | null;

  /**
   * Raw log data (bytes hex string)
   */
  data: string;

  /**
   * Human-readable decoded data (if possible)
   */
  dataDecoded: string | null;

  /**
   * Strategy epoch when log was emitted
   */
  epoch: string;

  /**
   * Distributed tracing correlation ID
   */
  correlationId: string;
}

// =============================================================================
// RESPONSE
// =============================================================================

/**
 * GET /api/v1/strategies/:id/logs - Response data
 */
export interface StrategyLogsResponseData {
  /**
   * List of log entries (ordered by timestamp descending)
   */
  logs: StrategyLogData[];

  /**
   * Cursor for next page (null if no more results)
   */
  nextCursor: string | null;

  /**
   * Whether more results are available
   */
  hasMore: boolean;
}

/**
 * Full API response type
 */
export interface StrategyLogsResponse {
  success: true;
  data: StrategyLogsResponseData;
}
