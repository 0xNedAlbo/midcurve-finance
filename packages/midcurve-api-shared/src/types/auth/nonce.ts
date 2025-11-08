/**
 * Nonce Types
 *
 * Types for SIWE nonce generation and validation.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common';

/**
 * Nonce data structure
 */
export interface NonceData {
  nonce: string;
}

/**
 * GET /api/v1/auth/nonce response
 */
export type NonceResponse = ApiResponse<NonceData>;

/**
 * Nonce validation schema
 */
export const NonceSchema = z.object({
  nonce: z.string().regex(/^siwe_[A-Za-z0-9_-]{32}$/, 'Invalid nonce format'),
});
