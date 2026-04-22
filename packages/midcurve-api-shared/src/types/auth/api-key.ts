/**
 * API Key Types
 *
 * Types for API key management endpoints. Keys are long-lived personal access
 * tokens managed by the user via the /api-keys page. The raw key is shown
 * only once at creation time and cannot be retrieved later.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common';

/**
 * Allowed expiry presets when creating a key. `null` = no expiry.
 */
export const ApiKeyExpiryDays = [30, 90, 365] as const;
export type ApiKeyExpiryDays = (typeof ApiKeyExpiryDays)[number];

/**
 * Request to create new API key
 */
export interface CreateApiKeyRequest {
  name: string;
  expiresInDays?: ApiKeyExpiryDays | null;
}

/**
 * API key creation result (includes full raw key — shown ONCE)
 */
export interface CreateApiKeyData {
  id: string;
  name: string;
  /** Full raw key — ONLY returned at creation, cannot be retrieved later */
  key: string;
  /** Display prefix (first 12 chars of the raw key) */
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
}

/**
 * POST /api/v1/user/api-keys response
 */
export type CreateApiKeyResponse = ApiResponse<CreateApiKeyData>;

/**
 * API key display data (for listing — never includes the raw key)
 */
export interface ApiKeyResponse {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

/**
 * GET /api/v1/user/api-keys response
 */
export interface ListApiKeysResponseData {
  keys: ApiKeyResponse[];
}

export type ListApiKeysResponse = ApiResponse<ListApiKeysResponseData>;

/**
 * DELETE /api/v1/user/api-keys/[id] response
 */
export interface RevokeApiKeyData {
  revoked: true;
}

export type RevokeApiKeyResponse = ApiResponse<RevokeApiKeyData>;

/**
 * Validation schema for POST /api/v1/user/api-keys
 */
export const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  expiresInDays: z
    .union([z.literal(30), z.literal(90), z.literal(365), z.null()])
    .optional(),
});
