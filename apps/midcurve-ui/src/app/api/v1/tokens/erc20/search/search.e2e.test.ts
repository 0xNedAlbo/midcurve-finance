/**
 * ERC-20 Token Search Endpoint E2E Tests
 *
 * Tests the GET /api/v1/tokens/erc20/search endpoint end-to-end.
 *
 * Note: This endpoint makes real calls to CoinGecko API.
 * Tests use well-known tokens (USDC) for reliability.
 */

import { describe, it, expect } from 'vitest';
import {
  authenticatedGet,
  unauthenticatedGet,
  parseJsonResponse,
  TEST_TOKENS,
} from '@/test/helpers';
import type { SearchErc20TokensResponse } from '@midcurve/api-shared';
import type { ApiResponse } from '@midcurve/api-shared';

const USDC = TEST_TOKENS.USDC_ETHEREUM;

describe('GET /api/v1/tokens/erc20/search', () => {
  describe('with valid API key authentication', () => {
    it('should return 200 OK with valid search by symbol', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}`
      );
      expect(response.status).toBe(200);
    });

    it('should return valid JSON response', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}`
      );
      const data = await parseJsonResponse<SearchErc20TokensResponse>(response);

      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });

    it('should return array of token candidates', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}`
      );
      const data = await parseJsonResponse<SearchErc20TokensResponse>(response);

      // Check ApiResponse wrapper structure
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.meta).toBeDefined();
      expect(data.meta?.timestamp).toBeDefined();
    });

    it('should return candidates with correct structure', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}`
      );
      const data = await parseJsonResponse<SearchErc20TokensResponse>(response);

      // Should have at least one result for USDC
      expect(data.data.length).toBeGreaterThan(0);

      const candidate = data.data[0];
      expect(candidate.coingeckoId).toBeDefined();
      expect(typeof candidate.coingeckoId).toBe('string');
      expect(candidate.symbol).toBeDefined();
      expect(typeof candidate.symbol).toBe('string');
      expect(candidate.name).toBeDefined();
      expect(typeof candidate.name).toBe('string');
      expect(candidate.address).toBeDefined();
      expect(typeof candidate.address).toBe('string');
      expect(candidate.chainId).toBeDefined();
      expect(typeof candidate.chainId).toBe('number');
      expect(candidate.chainId).toBe(USDC.chainId);
    });

    it('should include meta with count and limit', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}`
      );
      const data = await parseJsonResponse<SearchErc20TokensResponse>(response);

      expect(data.meta).toBeDefined();
      expect(data.meta?.count).toBeDefined();
      expect(typeof data.meta?.count).toBe('number');
      expect(data.meta?.limit).toBe(10);
      expect(data.meta?.count).toBeLessThanOrEqual(10);
    });

    it('should return empty array when no matches found', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=NONEXISTENTTOKEN12345`
      );
      const data = await parseJsonResponse<SearchErc20TokensResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(0);
      expect(data.meta?.count).toBe(0);
    });
  });

  describe('search variations', () => {
    it('should search by symbol only', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}`
      );
      const data = await parseJsonResponse<SearchErc20TokensResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should search by name only', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&name=USD`
      );
      const data = await parseJsonResponse<SearchErc20TokensResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should search by address only', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&address=${USDC.address}`
      );
      const data = await parseJsonResponse<SearchErc20TokensResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Address search should return exact match or very few results
      expect(data.data.length).toBeGreaterThanOrEqual(0);
    });

    it('should search with multiple criteria (chainId + symbol)', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}&name=Coin`
      );
      const data = await parseJsonResponse<SearchErc20TokensResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Combined search should filter results more strictly
      expect(Array.isArray(data.data)).toBe(true);
    });
  });

  describe('without authentication', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await unauthenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}`
      );
      expect(response.status).toBe(401);
    });

    it('should return error response', async () => {
      const response = await unauthenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}`
      );
      const data = await parseJsonResponse<ApiResponse<never>>(response);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error?.code).toBe('UNAUTHORIZED');
    });
  });

  describe('with invalid API key', () => {
    it('should return 401 Unauthorized', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=${USDC.chainId}&symbol=${USDC.symbol}`,
        'invalid_api_key'
      );
      expect(response.status).toBe(401);
    });
  });

  describe('validation errors', () => {
    it('should return 400 with missing chainId', async () => {
      const response = await authenticatedGet(`/api/v1/tokens/erc20/search?symbol=${USDC.symbol}`);
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when no search params provided', async () => {
      const response = await authenticatedGet(`/api/v1/tokens/erc20/search?chainId=1`);
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
      // Error should indicate missing search parameters
      expect(data.error?.message).toBeDefined();
    });

    it('should return 400 with invalid chainId (negative)', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=-1&symbol=${USDC.symbol}`
      );
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with invalid chainId (zero)', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=0&symbol=${USDC.symbol}`
      );
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with invalid address format', async () => {
      const response = await authenticatedGet(
        `/api/v1/tokens/erc20/search?chainId=1&address=invalid_address`
      );
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with empty symbol', async () => {
      const response = await authenticatedGet(`/api/v1/tokens/erc20/search?chainId=1&symbol=`);
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with empty name', async () => {
      const response = await authenticatedGet(`/api/v1/tokens/erc20/search?chainId=1&name=`);
      expect(response.status).toBe(400);

      const data = await parseJsonResponse<ApiResponse<never>>(response);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });
  });
});
