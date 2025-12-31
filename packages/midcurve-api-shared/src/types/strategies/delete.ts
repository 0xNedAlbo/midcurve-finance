/**
 * Delete Strategy Endpoint Types
 *
 * Types for deleting a strategy.
 */

import type { ApiResponse } from '../common/index.js';

// =============================================================================
// RESPONSE
// =============================================================================

/**
 * DELETE /api/v1/strategies/:id - Response
 *
 * Deletes a strategy. Linked positions are NOT deleted,
 * their strategyId is set to null.
 */
export type DeleteStrategyResponse = ApiResponse<{ success: true }>;
