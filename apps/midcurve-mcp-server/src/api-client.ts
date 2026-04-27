/**
 * Node-side HTTP client for the midcurve REST API.
 *
 * Authenticates every request with the API key as a Bearer token. Returns the
 * unwrapped `data` field of `ApiResponse<T>` on success and throws `ApiError`
 * otherwise — tool handlers translate this into MCP-friendly text responses.
 */

import type { ApiError as ApiErrorPayload, ApiResponse } from '@midcurve/api-shared';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class ApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  /**
   * GET an endpoint that returns the standard `{ success, data, meta }` envelope.
   * Returns the unwrapped `data` field.
   */
  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    const body = await this.fetchBody(path, query);
    if (!isObject(body) || body.success !== true) {
      this.throwApiError(body, 200);
    }
    return (body as unknown as ApiResponse<T>).data;
  }

  /**
   * GET an endpoint that does NOT use the standard envelope (e.g. `PaginatedResponse`
   * where `data` is a list and `pagination` is a top-level sibling).
   * Returns the entire response body parsed as JSON.
   */
  async getRaw<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    const body = await this.fetchBody(path, query);
    if (isObject(body) && body.success === false) {
      this.throwApiError(body, 200);
    }
    return body as T;
  }

  /**
   * POST an endpoint that returns the standard `{ success, data, meta }` envelope.
   * Returns the unwrapped `data` field.
   */
  async post<T>(path: string, payload: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(
        `API returned non-JSON response (HTTP ${response.status})`,
        response.status,
        'INVALID_RESPONSE'
      );
    }
    if (!response.ok) {
      this.throwApiError(body, response.status);
    }
    if (!isObject(body) || body.success !== true) {
      this.throwApiError(body, response.status);
    }
    return (body as unknown as ApiResponse<T>).data;
  }

  private async fetchBody(path: string, query?: Record<string, unknown>): Promise<unknown> {
    const url = this.buildUrl(path, query);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(
        `API returned non-JSON response (HTTP ${response.status})`,
        response.status,
        'INVALID_RESPONSE'
      );
    }
    if (!response.ok) {
      this.throwApiError(body, response.status);
    }
    return body;
  }

  private throwApiError(body: unknown, fallbackStatus: number): never {
    const error = body as ApiErrorPayload;
    throw new ApiError(
      error.error?.message ?? `HTTP ${fallbackStatus}`,
      fallbackStatus,
      error.error?.code,
      error.error?.details
    );
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path, this.config.baseUrl + '/');
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

}
