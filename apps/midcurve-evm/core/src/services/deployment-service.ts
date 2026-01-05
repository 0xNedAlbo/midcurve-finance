/**
 * Deployment Service
 *
 * Orchestrates strategy contract deployment:
 * 1. Fetch deployment data from cache (stored by API)
 * 2. Request signed deployment tx from signer
 * 3. Broadcast transaction to network
 * 4. Wait for confirmation
 * 5. Setup RabbitMQ topology
 * 6. Update cache with final state
 *
 * This service runs operations in the background.
 * API routes return 202 immediately and poll for status.
 *
 * STATE PERSISTENCE: Uses PostgreSQL cache table instead of in-memory Map.
 * This ensures state survives serverless function restarts and is shared
 * across all workers/processes.
 */

import type { Channel } from 'amqplib';
import { createPublicClient, http, type Address, type Hash } from 'viem';
import { CacheService } from '@midcurve/services';
import { logger, evmLog } from '../../../lib/logger';
import { getDatabaseClient } from '../clients/database-client';
import { getSignerClient } from '../clients/signer-client';
import { setupStrategyTopology } from '../mq/topology';

// =============================================================================
// Constants
// =============================================================================

/**
 * SEMSEE chain ID - local EVM only
 */
const SEMSEE_CHAIN_ID = 31337;

/**
 * Deployment state TTL: 24 hours
 * Stale deployments auto-expire after this time
 */
const DEPLOYMENT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Cache key prefix for deployment states
 */
const DEPLOYMENT_CACHE_PREFIX = 'deployment:';

// =============================================================================
// Types
// =============================================================================

export type DeploymentStatus =
  | 'pending'
  | 'signing'
  | 'funding'  // CORE is funding the automation wallet with ETH
  | 'broadcasting'
  | 'confirming'
  | 'setting_up_topology'
  | 'completed'
  | 'failed';

/**
 * Deployment state stored in cache
 * Uses ISO strings for dates (JSON serializable)
 */
export interface DeploymentState {
  deploymentId: string;
  status: DeploymentStatus;
  startedAt: string; // ISO string
  completedAt?: string; // ISO string
  contractAddress?: string;
  txHash?: string;
  error?: string;
  // Deployment request data (stored by API, used for strategy creation)
  manifest?: unknown;
  name?: string;
  userId?: string;
  quoteTokenId?: string;
  constructorValues?: Record<string, string>;
  // Automation wallet info (added by signer during signing)
  automationWallet?: {
    walletAddress: string;
    kmsKeyId: string;
  };
  // Set to true when Strategy record has been created
  strategyCreated?: boolean;
  strategyId?: string;
}

export interface DeploymentInput {
  deploymentId: string;
}

// =============================================================================
// Error
// =============================================================================

export class DeploymentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'DeploymentError';
  }
}

// =============================================================================
// Service
// =============================================================================

class DeploymentService {
  private readonly log = logger.child({ service: 'DeploymentService' });
  private readonly cache = CacheService.getInstance();

  /**
   * Get the cache key for a deployment
   */
  private getCacheKey(deploymentId: string): string {
    return `${DEPLOYMENT_CACHE_PREFIX}${deploymentId}`;
  }

  /**
   * Get the current state of a deployment from cache
   */
  async getDeploymentState(deploymentId: string): Promise<DeploymentState | null> {
    return this.cache.get<DeploymentState>(this.getCacheKey(deploymentId));
  }

  /**
   * Update deployment state in cache
   */
  private async updateState(
    deploymentId: string,
    updates: Partial<DeploymentState>
  ): Promise<void> {
    const current = await this.cache.get<DeploymentState>(this.getCacheKey(deploymentId));
    if (current) {
      await this.cache.set(
        this.getCacheKey(deploymentId),
        { ...current, ...updates },
        DEPLOYMENT_TTL_SECONDS
      );
    }
  }

  /**
   * Start a deployment (non-blocking)
   *
   * PREREQUISITE: Deployment state must already exist in cache (created by API).
   * This method reads the state and starts the deployment process.
   *
   * Returns immediately with current state.
   * Use getDeploymentState() to poll for progress.
   */
  async startDeployment(
    input: DeploymentInput,
    channel: Channel
  ): Promise<DeploymentState> {
    const { deploymentId } = input;
    evmLog.methodEntry(this.log, 'startDeployment', { deploymentId });

    // Get existing deployment state from cache
    const existing = await this.cache.get<DeploymentState>(this.getCacheKey(deploymentId));

    if (!existing) {
      throw new DeploymentError(
        `Deployment '${deploymentId}' not found in cache`,
        'DEPLOYMENT_NOT_FOUND',
        404
      );
    }

    // Check if deployment already in progress or completed
    if (!['pending', 'completed', 'failed'].includes(existing.status)) {
      this.log.warn({ deploymentId, status: existing.status, msg: 'Deployment already in progress' });
      return existing;
    }

    // If already completed/failed, just return the state
    if (['completed', 'failed'].includes(existing.status)) {
      this.log.info({ deploymentId, status: existing.status, msg: 'Deployment already finished' });
      return existing;
    }

    // Run deployment in background (don't await)
    this.runDeployment(deploymentId, channel).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorCode = (error as { code?: string })?.code;
      const errorCause = error instanceof Error && error.cause
        ? (error.cause instanceof Error ? error.cause.message : String(error.cause))
        : undefined;

      this.log.error({
        deploymentId,
        error: errorMessage,
        errorCode,
        errorCause,
        errorStack,
        msg: 'Deployment failed'
      });

      // Update cache with failed state
      this.updateState(deploymentId, {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      }).catch((cacheError) => {
        this.log.error({ deploymentId, error: cacheError, msg: 'Failed to update cache with error state' });
      });
    });

    evmLog.methodExit(this.log, 'startDeployment', { status: existing.status });
    return existing;
  }

  /**
   * Run the deployment process
   */
  private async runDeployment(
    deploymentId: string,
    channel: Channel
  ): Promise<void> {
    try {
      // Step 1: Fetch deployment data from cache
      this.log.info({ deploymentId, msg: 'Fetching deployment data from cache' });
      const deployment = await this.cache.get<DeploymentState>(this.getCacheKey(deploymentId));

      if (!deployment) {
        throw new DeploymentError(
          `Deployment '${deploymentId}' not found`,
          'DEPLOYMENT_NOT_FOUND',
          404
        );
      }

      if (!deployment.manifest) {
        throw new DeploymentError(
          `Deployment '${deploymentId}' has no manifest`,
          'NO_MANIFEST',
          400
        );
      }

      // Step 2: Sign deployment transaction (may return needsFunding)
      await this.updateState(deploymentId, { status: 'signing' });
      this.log.info({ deploymentId, msg: 'Signing deployment transaction' });

      const signerClient = getSignerClient();
      let signResult = await signerClient.signDeployment({
        strategyId: deploymentId,
      });

      // Step 2.5: Fund automation wallet if needed
      if (signResult.needsFunding && signResult.walletAddress) {
        await this.updateState(deploymentId, { status: 'funding' });
        await this.fundWallet(signResult.walletAddress, '1'); // 1 ETH

        // Retry signing now that wallet is funded
        this.log.info({ deploymentId, msg: 'Retrying signing after funding' });
        signResult = await signerClient.signDeployment({
          strategyId: deploymentId,
        });

        // If still needs funding, something went wrong
        if (signResult.needsFunding) {
          throw new DeploymentError(
            'Wallet still needs funding after funding attempt',
            'FUNDING_FAILED',
            500
          );
        }
      }

      await this.updateState(deploymentId, {
        contractAddress: signResult.predictedAddress,
        txHash: signResult.txHash,
      });

      // Step 3: Broadcast transaction
      await this.updateState(deploymentId, { status: 'broadcasting' });
      this.log.info({
        deploymentId,
        predictedAddress: signResult.predictedAddress,
        msg: 'Broadcasting transaction',
      });

      const publicClient = this.createPublicClient();

      const txHash = await publicClient.sendRawTransaction({
        serializedTransaction: signResult.signedTransaction,
      });

      // Step 4: Wait for confirmation
      await this.updateState(deploymentId, { status: 'confirming' });
      this.log.info({ deploymentId, txHash, msg: 'Waiting for confirmation' });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
      });

      if (receipt.status === 'reverted') {
        throw new DeploymentError(
          'Deployment transaction reverted',
          'TX_REVERTED',
          500
        );
      }

      // Verify contract address matches prediction
      let contractAddress = signResult.predictedAddress;
      if (
        receipt.contractAddress?.toLowerCase() !==
        signResult.predictedAddress.toLowerCase()
      ) {
        this.log.warn({
          deploymentId,
          predicted: signResult.predictedAddress,
          actual: receipt.contractAddress,
          msg: 'Contract address mismatch',
        });
        contractAddress = receipt.contractAddress as Address;
        await this.updateState(deploymentId, { contractAddress });
      }

      // Step 5: Setup RabbitMQ topology
      await this.updateState(deploymentId, { status: 'setting_up_topology' });
      this.log.info({
        deploymentId,
        contractAddress,
        msg: 'Setting up RabbitMQ topology',
      });

      await setupStrategyTopology(channel, contractAddress);

      // Complete
      await this.updateState(deploymentId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        contractAddress,
        txHash,
      });

      this.log.info({
        deploymentId,
        contractAddress,
        txHash,
        msg: 'Deployment completed',
      });
    } catch (error) {
      await this.updateState(deploymentId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Create a public client for SEMSEE chain
   */
  private createPublicClient() {
    const rpcUrl = process.env.SEMSEE_RPC_URL || 'http://localhost:8555';
    const chain = {
      id: SEMSEE_CHAIN_ID,
      name: 'SEMSEE',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [rpcUrl] },
      },
    } as const;

    return createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
  }

  /**
   * Fund a wallet via the /api/wallets/fund endpoint
   *
   * This endpoint uses CORE_PRIVATE_KEY to send ETH from the CORE account
   * (which has unlimited ETH on SEMSEE) to the specified wallet address.
   *
   * @param walletAddress - The wallet address to fund
   * @param amountEth - Amount of ETH to send (default: 1)
   */
  private async fundWallet(walletAddress: string, amountEth: string): Promise<void> {
    this.log.info({ walletAddress, amountEth, msg: 'Funding automation wallet' });

    // Call the internal API endpoint (same service)
    const evmServiceUrl = process.env.EVM_SERVICE_URL || 'http://localhost:3002';
    const response = await fetch(`${evmServiceUrl}/api/wallets/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, amountEth }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new DeploymentError(
        `Failed to fund wallet: ${errorData.error || response.statusText}`,
        'FUNDING_FAILED',
        500
      );
    }

    const result = await response.json();
    this.log.info({
      walletAddress,
      amountEth,
      txHash: result.txHash,
      msg: 'Automation wallet funded',
    });
  }

  /**
   * Clear deployment states by pattern (for cleanup)
   */
  async clearDeployments(pattern?: string): Promise<number> {
    return this.cache.clear(pattern || DEPLOYMENT_CACHE_PREFIX);
  }
}

// =============================================================================
// Singleton (survives Next.js HMR in development)
// =============================================================================

// Use globalThis to prevent singleton from being reset during Hot Module Reloading
const globalForDeploymentService = globalThis as unknown as {
  deploymentService: DeploymentService | undefined;
};

export function getDeploymentService(): DeploymentService {
  if (!globalForDeploymentService.deploymentService) {
    globalForDeploymentService.deploymentService = new DeploymentService();
  }
  return globalForDeploymentService.deploymentService;
}

export { DeploymentService };
