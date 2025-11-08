/**
 * User Wallets Endpoint E2E Tests
 *
 * Tests the GET /api/v1/user/wallets endpoint end-to-end.
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
  updatedAt: string;
};

type WalletsResponse = ApiResponse<WalletData[]>;

describe('GET /api/v1/user/wallets', () => {
  describe('with valid API key authentication', () => {
    it('should return 200 OK', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      expect(response.status).toBe(200);
    });

    it('should return valid JSON response', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<WalletsResponse>(response);

      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });

    it('should return array of wallets', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<WalletsResponse>(response);

      // Check ApiResponse wrapper structure
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.meta).toBeDefined();
      expect(data.meta?.timestamp).toBeDefined();
    });

    it('should return at least one wallet', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<WalletsResponse>(response);

      // Test user should have at least one wallet (seeded data)
      expect(data.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should return wallets with correct structure', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<WalletsResponse>(response);

      const wallet = data.data[0];
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
      expect(wallet.updatedAt).toBeDefined();
      expect(typeof wallet.updatedAt).toBe('string');
    });

    it('should return wallet address in EIP-55 format', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<WalletsResponse>(response);

      const wallet = data.data[0];
      // EIP-55 addresses start with 0x and are 42 characters long
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should return valid chainId', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<WalletsResponse>(response);

      const wallet = data.data[0];
      // ChainId should be a positive integer
      expect(wallet.chainId).toBeGreaterThan(0);
      expect(Number.isInteger(wallet.chainId)).toBe(true);
    });

    it('should have exactly one primary wallet', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<WalletsResponse>(response);

      const primaryWallets = data.data.filter((w) => w.isPrimary);
      expect(primaryWallets.length).toBe(1);
    });

    it('should order wallets by isPrimary descending', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<WalletsResponse>(response);

      // First wallet should be primary (if there are multiple wallets)
      if (data.data.length > 1) {
        expect(data.data[0].isPrimary).toBe(true);
      }
    });

    it('should return timestamps in ISO format', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<WalletsResponse>(response);

      const wallet = data.data[0];
      const createdAt = new Date(wallet.createdAt);
      expect(createdAt.toISOString()).toBe(wallet.createdAt);

      const updatedAt = new Date(wallet.updatedAt);
      expect(updatedAt.toISOString()).toBe(wallet.updatedAt);
    });

    it('should include private cache-control header', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets');

      const cacheControl = response.headers.get('cache-control');
      expect(cacheControl).toBeDefined();
      expect(cacheControl).toContain('private');
      expect(cacheControl).toContain('no-cache');
    });
  });

  describe('without authentication', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await unauthenticatedGet('/api/v1/user/wallets');
      expect(response.status).toBe(401);
    });

    it('should return error response', async () => {
      const response = await unauthenticatedGet('/api/v1/user/wallets');
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
    });
  });

  describe('with invalid API key', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets', 'invalid_api_key');
      expect(response.status).toBe(401);
    });

    it('should return error response', async () => {
      const response = await authenticatedGet('/api/v1/user/wallets', 'invalid_api_key');
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
    });
  });
});
