/**
 * Pagination Types
 *
 * Standard pagination types for list endpoints.
 * This file will be part of @midcurve/api-types in the future.
 */

import { z } from 'zod';

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: PaginationMeta;
  meta?: {
    requestId?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
}

/**
 * Pagination parameters for requests
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * Default pagination values
 */
export const DEFAULT_PAGINATION = {
  LIMIT: 20,
  MAX_LIMIT: 100,
  OFFSET: 0,
} as const;

/**
 * Zod schema for pagination query parameters
 */
export const PaginationParamsSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : DEFAULT_PAGINATION.LIMIT))
    .pipe(
      z
        .number()
        .int()
        .positive()
        .max(DEFAULT_PAGINATION.MAX_LIMIT)
        .default(DEFAULT_PAGINATION.LIMIT)
    ),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : DEFAULT_PAGINATION.OFFSET))
    .pipe(
      z
        .number()
        .int()
        .nonnegative()
        .default(DEFAULT_PAGINATION.OFFSET)
    ),
});

/**
 * Helper to create pagination metadata
 */
export function createPaginationMeta(
  total: number,
  limit: number,
  offset: number
): PaginationMeta {
  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}

/**
 * Helper to create a paginated response
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  limit: number,
  offset: number,
  meta?: PaginatedResponse<T>['meta']
): PaginatedResponse<T> {
  return {
    success: true,
    data,
    pagination: createPaginationMeta(total, limit, offset),
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}
