/**
 * Deployment Service
 *
 * Orchestrates strategy contract deployment:
 * 1. Fetch strategy data from database
 * 2. Request signed deployment tx from signer
 * 3. Broadcast transaction to network
 * 4. Wait for confirmation
 * 5. Setup RabbitMQ topology
 *
 * This service runs operations in the background.
 * API routes return 202 immediately and poll for status.
 */

import type { Channel } from 'amqplib';
import { createPublicClient, http, type Address, type Hex, type Hash } from 'viem';
import { logger, evmLog } from '../../../lib/logger';
import { getDatabaseClient, type StrategyDeploymentData } from '../clients/database-client';
import { getSignerClient } from '../clients/signer-client';
import { setupStrategyTopology } from '../mq/topology';

// =============================================================================
// Constants
// =============================================================================

/**
 * SEMSEE chain ID - local EVM only
 */
const SEMSEE_CHAIN_ID = 31337;

// =============================================================================
// Types
// =============================================================================

export type DeploymentStatus =
  | 'pending'
  | 'signing'
  | 'broadcasting'
  | 'confirming'
  | 'setting_up_topology'
  | 'completed'
  | 'failed';

export interface DeploymentState {
  strategyId: string;
  status: DeploymentStatus;
  startedAt: Date;
  completedAt?: Date;
  contractAddress?: Address;
  txHash?: Hash;
  error?: string;
}

export interface DeploymentInput {
  strategyId: string;
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

  /** Active deployments by strategyId */
  private readonly deployments = new Map<string, DeploymentState>();

  /**
   * Get the current state of a deployment
   */
  getDeploymentState(strategyId: string): DeploymentState | undefined {
    return this.deployments.get(strategyId);
  }

  /**
   * Start a deployment (non-blocking)
   *
   * Returns immediately with initial state.
   * Use getDeploymentState() to poll for progress.
   */
  async startDeployment(
    input: DeploymentInput,
    channel: Channel
  ): Promise<DeploymentState> {
    const { strategyId } = input;
    evmLog.methodEntry(this.log, 'startDeployment', { strategyId });

    // Check if deployment already in progress
    const existing = this.deployments.get(strategyId);
    if (existing && !['completed', 'failed'].includes(existing.status)) {
      this.log.warn({ strategyId, status: existing.status, msg: 'Deployment already in progress' });
      return existing;
    }

    // Create initial state
    const state: DeploymentState = {
      strategyId,
      status: 'pending',
      startedAt: new Date(),
    };
    this.deployments.set(strategyId, state);

    // Run deployment in background
    this.runDeployment(input, channel).catch((error) => {
      this.log.error({ strategyId, error, msg: 'Deployment failed' });
      const currentState = this.deployments.get(strategyId);
      if (currentState) {
        currentState.status = 'failed';
        currentState.error = error instanceof Error ? error.message : 'Unknown error';
        currentState.completedAt = new Date();
      }
    });

    evmLog.methodExit(this.log, 'startDeployment', { status: state.status });
    return state;
  }

  /**
   * Run the deployment process
   */
  private async runDeployment(
    input: DeploymentInput,
    channel: Channel
  ): Promise<void> {
    const { strategyId } = input;
    const state = this.deployments.get(strategyId)!;

    try {
      // Step 1: Fetch strategy data
      this.log.info({ strategyId, msg: 'Fetching strategy data' });
      const dbClient = getDatabaseClient();
      const strategy = await dbClient.getStrategyForDeployment(strategyId);

      if (!strategy) {
        throw new DeploymentError(
          `Strategy '${strategyId}' not found`,
          'STRATEGY_NOT_FOUND',
          404
        );
      }

      if (strategy.status !== 'deploying') {
        throw new DeploymentError(
          `Strategy is in '${strategy.status}' state, expected 'deploying'`,
          'INVALID_STATE',
          400
        );
      }

      if (!strategy.manifest) {
        throw new DeploymentError(
          `Strategy '${strategyId}' has no manifest`,
          'NO_MANIFEST',
          400
        );
      }

      // Step 2: Sign deployment transaction
      state.status = 'signing';
      this.log.info({ strategyId, msg: 'Signing deployment transaction' });

      const signerClient = getSignerClient();
      const signResult = await signerClient.signDeployment({
        strategyId,
      });

      state.contractAddress = signResult.predictedAddress;
      state.txHash = signResult.txHash;

      // Step 3: Broadcast transaction
      state.status = 'broadcasting';
      this.log.info({
        strategyId,
        predictedAddress: signResult.predictedAddress,
        msg: 'Broadcasting transaction',
      });

      const publicClient = this.createPublicClient();

      const txHash = await publicClient.sendRawTransaction({
        serializedTransaction: signResult.signedTransaction,
      });

      // Step 4: Wait for confirmation
      state.status = 'confirming';
      this.log.info({ strategyId, txHash, msg: 'Waiting for confirmation' });

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
      if (
        receipt.contractAddress?.toLowerCase() !==
        signResult.predictedAddress.toLowerCase()
      ) {
        this.log.warn({
          strategyId,
          predicted: signResult.predictedAddress,
          actual: receipt.contractAddress,
          msg: 'Contract address mismatch',
        });
        state.contractAddress = receipt.contractAddress as Address;
      }

      // Step 5: Setup RabbitMQ topology
      state.status = 'setting_up_topology';
      this.log.info({
        strategyId,
        contractAddress: state.contractAddress,
        msg: 'Setting up RabbitMQ topology',
      });

      await setupStrategyTopology(channel, state.contractAddress!);

      // Complete
      state.status = 'completed';
      state.completedAt = new Date();

      this.log.info({
        strategyId,
        contractAddress: state.contractAddress,
        txHash,
        msg: 'Deployment completed',
      });
    } catch (error) {
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : 'Unknown error';
      state.completedAt = new Date();
      throw error;
    }
  }

  /**
   * Create a public client for SEMSEE chain
   */
  private createPublicClient() {
    const rpcUrl = process.env.SEMSEE_RPC_URL || 'http://localhost:8545';
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
   * Clear completed/failed deployments from memory
   */
  cleanup(): void {
    for (const [id, state] of this.deployments) {
      if (['completed', 'failed'].includes(state.status)) {
        // Keep for 1 hour after completion
        const completedAt = state.completedAt?.getTime() ?? 0;
        if (Date.now() - completedAt > 3600000) {
          this.deployments.delete(id);
        }
      }
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let deploymentServiceInstance: DeploymentService | null = null;

export function getDeploymentService(): DeploymentService {
  if (!deploymentServiceInstance) {
    deploymentServiceInstance = new DeploymentService();
  }
  return deploymentServiceInstance;
}

export { DeploymentService };
