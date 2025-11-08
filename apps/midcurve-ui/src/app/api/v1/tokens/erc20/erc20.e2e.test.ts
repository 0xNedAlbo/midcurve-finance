/**
 * ERC-20 Token Discovery Endpoint E2E Tests
 *
 * Tests the POST /api/v1/tokens/erc20 endpoint end-to-end.
 *
 * Note: This endpoint makes real calls to CoinGecko API and blockchain RPC.
 * Tests use well-known tokens (USDC) for reliability.
 */

import { describe, it, expect } from 'vitest';
import {
  authenticatedPost,
  unauthenticatedPost,
  parseJsonResponse,
  TEST_TOKENS,
} from '@/test/helpers';
import type { CreateErc20TokenResponse } from '@midcurve/api-shared';
import type { ApiResponse } from '@midcurve/api-shared';

const USDC = TEST_TOKENS.USDC_ETHEREUM;

describe('POST /api/v1/tokens/erc20', () => {
  describe('with valid API key authentication', () => {
    it('should return 200 OK with valid token address', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: USDC.chainId,
      });
      expect(response.status).toBe(200);
    });

    it('should return valid JSON response', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: USDC.chainId,
      });
      const data = await parseJsonResponse<CreateErc20TokenResponse>(response);

      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });

    it('should return token data with correct structure', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: USDC.chainId,
      });
      const data = await parseJsonResponse<CreateErc20TokenResponse>(response);

      // Check ApiResponse wrapper structure
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.meta).toBeDefined();
      expect(data.meta?.timestamp).toBeDefined();

      // Check token data structure
      expect(data.data.id).toBeDefined();
      expect(typeof data.data.id).toBe('string');
      expect(data.data.tokenType).toBe('erc20');
      expect(data.data.name).toBeDefined();
      expect(typeof data.data.name).toBe('string');
      expect(data.data.symbol).toBeDefined();
      expect(typeof data.data.symbol).toBe('string');
      expect(data.data.decimals).toBeDefined();
      expect(typeof data.data.decimals).toBe('number');
      expect(data.data.config).toBeDefined();
      expect(data.data.config.address).toBeDefined();
      expect(data.data.config.chainId).toBeDefined();
      expect(data.data.createdAt).toBeDefined();
      expect(data.data.updatedAt).toBeDefined();
    });

    it('should return enriched token with CoinGecko data', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: USDC.chainId,
      });
      const data = await parseJsonResponse<CreateErc20TokenResponse>(response);

      // USDC should be enriched with CoinGecko data
      expect(data.data.coingeckoId).toBeDefined();
      expect(typeof data.data.coingeckoId).toBe('string');

      // Logo URL may or may not be present
      if (data.data.logoUrl) {
        expect(typeof data.data.logoUrl).toBe('string');
      }

      // Market cap may or may not be present
      if (data.data.marketCap) {
        expect(typeof data.data.marketCap).toBe('number');
      }
    });

    it('should normalize address to EIP-55 checksum format', async () => {
      // Submit lowercase address
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address.toLowerCase(),
        chainId: USDC.chainId,
      });
      const data = await parseJsonResponse<CreateErc20TokenResponse>(response);

      // Response should contain checksummed address
      expect(data.data.config.address).toBe(USDC.address);
      expect(data.data.config.address).not.toBe(USDC.address.toLowerCase());
    });

    it('should be idempotent (calling twice returns same token)', async () => {
      // First call
      const response1 = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: USDC.chainId,
      });
      const data1 = await parseJsonResponse<CreateErc20TokenResponse>(response1);

      // Second call with same parameters
      const response2 = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: USDC.chainId,
      });
      const data2 = await parseJsonResponse<CreateErc20TokenResponse>(response2);

      // Should return the same token ID
      expect(data1.data.id).toBe(data2.data.id);
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
    });

    it('should return timestamps in ISO format', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: USDC.chainId,
      });
      const data = await parseJsonResponse<CreateErc20TokenResponse>(response);

      const createdAt = new Date(data.data.createdAt);
      expect(createdAt.toISOString()).toBe(data.data.createdAt);

      const updatedAt = new Date(data.data.updatedAt);
      expect(updatedAt.toISOString()).toBe(data.data.updatedAt);
    });
  });

  describe('without authentication', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await unauthenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: USDC.chainId,
      });
      expect(response.status).toBe(401);
    });

    it('should return error response', async () => {
      const response = await unauthenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: USDC.chainId,
      });
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
    });
  });

  describe('with invalid API key', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await authenticatedPost(
        '/api/v1/tokens/erc20',
        {
          address: USDC.address,
          chainId: USDC.chainId,
        },
        'invalid_api_key'
      );
      expect(response.status).toBe(401);
    });
  });

  describe('validation errors', () => {
    it('should return 400 with invalid address format (not 0x)', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: 'invalid_address',
        chainId: 1,
      });
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with invalid address format (wrong length)', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: '0x123', // Too short
        chainId: 1,
      });
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with missing chainId', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        // chainId missing
      });
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with invalid chainId (negative)', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: -1,
      });
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with invalid chainId (zero)', async () => {
      const response = await authenticatedPost('/api/v1/tokens/erc20', {
        address: USDC.address,
        chainId: 0,
      });
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });
  });
});
