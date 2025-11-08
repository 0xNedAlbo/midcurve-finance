/**
 * UniswapV3 APR Period Helper
 *
 * Wrapper functions for APR period calculation and refresh.
 * This module provides a simplified interface to the PositionAprService.
 */

import type { PositionAprPeriod } from '@midcurve/shared';
import type { PositionAprService } from '../../../position-apr/position-apr-service.js';

/**
 * Refresh APR periods for a position
 *
 * Recalculates all APR periods based on current ledger events.
 * Typically called after ledger event discovery or updates.
 *
 * This function:
 * 1. Deletes existing APR periods
 * 2. Fetches all ledger events
 * 3. Divides events into periods (bounded by COLLECT events)
 * 4. Calculates APR for each period
 * 5. Saves periods to database
 *
 * @param positionId - Position database ID
 * @param aprService - APR service instance
 * @returns Array of APR periods, sorted descending by start time (newest first)
 */
export async function refreshAprPeriods(
  positionId: string,
  aprService: PositionAprService
): Promise<PositionAprPeriod[]> {
  return await aprService.refresh(positionId);
}
