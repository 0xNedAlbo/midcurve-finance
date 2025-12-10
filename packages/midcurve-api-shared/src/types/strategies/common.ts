/**
 * Strategy Common Types
 *
 * Base types and enums shared across strategy endpoints.
 */

import type { Strategy, StrategyMetrics } from '@midcurve/shared';
import type { BigIntToString } from '../common/index.js';
import { z } from 'zod';

// =============================================================================
// STATE ENUM
// =============================================================================

/**
 * Strategy state enum values
 */
export const STRATEGY_STATES = ['pending', 'active', 'paused', 'shutdown'] as const;

/**
 * Zod schema for strategy state
 */
export const StrategyStateSchema = z.enum(STRATEGY_STATES);

/**
 * Re-export strategy state type for convenience
 */
export type { StrategyState } from '@midcurve/shared';

// =============================================================================
// SERIALIZED TYPES
// =============================================================================

/**
 * Serialized strategy metrics (bigint → string)
 *
 * For JSON responses where all metrics are string-encoded.
 */
export type SerializedStrategyMetrics = BigIntToString<StrategyMetrics>;

/**
 * Serialized strategy for API responses
 *
 * All bigint and Date fields converted to strings for JSON serialization.
 */
export type SerializedStrategy = BigIntToString<Strategy>;

// =============================================================================
// SORT OPTIONS
// =============================================================================

/**
 * Sort field options for strategy list
 */
export type StrategySortBy =
  | 'createdAt'
  | 'updatedAt'
  | 'name'
  | 'currentValue'
  | 'unrealizedPnl';

/**
 * Sort direction options for strategies
 */
export type StrategySortDirection = 'asc' | 'desc';

/**
 * Zod schema for sort field
 */
export const StrategySortBySchema = z.enum([
  'createdAt',
  'updatedAt',
  'name',
  'currentValue',
  'unrealizedPnl',
]);

/**
 * Zod schema for sort direction
 */
export const StrategySortDirectionSchema = z.enum(['asc', 'desc']);

// =============================================================================
// CONFIG SCHEMA
// =============================================================================

/**
 * Zod schema for strategy config (free-form JSON)
 */
export const StrategyConfigSchema = z.record(z.unknown());

/**
 * Inferred type from config schema
 */
export type StrategyConfigInput = z.infer<typeof StrategyConfigSchema>;
