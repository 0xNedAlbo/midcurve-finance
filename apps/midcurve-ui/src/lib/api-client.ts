/**
 * API Client - Type-safe HTTP wrapper with session authentication
 *
 * Centralized fetch wrapper that:
 * - Automatically includes session cookies (cross-origin with credentials)
 * - Handles API errors with structured error types
 * - Provides type-safe request/response handling
 *
 * Architecture:
 * - UI runs as Vite SPA on a different origin from API
 * - Session cookies sent with credentials: 'include'
 * - API validates session via custom session middleware
 */

import type { ApiResponse, ApiError as ApiErrorType } from '@midcurve/api-shared';

// Get API URL from environment - empty string means same origin (proxied in dev)
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

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

interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Internal request handler
 */
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers,
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
    credentials: 'include', // Important: include cookies for session auth
    signal: options?.signal,
  };

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    const json = await response.json();

    if (!response.ok) {
      const error = json as ApiErrorType;
      throw new ApiError(
        error.error?.message || 'An error occurred',
        response.status,
        error.error?.code || 'UNKNOWN_ERROR',
        error.error?.details
      );
    }

    return json as ApiResponse<T>;
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

/**
 * API client with typed methods
 */
export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('GET', path, undefined, options);
  },

  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('POST', path, body, options);
  },

  put<T>(path: string, body: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('PUT', path, body, options);
  },

  patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('PATCH', path, body, options);
  },

  delete<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('DELETE', path, undefined, options);
  },
};

/**
 * Get a nonce for SIWE authentication
 */
export async function getNonce(): Promise<string> {
  const response = await apiClient.get<{ nonce: string }>('/api/v1/auth/nonce');
  return response.data.nonce;
}

/**
 * Legacy API client function for backward compatibility
 *
 * This function matches the old signature: apiClient<T>(endpoint, options?)
 * Returns the data directly (unwrapped from ApiResponse).
 *
 * Usage:
 * ```typescript
 * const data = await apiClientFn<MyType>('/api/v1/endpoint');
 * ```
 */
export async function apiClientFn<TResponse>(
  endpoint: string,
  options?: RequestInit
): Promise<TResponse> {
  const method = (options?.method || 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  let body: unknown = undefined;
  if (options?.body && typeof options.body === 'string') {
    try {
      body = JSON.parse(options.body);
    } catch {
      body = options.body;
    }
  }

  const response = await request<TResponse>(method, endpoint, body, {
    headers: options?.headers as Record<string, string>,
    signal: options?.signal ?? undefined,
  });

  // Return just the data for backward compatibility
  return response.data;
}

// =============================================================================
// AUTOMATION API
// =============================================================================

import type {
  // Close Orders
  ListCloseOrdersRequest,
  ListCloseOrdersResponse,
  RegisterCloseOrderRequest,
  RegisterCloseOrderResponse,
  GetCloseOrderResponse,
  UpdateCloseOrderRequest,
  UpdateCloseOrderResponse,
  CancelCloseOrderResponse,
  GetCloseOrderStatusResponse,
  NotifyOrderCancelledRequest,
  NotifyOrderCancelledResponse,
  // Shared Contracts
  GetSharedContractResponse,
  ListSharedContractsResponse,
  // Wallet
  GetAutowalletResponse,
  CreateAutowalletResponse,
  RefundAutowalletRequest,
  RefundAutowalletResponse,
  GetRefundStatusResponse,
  // Logs
  ListAutomationLogsResponse,
} from '@midcurve/api-shared';

/**
 * Build query string from params object
 */
function buildQueryString(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

/**
 * Automation API client for close orders and contracts
 */
export const automationApi = {
  // ---------------------------------------------------------------------------
  // Close Orders
  // ---------------------------------------------------------------------------

  /**
   * List close orders for the current user
   */
  listCloseOrders(params: ListCloseOrdersRequest = {}) {
    const qs = buildQueryString(params);
    return apiClient.get<ListCloseOrdersResponse['data']>(`/api/v1/automation/close-orders${qs}`);
  },

  /**
   * Create a new close order (async - returns 202)
   */
  createCloseOrder(input: RegisterCloseOrderRequest) {
    return apiClient.post<RegisterCloseOrderResponse['data']>('/api/v1/automation/close-orders', input);
  },

  /**
   * Get a single close order by ID
   */
  getCloseOrder(id: string) {
    return apiClient.get<GetCloseOrderResponse['data']>(`/api/v1/automation/close-orders/${id}`);
  },

  /**
   * Get close order registration status (for polling)
   */
  getCloseOrderStatus(id: string) {
    return apiClient.get<GetCloseOrderStatusResponse['data']>(`/api/v1/automation/close-orders/${id}/status`);
  },

  /**
   * Update an existing close order
   */
  updateCloseOrder(id: string, input: UpdateCloseOrderRequest) {
    return apiClient.put<UpdateCloseOrderResponse['data']>(`/api/v1/automation/close-orders/${id}`, input);
  },

  /**
   * Cancel a close order
   */
  cancelCloseOrder(id: string) {
    return apiClient.delete<CancelCloseOrderResponse['data']>(`/api/v1/automation/close-orders/${id}`);
  },

  /**
   * Notify API after user cancels a close order on-chain
   */
  notifyOrderCancelled(orderId: string, input: NotifyOrderCancelledRequest) {
    return apiClient.post<NotifyOrderCancelledResponse['data']>(
      `/api/v1/automation/close-orders/${orderId}/cancelled`,
      input
    );
  },

  // ---------------------------------------------------------------------------
  // Shared Contracts
  // ---------------------------------------------------------------------------

  /**
   * List all shared contracts (grouped by protocol)
   */
  listSharedContracts() {
    return apiClient.get<ListSharedContractsResponse['data']>('/api/v1/automation/shared-contracts');
  },

  /**
   * Get shared contract for a specific chain
   */
  getSharedContract(chainId: number) {
    return apiClient.get<GetSharedContractResponse['data']>(`/api/v1/automation/shared-contracts/${chainId}`);
  },

  // ---------------------------------------------------------------------------
  // Automation Wallet
  // ---------------------------------------------------------------------------

  /**
   * Get user's automation wallet info (address, balances, activity)
   */
  getWallet() {
    return apiClient.get<GetAutowalletResponse['data']>('/api/v1/automation/wallet');
  },

  /**
   * Create user's automation wallet
   */
  createWallet() {
    return apiClient.post<CreateAutowalletResponse['data']>('/api/v1/automation/wallet', {});
  },

  /**
   * Request refund of gas from autowallet to user's wallet
   */
  requestRefund(input: RefundAutowalletRequest) {
    return apiClient.post<RefundAutowalletResponse['data']>('/api/v1/automation/wallet/refund', input);
  },

  /**
   * Get refund operation status (for polling)
   */
  getRefundStatus(requestId: string) {
    return apiClient.get<GetRefundStatusResponse['data']>(`/api/v1/automation/wallet/refund/${requestId}`);
  },

  // ---------------------------------------------------------------------------
  // Automation Logs
  // ---------------------------------------------------------------------------

  /**
   * List automation logs for a position
   */
  listLogs(params: { positionId: string; level?: number; limit?: number; cursor?: string }) {
    const qs = buildQueryString(params);
    return apiClient.get<ListAutomationLogsResponse['data']>(`/api/v1/automation/logs${qs}`);
  },
};
