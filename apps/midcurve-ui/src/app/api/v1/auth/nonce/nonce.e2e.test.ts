/**
 * Nonce Endpoint E2E Tests
 *
 * Tests the GET /api/v1/auth/nonce endpoint end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { unauthenticatedGet, parseJsonResponse } from '@/test/helpers';
import type { ApiResponse } from '@midcurve/api-shared';

type NonceData = {
  nonce: string;
};

type NonceResponse = ApiResponse<NonceData>;

describe('GET /api/v1/auth/nonce', () => {
  it('should return 200 OK', async () => {
    const response = await unauthenticatedGet('/api/v1/auth/nonce');
    expect(response.status).toBe(200);
  });

  it('should return valid JSON response', async () => {
    const response = await unauthenticatedGet('/api/v1/auth/nonce');
    const data = await parseJsonResponse<NonceResponse>(response);

    expect(data).toBeDefined();
    expect(data.success).toBe(true);
  });

  it('should return nonce with correct structure', async () => {
    const response = await unauthenticatedGet('/api/v1/auth/nonce');
    const data = await parseJsonResponse<NonceResponse>(response);

    // Check ApiResponse wrapper structure
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.meta).toBeDefined();
    expect(data.meta?.timestamp).toBeDefined();

    // Check nonce data structure
    expect(data.data.nonce).toBeDefined();
    expect(typeof data.data.nonce).toBe('string');
  });

  it('should return nonce with correct prefix', async () => {
    const response = await unauthenticatedGet('/api/v1/auth/nonce');
    const data = await parseJsonResponse<NonceResponse>(response);

    // Nonce should start with 'siwe_' prefix
    expect(data.data.nonce).toMatch(/^siwe_/);
  });

  it('should return nonce with sufficient length', async () => {
    const response = await unauthenticatedGet('/api/v1/auth/nonce');
    const data = await parseJsonResponse<NonceResponse>(response);

    // Nonce should be reasonably long (prefix + random string)
    expect(data.data.nonce.length).toBeGreaterThan(20);
  });

  it('should return different nonces on subsequent calls', async () => {
    const response1 = await unauthenticatedGet('/api/v1/auth/nonce');
    const data1 = await parseJsonResponse<NonceResponse>(response1);

    const response2 = await unauthenticatedGet('/api/v1/auth/nonce');
    const data2 = await parseJsonResponse<NonceResponse>(response2);

    // Each call should generate a unique nonce
    expect(data1.data.nonce).not.toBe(data2.data.nonce);
  });

  it('should work without authentication', async () => {
    // Nonce endpoint should be publicly accessible
    const response = await unauthenticatedGet('/api/v1/auth/nonce');

    expect(response.status).toBe(200);
    const data = await parseJsonResponse<NonceResponse>(response);
    expect(data.success).toBe(true);
  });

  it('should include no-store cache-control header', async () => {
    const response = await unauthenticatedGet('/api/v1/auth/nonce');

    const cacheControl = response.headers.get('cache-control');
    expect(cacheControl).toBeDefined();
    expect(cacheControl).toContain('no-store');
    expect(cacheControl).toContain('must-revalidate');
  });

  it('should include timestamp in meta', async () => {
    const response = await unauthenticatedGet('/api/v1/auth/nonce');
    const data = await parseJsonResponse<NonceResponse>(response);

    // Check that timestamp is a valid ISO 8601 string
    expect(data.meta?.timestamp).toBeDefined();
    const timestamp = new Date(data.meta!.timestamp);
    expect(timestamp.toISOString()).toBe(data.meta!.timestamp);
  });
});
