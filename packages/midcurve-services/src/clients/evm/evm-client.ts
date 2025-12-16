/**
 * EVM Client
 *
 * HTTP client for calling midcurve-evm API endpoints.
 * Used by midcurve-services to orchestrate strategy lifecycle.
 *
 * Endpoints:
 * - PUT /api/strategy - Deploy strategy contract
 * - GET /api/strategy/:addr - Get strategy status
 * - POST /api/strategy/:addr/start - Start strategy
 * - POST /api/strategy/:addr/shutdown - Shutdown strategy
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Strategy status from EVM API
 */
export type EvmStrategyStatus =
  | 'pending'
  | 'deploying'
  | 'deployed'
  | 'starting'
  | 'active'
  | 'shutting_down'
  | 'shutdown';

/**
 * Deploy request input
 */
export interface DeployStrategyInput {
  strategyId: string;
  chainId?: number;
  ownerAddress: string;
}

/**
 * Deploy response
 */
export interface DeployStrategyResponse {
  strategyId: string;
  status: string;
  contractAddress?: string;
  txHash?: string;
  pollUrl: string;
  error?: string;
}

/**
 * Strategy status response
 */
export interface StrategyStatusResponse {
  id: string;
  contractAddress: string;
  status: EvmStrategyStatus;
  chainId: number;
  deployedAt?: string;
  loopRunning?: boolean;
  loopStatus?: string;
  epoch?: number;
  eventsProcessed?: number;
  effectsProcessed?: number;
  operation?: string;
  operationStatus?: string;
  error?: string;
}

/**
 * Lifecycle operation response
 */
export interface LifecycleOperationResponse {
  contractAddress: string;
  operation: 'start' | 'shutdown';
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  pollUrl: string;
}

/**
 * EVM client configuration
 */
export interface EvmClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

// =============================================================================
// Error
// =============================================================================

export class EvmClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'EvmClientError';
  }
}

// =============================================================================
// Client
// =============================================================================

export class EvmClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeout: number;

  constructor(config: EvmClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Deploy a strategy contract
   *
   * @param input - Deployment input
   * @returns Deployment response (poll for status)
   */
  async deployStrategy(input: DeployStrategyInput): Promise<DeployStrategyResponse> {
    return this.request<DeployStrategyResponse>('PUT', '/api/strategy', input);
  }

  /**
   * Get strategy status by contract address
   *
   * @param contractAddress - Strategy contract address
   * @returns Strategy status
   */
  async getStrategyStatus(contractAddress: string): Promise<StrategyStatusResponse> {
    return this.request<StrategyStatusResponse>(
      'GET',
      `/api/strategy/${contractAddress.toLowerCase()}`
    );
  }

  /**
   * Get deployment status by strategy ID (when contract address not yet known)
   *
   * @param strategyId - Strategy ID
   * @returns Deployment status
   */
  async getDeploymentStatus(strategyId: string): Promise<DeployStrategyResponse> {
    return this.request<DeployStrategyResponse>(
      'GET',
      `/api/strategy?strategyId=${encodeURIComponent(strategyId)}`
    );
  }

  /**
   * Start a strategy
   *
   * @param contractAddress - Strategy contract address
   * @returns Lifecycle operation response (poll for status)
   */
  async startStrategy(contractAddress: string): Promise<LifecycleOperationResponse> {
    return this.request<LifecycleOperationResponse>(
      'POST',
      `/api/strategy/${contractAddress.toLowerCase()}/start`
    );
  }

  /**
   * Shutdown a strategy
   *
   * @param contractAddress - Strategy contract address
   * @returns Lifecycle operation response (poll for status)
   */
  async shutdownStrategy(contractAddress: string): Promise<LifecycleOperationResponse> {
    return this.request<LifecycleOperationResponse>(
      'POST',
      `/api/strategy/${contractAddress.toLowerCase()}/shutdown`
    );
  }

  /**
   * Poll for deployment completion
   *
   * @param strategyId - Strategy ID
   * @param intervalMs - Polling interval (default 1000ms)
   * @param timeoutMs - Overall timeout (default 120000ms)
   * @returns Final deployment response
   */
  async waitForDeployment(
    strategyId: string,
    intervalMs = 1000,
    timeoutMs = 120000
  ): Promise<DeployStrategyResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const response = await this.getDeploymentStatus(strategyId);

      if (response.status === 'completed' || response.status === 'failed') {
        return response;
      }

      await this.sleep(intervalMs);
    }

    throw new EvmClientError(
      'Deployment timeout',
      408,
      'DEPLOYMENT_TIMEOUT'
    );
  }

  /**
   * Poll for lifecycle operation completion
   *
   * @param contractAddress - Strategy contract address
   * @param intervalMs - Polling interval (default 1000ms)
   * @param timeoutMs - Overall timeout (default 120000ms)
   * @returns Final strategy status
   */
  async waitForOperation(
    contractAddress: string,
    intervalMs = 1000,
    timeoutMs = 120000
  ): Promise<StrategyStatusResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const response = await this.getStrategyStatus(contractAddress);

      // Check if status is stable (not transitional)
      const stableStatuses: EvmStrategyStatus[] = ['deployed', 'active', 'shutdown'];
      if (stableStatuses.includes(response.status)) {
        return response;
      }

      // Check for error
      if (response.error) {
        throw new EvmClientError(
          response.error,
          500,
          'OPERATION_FAILED'
        );
      }

      await this.sleep(intervalMs);
    }

    throw new EvmClientError(
      'Operation timeout',
      408,
      'OPERATION_TIMEOUT'
    );
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const options: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({}));

      // 202 is a valid response for async operations
      if (!response.ok && response.status !== 202) {
        throw new EvmClientError(
          data.error || `EVM API request failed: ${response.status}`,
          response.status,
          data.code,
          data
        );
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof EvmClientError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new EvmClientError('Request timeout', 408, 'TIMEOUT');
      }

      throw new EvmClientError(
        error instanceof Error ? error.message : 'Unknown error',
        500,
        'NETWORK_ERROR',
        error
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Factory
// =============================================================================

let evmClientInstance: EvmClient | null = null;

/**
 * Get the singleton EVM client instance
 */
export function getEvmClient(): EvmClient {
  if (!evmClientInstance) {
    const baseUrl = process.env.EVM_SERVICE_URL;
    if (!baseUrl) {
      throw new Error('EVM_SERVICE_URL environment variable is required');
    }

    evmClientInstance = new EvmClient({
      baseUrl,
      apiKey: process.env.EVM_INTERNAL_API_KEY,
      timeout: 30000,
    });
  }

  return evmClientInstance;
}
