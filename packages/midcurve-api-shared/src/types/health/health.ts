/**
 * Health Endpoint Types and Schemas
 *
 * TypeScript types and Zod schemas for health check endpoint.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

/**
 * Health status enum
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

/**
 * Health check response schema
 */
export const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string().datetime(),
  environment: z.string(),
  version: z.string().optional(),
  uptime: z.number().optional(),
});

/**
 * Health check data (inferred from schema)
 */
export type HealthResponseData = z.infer<typeof HealthResponseSchema>;

/**
 * Health check data interface (explicit definition for clarity)
 */
export interface HealthCheckData {
  status: HealthStatus;
  timestamp: string;
  environment: string;
  version?: string;
  uptime?: number;
}

/**
 * Health check response type
 */
export type HealthResponse = ApiResponse<HealthResponseData>;
