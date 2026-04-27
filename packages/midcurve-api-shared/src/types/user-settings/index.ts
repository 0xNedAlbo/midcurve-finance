/**
 * User Settings API Types
 *
 * Types for the per-user settings endpoints under
 * `/api/v1/user/me/settings/...`.
 */

import { z } from 'zod';
import { POOL_TABLE_COLUMN_IDS } from '@midcurve/shared';
import type { PoolTableColumnId } from '@midcurve/shared';
import type { ApiResponse } from '../common/index.js';

// =============================================================================
// POOL TABLE COLUMNS
// =============================================================================

/**
 * Zod schema for a single column id. Validates against the runtime list of
 * known ids exported from `@midcurve/shared`.
 */
export const PoolTableColumnIdSchema = z.enum(
  POOL_TABLE_COLUMN_IDS as readonly [PoolTableColumnId, ...PoolTableColumnId[]]
);

/**
 * Request body for `PUT /api/v1/user/me/settings/pool-table-columns`.
 */
export const UpdatePoolTableColumnsRequestSchema = z.object({
  visibleColumns: z.array(PoolTableColumnIdSchema),
});

export type UpdatePoolTableColumnsRequest = z.infer<
  typeof UpdatePoolTableColumnsRequestSchema
>;

export interface PoolTableColumnsData {
  visibleColumns: PoolTableColumnId[];
}

export type GetPoolTableColumnsResponse = ApiResponse<PoolTableColumnsData>;
export type UpdatePoolTableColumnsResponse = ApiResponse<PoolTableColumnsData>;
