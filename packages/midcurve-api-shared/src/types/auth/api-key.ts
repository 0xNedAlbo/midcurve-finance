/**
 * API Key Types
 *
 * Types for API key management endpoints.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common';

/**
 * Request to create new API key
 */
export interface CreateApiKeyRequest {
  name: string;
}

/**
 * API key creation result (includes full key - shown ONCE)
 */
export interface CreateApiKeyData {
  id: string;
  name: string;
  key: string; // Full key - ONLY returned at creation
  keyPrefix: string;
  createdAt: string;
}

/**
 * POST /api/v1/user/api-keys response
 */
export interface CreateApiKeyResponse extends ApiResponse<CreateApiKeyData> {
  meta?: {
    warning: string;
    timestamp?: string;
    requestId?: string;
  };
}

/**
 * API key display data (for listing - NO full key)
 */
export interface ApiKeyDisplay {
  id: string;
  name: string;
  keyPrefix: string; // First 8 chars only
  lastUsed: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/v1/user/api-keys response
 */
export type ListApiKeysResponse = ApiResponse<ApiKeyDisplay[]>;

/**
 * DELETE /api/v1/user/api-keys/[id] response
 */
export interface RevokeApiKeyData {
  message: string;
}

export type RevokeApiKeyResponse = ApiResponse<RevokeApiKeyData>;

/**
 * Validation schemas
 */
export const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
});
