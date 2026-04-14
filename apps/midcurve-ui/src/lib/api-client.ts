/**
 * API Client - Type-safe HTTP wrapper with session authentication
 *
 * Centralized fetch wrapper that:
 * - Sends session token via Authorization: Bearer header
 * - Stores session token in localStorage
 * - Handles API errors with structured error types
 * - Automatically clears token on 401 responses
 * - Provides type-safe request/response handling
 */

import type { ApiResponse, ApiError as ApiErrorType } from '@midcurve/api-shared';

import { API_URL } from './env';

// Get API URL from runtime config, env var, or empty string (same origin / proxied in dev)
const API_BASE_URL = API_URL;

// Session token storage
const TOKEN_KEY = 'midcurve_session';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

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

  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: options?.signal,
  };

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    const json = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        clearStoredToken();
      }
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
  ListCloseOrdersResponse,
  GetCloseOrderResponse,
  SerializedCloseOrder,
  // Shared Contracts
  GetPositionSharedContractsResponseData,
  GetChainSharedContractsResponseData,
  // Logs
  ListAutomationLogsResponse,
  // Notifications
  ListNotificationsResponseData,
  UnreadCountResponseData,
  NotificationData,
  MarkAllReadResponseData,
  DeleteNotificationResponseData,
  BulkDeleteNotificationsResponseData,
  // Webhook Config
  WebhookConfigData,
  UpdateWebhookConfigBody,
  TestWebhookResponseData,
  // Notification Types
  NotificationEventType,
  // Wallets
  ListUserWalletsResponseData,
  WalletChallengeResponseData,
  AddWalletResponseData,
  AddWalletRequest,
  DeleteWalletResponseData,
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
  // Close Orders (Position-Scoped)
  // ---------------------------------------------------------------------------

  /**
   * Position-scoped close order operations
   * Uses semantic identifiers (closeOrderHash) instead of database IDs
   */
  positionCloseOrders: {
    /**
     * List close orders for a specific position
     * @param chainId - Chain ID
     * @param nftId - Uniswap V3 NFT token ID
     * @param params - Optional filters (automationState, type)
     */
    list(chainId: number, nftId: string, params?: { automationState?: string; type?: 'sl' | 'tp' }) {
      const searchParams = new URLSearchParams();
      if (params?.automationState) searchParams.set('automationState', params.automationState);
      if (params?.type) searchParams.set('type', params.type);
      const query = searchParams.toString();
      const url = `/api/v1/positions/uniswapv3/${chainId}/${nftId}/close-orders${query ? `?${query}` : ''}`;
      return apiClient.get<ListCloseOrdersResponse['data']>(url);
    },

    /**
     * Get a single close order by semantic hash
     * @param chainId - Chain ID
     * @param nftId - Uniswap V3 NFT token ID
     * @param closeOrderHash - Semantic identifier (e.g., "sl@-12345", "tp@201120")
     */
    get(chainId: number, nftId: string, closeOrderHash: string) {
      return apiClient.get<GetCloseOrderResponse['data']>(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}/close-orders/${closeOrderHash}`
      );
    },

    /**
     * Set automation state for a close order (monitoring or paused)
     * @param chainId - Chain ID
     * @param nftId - Uniswap V3 NFT token ID
     * @param closeOrderHash - Semantic identifier
     * @param automationState - Target state ('monitoring' or 'paused')
     */
    setAutomationState(chainId: number, nftId: string, closeOrderHash: string, automationState: 'monitoring' | 'paused') {
      return apiClient.patch<SerializedCloseOrder>(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}/close-orders/${closeOrderHash}/automation-state`,
        { automationState }
      );
    },

  },

  // ---------------------------------------------------------------------------
  // Vault Close Orders (Position-Scoped)
  // ---------------------------------------------------------------------------

  vaultPositionCloseOrders: {
    /**
     * List close orders for a specific vault position
     * @param chainId - Chain ID
     * @param vaultAddress - Vault contract address
     * @param params - Optional filters (automationState, type)
     */
    list(chainId: number, vaultAddress: string, ownerAddress: string, params?: { automationState?: string; type?: 'sl' | 'tp' }) {
      const searchParams = new URLSearchParams();
      if (params?.automationState) searchParams.set('automationState', params.automationState);
      if (params?.type) searchParams.set('type', params.type);
      const query = searchParams.toString();
      const url = `/api/v1/positions/uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}/close-orders${query ? `?${query}` : ''}`;
      return apiClient.get<ListCloseOrdersResponse['data']>(url);
    },
  },

  // ---------------------------------------------------------------------------
  // Shared Contracts
  // ---------------------------------------------------------------------------

  /**
   * Get shared contracts for a position's chain (DB-backed endpoint)
   * Returns a map of contract names to contract info.
   */
  getPositionSharedContracts(chainId: number, nftId: string) {
    return apiClient.get<GetPositionSharedContractsResponseData>(
      `/api/v1/positions/uniswapv3/${chainId}/${nftId}/close-orders/shared-contracts`
    );
  },

  /**
   * Get shared contracts for a chain (no nftId needed).
   * Use this when you only have a chainId (e.g., before minting a position).
   */
  getChainSharedContracts(chainId: number) {
    return apiClient.get<GetChainSharedContractsResponseData>(
      `/api/v1/automation/shared-contracts/${chainId}`
    );
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

// =============================================================================
// NOTIFICATIONS API
// =============================================================================

/**
 * Notifications API client for managing user notifications and webhook config
 */
export const notificationsApi = {
  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------

  /**
   * List notifications for the current user with pagination
   */
  listNotifications(params: {
    limit?: number;
    cursor?: string;
    eventType?: string;
    isRead?: string;
  } = {}) {
    const qs = buildQueryString(params);
    return apiClient.get<ListNotificationsResponseData>(`/api/v1/notifications${qs}`);
  },

  /**
   * Get unread notification count
   */
  getUnreadCount() {
    return apiClient.get<UnreadCountResponseData>('/api/v1/notifications/unread-count');
  },

  /**
   * Get a single notification by ID
   */
  getNotification(id: string) {
    return apiClient.get<NotificationData>(`/api/v1/notifications/${id}`);
  },

  /**
   * Mark a single notification as read
   */
  markAsRead(id: string) {
    return apiClient.patch<NotificationData>(`/api/v1/notifications/${id}/read`, {});
  },

  /**
   * Mark all notifications as read
   */
  markAllAsRead() {
    return apiClient.post<MarkAllReadResponseData>('/api/v1/notifications/mark-all-read', {});
  },

  /**
   * Delete a single notification
   */
  deleteNotification(id: string) {
    return apiClient.delete<DeleteNotificationResponseData>(`/api/v1/notifications/${id}`);
  },

  /**
   * Bulk delete notifications
   */
  bulkDelete(ids: string[]) {
    // Note: DELETE with body - using request directly
    return request<BulkDeleteNotificationsResponseData>('DELETE', '/api/v1/notifications', { ids });
  },

  // ---------------------------------------------------------------------------
  // Webhook Config
  // ---------------------------------------------------------------------------

  /**
   * Get user's webhook configuration
   */
  getWebhookConfig() {
    return apiClient.get<WebhookConfigData>('/api/v1/user/webhook-config');
  },

  /**
   * Update user's webhook configuration
   */
  updateWebhookConfig(input: UpdateWebhookConfigBody) {
    return apiClient.put<WebhookConfigData>('/api/v1/user/webhook-config', input);
  },

  /**
   * Send a test webhook
   * @param eventType - Optional event type to test (defaults to POSITION_OUT_OF_RANGE)
   */
  testWebhook(eventType?: NotificationEventType) {
    return apiClient.post<TestWebhookResponseData>('/api/v1/user/webhook-config/test', {
      eventType,
    });
  },
};

// =============================================================================
// WALLETS API
// =============================================================================

/**
 * Wallets API client for managing user wallet perimeter
 */
export const walletsApi = {
  /**
   * List all wallets belonging to the authenticated user
   */
  listWallets() {
    return apiClient.get<ListUserWalletsResponseData>('/api/v1/user/wallets');
  },

  /**
   * Request a challenge message for wallet ownership verification
   */
  getChallenge(walletType: string, address: string) {
    return apiClient.post<WalletChallengeResponseData>('/api/v1/user/wallets/challenge', {
      walletType,
      address,
    });
  },

  /**
   * Add a wallet after ownership verification
   */
  addWallet(body: AddWalletRequest) {
    return apiClient.post<AddWalletResponseData>('/api/v1/user/wallets', body);
  },

  /**
   * Remove a non-primary wallet
   */
  deleteWallet(walletId: string) {
    return apiClient.delete<DeleteWalletResponseData>(`/api/v1/user/wallets/${walletId}`);
  },
};
