/**
 * User Me Endpoint E2E Tests
 *
 * Tests the GET /api/v1/user/me endpoint end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { authenticatedGet, unauthenticatedGet, parseJsonResponse } from '@/test/helpers';
import type { ApiResponse } from '@midcurve/api-shared';

type WalletData = {
  id: string;
  address: string;
  chainId: number;
  isPrimary: boolean;
  createdAt: string;
};

type UserData = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  wallets: WalletData[];
  createdAt: string;
  updatedAt: string;
};

type UserMeResponse = ApiResponse<UserData>;

describe('GET /api/v1/user/me', () => {
  describe('with valid API key authentication', () => {
    it('should return 200 OK', async () => {
      const response = await authenticatedGet('/api/v1/user/me');
      expect(response.status).toBe(200);
    });

    it('should return valid JSON response', async () => {
      const response = await authenticatedGet('/api/v1/user/me');
      const data = await parseJsonResponse<UserMeResponse>(response);

      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });

    it('should return user data with correct structure', async () => {
      const response = await authenticatedGet('/api/v1/user/me');
      const data = await parseJsonResponse<UserMeResponse>(response);

      // Check ApiResponse wrapper structure
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.meta).toBeDefined();
      expect(data.meta?.timestamp).toBeDefined();

      // Check user data structure
      expect(data.data.id).toBeDefined();
      expect(typeof data.data.id).toBe('string');
      expect(data.data.wallets).toBeDefined();
      expect(Array.isArray(data.data.wallets)).toBe(true);
      expect(data.data.createdAt).toBeDefined();
      expect(data.data.updatedAt).toBeDefined();
    });

    it('should return user with wallets array', async () => {
      const response = await authenticatedGet('/api/v1/user/me');
      const data = await parseJsonResponse<UserMeResponse>(response);

      // User should have at least one wallet (seeded data)
      expect(data.data.wallets).toBeDefined();
      expect(Array.isArray(data.data.wallets)).toBe(true);
      expect(data.data.wallets.length).toBeGreaterThanOrEqual(1);
    });

    it('should return wallets with correct structure', async () => {
      const response = await authenticatedGet('/api/v1/user/me');
      const data = await parseJsonResponse<UserMeResponse>(response);

      const wallet = data.data.wallets[0];
      expect(wallet).toBeDefined();
      expect(wallet.id).toBeDefined();
      expect(typeof wallet.id).toBe('string');
      expect(wallet.address).toBeDefined();
      expect(typeof wallet.address).toBe('string');
      expect(wallet.chainId).toBeDefined();
      expect(typeof wallet.chainId).toBe('number');
      expect(wallet.isPrimary).toBeDefined();
      expect(typeof wallet.isPrimary).toBe('boolean');
      expect(wallet.createdAt).toBeDefined();
      expect(typeof wallet.createdAt).toBe('string');
    });

    it('should return timestamps in ISO format', async () => {
      const response = await authenticatedGet('/api/v1/user/me');
      const data = await parseJsonResponse<UserMeResponse>(response);

      // Check user timestamps
      const createdAt = new Date(data.data.createdAt);
      expect(createdAt.toISOString()).toBe(data.data.createdAt);

      const updatedAt = new Date(data.data.updatedAt);
      expect(updatedAt.toISOString()).toBe(data.data.updatedAt);

      // Check wallet timestamps
      if (data.data.wallets.length > 0) {
        const walletCreatedAt = new Date(data.data.wallets[0].createdAt);
        expect(walletCreatedAt.toISOString()).toBe(data.data.wallets[0].createdAt);
      }
    });

    it('should include private cache-control header', async () => {
      const response = await authenticatedGet('/api/v1/user/me');

      const cacheControl = response.headers.get('cache-control');
      expect(cacheControl).toBeDefined();
      expect(cacheControl).toContain('private');
      expect(cacheControl).toContain('no-cache');
    });
  });

  describe('without authentication', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await unauthenticatedGet('/api/v1/user/me');
      expect(response.status).toBe(401);
    });

    it('should return error response', async () => {
      const response = await unauthenticatedGet('/api/v1/user/me');
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
    });
  });

  describe('with invalid API key', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await authenticatedGet('/api/v1/user/me', 'invalid_api_key');
      expect(response.status).toBe(401);
    });

    it('should return error response', async () => {
      const response = await authenticatedGet('/api/v1/user/me', 'invalid_api_key');
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
    });
  });
});
