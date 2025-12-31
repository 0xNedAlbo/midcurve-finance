/**
 * Strategy State Transition Endpoint Types
 *
 * Types for activating, pausing, resuming, and shutting down strategies.
 */

import type { ApiResponse } from '../common/index.js';
import type { SerializedStrategy } from './common.js';
import { z } from 'zod';

// =============================================================================
// ACTIVATE
// =============================================================================

/**
 * POST /api/v1/strategies/:id/activate - Request body
 *
 * Transitions strategy from 'pending' to 'active'.
 * Requires chain ID and contract address.
 */
export interface ActivateStrategyRequest {
  /**
   * Chain ID where strategy is deployed (internal EVM)
   */
  chainId: number;

  /**
   * Contract address on the internal EVM
   */
  contractAddress: string;
}

/**
 * Zod schema for activate strategy request
 */
export const ActivateStrategyRequestSchema = z.object({
  chainId: z
    .number()
    .int()
    .positive('Chain ID must be a positive integer'),

  contractAddress: z
    .string()
    .min(1, 'Contract address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address format'),
});

/**
 * Inferred type from schema
 */
export type ActivateStrategyInput = z.infer<typeof ActivateStrategyRequestSchema>;

/**
 * POST /api/v1/strategies/:id/activate - Response
 */
export type ActivateStrategyResponse = ApiResponse<SerializedStrategy>;

// =============================================================================
// PAUSE
// =============================================================================

/**
 * POST /api/v1/strategies/:id/pause - Response
 *
 * Transitions strategy from 'active' to 'paused'.
 * No request body required.
 */
export type PauseStrategyResponse = ApiResponse<SerializedStrategy>;

// =============================================================================
// RESUME
// =============================================================================

/**
 * POST /api/v1/strategies/:id/resume - Response
 *
 * Transitions strategy from 'paused' to 'active'.
 * No request body required.
 */
export type ResumeStrategyResponse = ApiResponse<SerializedStrategy>;

// =============================================================================
// SHUTDOWN
// =============================================================================

/**
 * POST /api/v1/strategies/:id/shutdown - Response
 *
 * Transitions strategy to 'shutdown' (terminal state).
 * Can be called from 'active' or 'paused'.
 * No request body required.
 */
export type ShutdownStrategyResponse = ApiResponse<SerializedStrategy>;

// =============================================================================
// REFRESH METRICS
// =============================================================================

/**
 * POST /api/v1/strategies/:id/refresh - Response
 *
 * Refreshes strategy metrics by re-aggregating from linked positions.
 * Triggers refresh on all linked positions first.
 */
export type RefreshStrategyMetricsResponse = ApiResponse<SerializedStrategy>;
