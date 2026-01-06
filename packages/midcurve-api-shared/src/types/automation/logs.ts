/**
 * Automation Log Endpoint Types
 *
 * Types for automation event logs API.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// =============================================================================
// LOG LEVEL & TYPE CONSTANTS
// =============================================================================

/**
 * Log level constants for automation logs
 */
export const AUTOMATION_LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;

export type AutomationLogLevel =
  (typeof AUTOMATION_LOG_LEVELS)[keyof typeof AUTOMATION_LOG_LEVELS];

/**
 * Log level names for automation logs
 */
export const AUTOMATION_LOG_LEVEL_NAMES = [
  'DEBUG',
  'INFO',
  'WARN',
  'ERROR',
] as const;
export type AutomationLogLevelName =
  (typeof AUTOMATION_LOG_LEVEL_NAMES)[number];

/**
 * Automation log types
 */
export const AUTOMATION_LOG_TYPES = [
  'ORDER_CREATED',
  'ORDER_REGISTERED',
  'ORDER_TRIGGERED',
  'ORDER_EXECUTING',
  'ORDER_EXECUTED',
  'ORDER_FAILED',
  'ORDER_CANCELLED',
  'RETRY_SCHEDULED',
] as const;

export type AutomationLogType = (typeof AUTOMATION_LOG_TYPES)[number];

// =============================================================================
// PLATFORM-INDEPENDENT CONTEXT TYPES
// =============================================================================

/**
 * Platform type for log context
 */
export type AutomationPlatform = 'evm' | 'solana';

/**
 * Base context (common to all platforms)
 */
export interface AutomationLogContextBase {
  platform?: AutomationPlatform;
}

/**
 * EVM context fields
 */
export interface AutomationLogContextEvm extends AutomationLogContextBase {
  platform?: 'evm';
  chainId?: number;
  txHash?: string;
  gasLimit?: string;
  gasPrice?: string;
  gasUsed?: string;
  operatorAddress?: string;
}

/**
 * Full context (union of all possible fields)
 * Flat structure for easy access in UI
 */
export interface AutomationLogContext extends AutomationLogContextEvm {
  // Trigger context
  triggerSide?: 'lower' | 'upper';
  triggerPrice?: string;
  currentPrice?: string;
  humanTriggerPrice?: string;
  humanCurrentPrice?: string;

  // Execution context
  amount0Out?: string;
  amount1Out?: string;
  executionFeeBps?: number;

  // Error context
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  willRetry?: boolean;

  // Creation context
  triggerLowerPrice?: string;
  triggerUpperPrice?: string;
  slippageBps?: number;

  // Cancellation context
  cancelledBy?: string;
  reason?: string;
}

// =============================================================================
// LOG DATA TYPE
// =============================================================================

/**
 * Serialized automation log for API responses
 */
export interface AutomationLogData {
  id: string;
  createdAt: string;
  positionId: string;
  closeOrderId: string | null;
  level: AutomationLogLevel;
  levelName: AutomationLogLevelName;
  logType: AutomationLogType;
  message: string;
  context: AutomationLogContext | null;
}

// =============================================================================
// LIST LOGS
// =============================================================================

/**
 * Query schema for listing automation logs
 */
export const ListAutomationLogsQuerySchema = z.object({
  positionId: z.string().min(1),
  level: z.coerce.number().int().min(0).max(3).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ListAutomationLogsQuery = z.infer<
  typeof ListAutomationLogsQuerySchema
>;

/**
 * Response data for listing automation logs
 */
export interface ListAutomationLogsResponseData {
  logs: AutomationLogData[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Response type for listing automation logs
 */
export type ListAutomationLogsResponse =
  ApiResponse<ListAutomationLogsResponseData>;

// =============================================================================
// GET LOG BY ID
// =============================================================================

/**
 * Response type for getting a single automation log
 */
export type GetAutomationLogResponse = ApiResponse<AutomationLogData>;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get level name from level number
 */
export function getAutomationLogLevelName(
  level: number
): AutomationLogLevelName {
  return AUTOMATION_LOG_LEVEL_NAMES[level] ?? 'INFO';
}
