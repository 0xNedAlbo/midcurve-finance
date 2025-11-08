/**
 * API Client - Type-safe HTTP wrapper with authentication
 *
 * Centralized fetch wrapper that:
 * - Automatically includes session cookies (same origin)
 * - Handles API errors with structured error types
 * - Provides type-safe request/response handling
 * - Calls API routes co-located in this Next.js app
 *
 * Architecture:
 * - UI and API run in same Next.js app (port 3000)
 * - Session cookies automatically included (same origin)
 * - API routes use withAuth middleware to verify session
 * - No manual token passing needed
 */

import { getSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

/**
 * Structured API error with status code and error details
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Type-safe API client wrapper
 *
 * @example
 * ```typescript
 * const response = await apiClient<ListPositionsResponse>(
 *   '/api/v1/positions/list?status=active'
 * );
 * console.log(response.data); // Type-safe access
 * ```
 */
export async function apiClient<TResponse>(
  endpoint: string,
  options?: RequestInit
): Promise<TResponse> {
  // Get NextAuth session to verify user is authenticated on frontend
  const session = await getSession();

  if (!session?.user) {
    throw new ApiError(
      'Not authenticated. Please sign in first.',
      401,
      'UNAUTHENTICATED',
      { hint: 'NextAuth session not found' }
    );
  }

  const url = `${API_BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      credentials: 'include', // Include cookies (NextAuth session)
    });

    const data = await response.json();

    if (!response.ok) {
      // API returned structured error
      throw new ApiError(
        data.error?.message || data.message || 'Request failed',
        response.status,
        data.error?.code || data.error,
        data.error?.details || data.details
      );
    }

    // Handle different response patterns:
    // 1. Paginated responses: { success, data: [...], pagination, meta }
    //    → Return entire response (already in correct shape)
    // 2. Single resource: { success, data: {...} }
    //    → Extract data field
    if ('pagination' in data) {
      // Paginated response - return as-is
      return data as TResponse;
    }

    // Single resource response - extract data field
    return data.data as TResponse;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    // Network error or JSON parse error
    throw new ApiError(
      error instanceof Error ? error.message : 'Network request failed',
      0,
      'NETWORK_ERROR',
      error
    );
  }
}
