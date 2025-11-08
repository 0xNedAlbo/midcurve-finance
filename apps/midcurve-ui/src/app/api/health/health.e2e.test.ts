/**
 * Health Endpoint E2E Tests
 *
 * Tests the /api/health endpoint end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { unauthenticatedGet, parseJsonResponse } from '@/test/helpers';
import { HealthStatus, type HealthResponse } from '@midcurve/api-shared';

describe('GET /api/health', () => {
  it('should return 200 OK', async () => {
    const response = await unauthenticatedGet('/api/health');
    expect(response.status).toBe(200);
  });

  it('should return valid JSON response', async () => {
    const response = await unauthenticatedGet('/api/health');
    const data = await parseJsonResponse<HealthResponse>(response);

    expect(data).toBeDefined();
    expect(data.success).toBe(true);
  });

  it('should return health data with correct structure', async () => {
    const response = await unauthenticatedGet('/api/health');
    const data = await parseJsonResponse<HealthResponse>(response);

    // Check ApiResponse wrapper structure
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.meta).toBeDefined();
    expect(data.meta?.timestamp).toBeDefined();

    // Check health data structure
    expect(data.data.status).toBeDefined();
    expect(data.data.timestamp).toBeDefined();
    expect(data.data.environment).toBeDefined();
  });

  it('should return status "healthy"', async () => {
    const response = await unauthenticatedGet('/api/health');
    const data = await parseJsonResponse<HealthResponse>(response);

    expect(data.data.status).toBe(HealthStatus.HEALTHY);
  });

  it('should return current environment from NODE_ENV', async () => {
    const response = await unauthenticatedGet('/api/health');
    const data = await parseJsonResponse<HealthResponse>(response);

    // Environment comes from the running server's NODE_ENV
    // When testing against dev server, it will be 'development'
    // When testing against production, it will be 'production'
    expect(data.data.environment).toBeDefined();
    expect(typeof data.data.environment).toBe('string');
  });

  it('should return uptime as a number', async () => {
    const response = await unauthenticatedGet('/api/health');
    const data = await parseJsonResponse<HealthResponse>(response);

    expect(typeof data.data.uptime).toBe('number');
    expect(data.data.uptime).toBeGreaterThan(0);
  });

  it('should return timestamp in ISO format', async () => {
    const response = await unauthenticatedGet('/api/health');
    const data = await parseJsonResponse<HealthResponse>(response);

    // Check that timestamp is a valid ISO 8601 string
    const timestamp = new Date(data.data.timestamp);
    expect(timestamp.toISOString()).toBe(data.data.timestamp);
  });

  it('should work without authentication', async () => {
    // Health endpoint should be publicly accessible
    const response = await unauthenticatedGet('/api/health');

    expect(response.status).toBe(200);
    const data = await parseJsonResponse<HealthResponse>(response);
    expect(data.success).toBe(true);
  });

  it('should include cache-control header', async () => {
    const response = await unauthenticatedGet('/api/health');

    const cacheControl = response.headers.get('cache-control');
    expect(cacheControl).toBeDefined();
    expect(cacheControl).toContain('no-store');
    expect(cacheControl).toContain('must-revalidate');
  });
});
