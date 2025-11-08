/**
 * Position APR Input Types
 *
 * Input types for creating and updating APR period records.
 * These types are used exclusively by the service layer and are NOT shared with UI/API.
 */

import type { PositionAprPeriod } from '@midcurve/shared';

// ============================================================================
// CREATE INPUT
// ============================================================================

/**
 * Create APR Period Input
 *
 * Input for creating a new APR period record.
 * Omits database-generated fields (id, createdAt, updatedAt).
 */
export type CreateAprPeriodInput = Omit<
  PositionAprPeriod,
  'id' | 'createdAt' | 'updatedAt'
>;

// ============================================================================
// UPDATE INPUT
// ============================================================================

/**
 * Update APR Period Input
 *
 * Input for updating an existing APR period record.
 * All fields are optional except those that should never change.
 *
 * Note: In practice, APR periods are usually immutable once created.
 * This type exists for completeness but may not be used.
 */
export type UpdateAprPeriodInput = Partial<
  Omit<
    PositionAprPeriod,
    'id' | 'createdAt' | 'updatedAt' | 'positionId' | 'startEventId' | 'endEventId'
  >
>;
