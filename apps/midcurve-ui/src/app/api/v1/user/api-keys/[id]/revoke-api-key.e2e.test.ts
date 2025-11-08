/**
 * Revoke API Key Endpoint E2E Tests
 *
 * Tests the DELETE /api/v1/user/api-keys/:id endpoint end-to-end.
 *
 * Note: This endpoint requires SESSION authentication only (not API keys).
 * These tests only verify that API key authentication is rejected.
 * Full testing requires SIWE session authentication (out of scope for basic tests).
 */

import { describe, it, expect } from 'vitest';
import {
  authenticatedDelete,
  unauthenticatedDelete,
  parseJsonResponse,
} from '@/test/helpers';
import type { ApiResponse } from '@midcurve/api-shared';

describe('DELETE /api/v1/user/api-keys/:id', () => {
  describe('session-only authentication validation', () => {
    it('should return 401 when authenticated with API key', async () => {
      const response = await authenticatedDelete('/api/v1/user/api-keys/test-key-id');
      expect(response.status).toBe(401);
    });

    it('should return error response when using API key', async () => {
      const response = await authenticatedDelete('/api/v1/user/api-keys/test-key-id');
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
      expect(data.error?.message).toContain('Session authentication required');
    });

    it('should return 401 without authentication', async () => {
      const response = await unauthenticatedDelete('/api/v1/user/api-keys/test-key-id');
      expect(response.status).toBe(401);
    });

    it('should return error response without authentication', async () => {
      const response = await unauthenticatedDelete('/api/v1/user/api-keys/test-key-id');
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
    });
  });
});
