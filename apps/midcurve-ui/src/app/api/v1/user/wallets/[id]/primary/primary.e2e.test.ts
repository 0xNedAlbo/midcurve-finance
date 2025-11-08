/**
 * Set Primary Wallet Endpoint E2E Tests
 *
 * Tests the PATCH /api/v1/user/wallets/:id/primary endpoint end-to-end.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  authenticatedPatch,
  unauthenticatedPatch,
  parseJsonResponse,
  TEST_WALLET_ID,
  TEST_WALLET_SECONDARY_ID,
  TEST_WALLET_SECONDARY_ADDRESS,
  getPrismaClient,
} from '@/test/helpers';
import type { ApiResponse } from '@midcurve/api-shared';

type WalletData = {
  id: string;
  address: string;
  chainId: number;
  isPrimary: boolean;
  createdAt: string;
};

type SetPrimaryWalletResponse = ApiResponse<WalletData>;

describe('PATCH /api/v1/user/wallets/:id/primary', () => {
  // Reset wallets to initial state before all tests
  beforeAll(async () => {
    const prisma = getPrismaClient();
    try {
      // Set primary wallet back to initial state
      await prisma.authWalletAddress.update({
        where: { id: TEST_WALLET_ID },
        data: { isPrimary: true },
      });
      // Set secondary wallet to non-primary
      await prisma.authWalletAddress.update({
        where: { id: TEST_WALLET_SECONDARY_ID },
        data: { isPrimary: false },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  describe('with valid API key authentication', () => {
    it('should return 200 OK when setting secondary wallet as primary', async () => {
      const response = await authenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`
      );
      expect(response.status).toBe(200);
    });

    it('should return valid JSON response', async () => {
      const response = await authenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`
      );
      const data = await parseJsonResponse<SetPrimaryWalletResponse>(response);

      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });

    it('should return wallet data with correct structure', async () => {
      const response = await authenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`
      );
      const data = await parseJsonResponse<SetPrimaryWalletResponse>(response);

      // Check ApiResponse wrapper structure
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.meta).toBeDefined();
      expect(data.meta?.timestamp).toBeDefined();

      // Check wallet data structure
      expect(data.data.id).toBeDefined();
      expect(typeof data.data.id).toBe('string');
      expect(data.data.address).toBeDefined();
      expect(typeof data.data.address).toBe('string');
      expect(data.data.chainId).toBeDefined();
      expect(typeof data.data.chainId).toBe('number');
      expect(data.data.isPrimary).toBeDefined();
      expect(typeof data.data.isPrimary).toBe('boolean');
      expect(data.data.createdAt).toBeDefined();
      expect(typeof data.data.createdAt).toBe('string');
    });

    it('should set wallet as primary (isPrimary = true)', async () => {
      const response = await authenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`
      );
      const data = await parseJsonResponse<SetPrimaryWalletResponse>(response);

      expect(data.data.isPrimary).toBe(true);
      expect(data.data.id).toBe(TEST_WALLET_SECONDARY_ID);
    });

    it('should return correct wallet address', async () => {
      const response = await authenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`
      );
      const data = await parseJsonResponse<SetPrimaryWalletResponse>(response);

      expect(data.data.address).toBe(TEST_WALLET_SECONDARY_ADDRESS);
    });

    it('should return timestamp in ISO format', async () => {
      const response = await authenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`
      );
      const data = await parseJsonResponse<SetPrimaryWalletResponse>(response);

      const createdAt = new Date(data.data.createdAt);
      expect(createdAt.toISOString()).toBe(data.data.createdAt);
    });

    it('should allow setting already-primary wallet as primary (idempotent)', async () => {
      // First set secondary as primary
      await authenticatedPatch(`/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`);

      // Try setting it again as primary (should succeed)
      const response = await authenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`
      );
      const data = await parseJsonResponse<SetPrimaryWalletResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.isPrimary).toBe(true);
    });
  });

  describe('without authentication', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await unauthenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`
      );
      expect(response.status).toBe(401);
    });

    it('should return error response', async () => {
      const response = await unauthenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`
      );
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
    });
  });

  describe('with invalid API key', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await authenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`,
        undefined,
        'invalid_api_key'
      );
      expect(response.status).toBe(401);
    });

    it('should return error response', async () => {
      const response = await authenticatedPatch(
        `/api/v1/user/wallets/${TEST_WALLET_SECONDARY_ID}/primary`,
        undefined,
        'invalid_api_key'
      );
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
    });
  });

  describe('with invalid wallet ID', () => {
    it('should return 404 when wallet does not exist', async () => {
      const response = await authenticatedPatch('/api/v1/user/wallets/non-existent-wallet/primary');
      expect(response.status).toBe(404);
    });

    it('should return error response with WALLET_NOT_FOUND code', async () => {
      const response = await authenticatedPatch('/api/v1/user/wallets/non-existent-wallet/primary');
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('WALLET_NOT_FOUND');
      expect(data.error?.message).toContain('not found');
    });

    it('should return 400 with empty wallet ID', async () => {
      const response = await authenticatedPatch('/api/v1/user/wallets//primary');
      // Next.js routing: empty dynamic param may result in 404 (route not found) or 400
      // Expect either 400 (validation error) or 404 (route mismatch)
      expect([400, 404]).toContain(response.status);
    });
  });

  describe('with wallet belonging to different user', () => {
    it('should return 404 when trying to set another users wallet as primary', async () => {
      // Create a wallet belonging to a different user
      const prisma = getPrismaClient();
      let otherUserWalletId: string;

      try {
        // Create another user
        const otherUser = await prisma.user.create({
          data: {
            id: 'other-user-temp',
            name: 'Other User',
            email: 'other@example.com',
          },
        });

        // Create wallet for other user
        const otherUserWallet = await prisma.authWalletAddress.create({
          data: {
            id: 'other-user-wallet-temp',
            address: '0x9999999999999999999999999999999999999999',
            chainId: 1,
            isPrimary: true,
            userId: otherUser.id,
          },
        });

        otherUserWalletId = otherUserWallet.id;

        // Try to set other user's wallet as primary (should fail)
        const response = await authenticatedPatch(
          `/api/v1/user/wallets/${otherUserWalletId}/primary`
        );

        expect(response.status).toBe(404);

        const data = await parseJsonResponse<ApiResponse<never>>(response);
        expect(data.success).toBe(false);
        expect(data.error?.code).toBe('WALLET_NOT_FOUND');
        expect(data.error?.message).toContain('does not belong');
      } finally {
        // Clean up temp data
        await prisma.authWalletAddress.deleteMany({
          where: { id: 'other-user-wallet-temp' },
        });
        await prisma.user.deleteMany({
          where: { id: 'other-user-temp' },
        });
        await prisma.$disconnect();
      }
    });
  });
});
