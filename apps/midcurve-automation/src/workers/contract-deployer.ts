/**
 * Contract Deployer Worker
 *
 * Polls for pending automation contracts and deploys them.
 * Handles UniswapV3PositionCloser contract deployments.
 *
 * NOTE: This is a stub implementation. The AutomationContractService
 * needs additional methods (findPendingDeployment, markDeploying, markFailed)
 * to fully support automated deployment. For now, contracts are deployed
 * via the API when users first create close orders.
 */

import { getAutomationContractService } from '../lib/services';
import { broadcastTransaction, waitForTransaction, type SupportedChainId } from '../lib/evm';
import { isSupportedChain, getWorkerConfig } from '../lib/config';
import { automationLogger, autoLog } from '../lib/logger';
import { getSignerClient } from '../clients/signer-client';

const log = automationLogger.child({ component: 'ContractDeployer' });

// =============================================================================
// Types
// =============================================================================

export interface ContractDeployerStatus {
  status: 'idle' | 'running' | 'stopping' | 'stopped';
  pendingContracts: number;
  deployedTotal: number;
  failedTotal: number;
  lastPollAt: string | null;
  pollIntervalMs: number;
}

// =============================================================================
// Worker
// =============================================================================

export class ContractDeployer {
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private pollIntervalMs: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private pendingContracts = 0;
  private deployedTotal = 0;
  private failedTotal = 0;
  private lastPollAt: Date | null = null;

  constructor() {
    const config = getWorkerConfig();
    this.pollIntervalMs = config.deployPollIntervalMs;
  }

  /**
   * Start the contract deployer
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      log.warn({ msg: 'ContractDeployer already running' });
      return;
    }

    autoLog.workerLifecycle(log, 'ContractDeployer', 'starting');
    this.status = 'running';

    // Start polling loop
    this.schedulePoll();

    autoLog.workerLifecycle(log, 'ContractDeployer', 'started', {
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  /**
   * Stop the contract deployer
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    autoLog.workerLifecycle(log, 'ContractDeployer', 'stopping');
    this.status = 'stopping';

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.status = 'stopped';
    autoLog.workerLifecycle(log, 'ContractDeployer', 'stopped');
  }

  /**
   * Get current status
   */
  getStatus(): ContractDeployerStatus {
    return {
      status: this.status,
      pendingContracts: this.pendingContracts,
      deployedTotal: this.deployedTotal,
      failedTotal: this.failedTotal,
      lastPollAt: this.lastPollAt?.toISOString() || null,
      pollIntervalMs: this.pollIntervalMs,
    };
  }

  /**
   * Schedule next poll
   */
  private schedulePoll(): void {
    if (this.status !== 'running') {
      return;
    }

    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll();
      } catch (err) {
        autoLog.methodError(log, 'poll', err);
      }

      // Schedule next poll
      this.schedulePoll();
    }, this.pollIntervalMs);
  }

  /**
   * Execute one poll cycle
   *
   * NOTE: Contract deployment is currently handled synchronously via API
   * when users create their first close order. This worker is a placeholder
   * for future async deployment functionality.
   */
  private async poll(): Promise<void> {
    this.lastPollAt = new Date();
    this.pendingContracts = 0;

    // TODO: When AutomationContractService has findPendingDeployment,
    // this worker will poll for and deploy pending contracts.
    // For now, contracts are deployed via the API.
  }

  /**
   * Deploy a single automation contract
   *
   * Called when processing a pending deployment (future functionality)
   * or can be called directly for manual deployment.
   */
  async deployContract(
    contractId: string,
    userId: string,
    chainId: number,
    nfpmAddress: string,
    operatorAddress: string
  ): Promise<string> {
    const automationContractService = getAutomationContractService();
    const signerClient = getSignerClient();

    // Validate chain support
    if (!isSupportedChain(chainId)) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    log.info({
      contractId,
      userId,
      chainId,
      nfpmAddress,
      msg: 'Deploying automation contract',
    });

    // Sign deployment transaction
    const signedTx = await signerClient.deployCloser({
      userId,
      chainId,
      nfpmAddress,
    });

    log.info({
      contractId,
      predictedAddress: signedTx.predictedAddress,
      msg: 'Got signed deployment transaction',
    });

    // Broadcast transaction
    const txHash = await broadcastTransaction(
      chainId as SupportedChainId,
      signedTx.signedTransaction as `0x${string}`
    );

    log.info({
      contractId,
      txHash,
      msg: 'Broadcast deployment transaction',
    });

    // Wait for confirmation
    const receipt = await waitForTransaction(chainId as SupportedChainId, txHash);

    if (receipt.status === 'reverted') {
      throw new Error(`Deployment transaction reverted: ${txHash}`);
    }

    // Mark as deployed
    await automationContractService.markDeployed(contractId, {
      contractAddress: signedTx.predictedAddress!,
      deploymentTxHash: txHash,
      operatorAddress,
      nfpmAddress,
    });

    this.deployedTotal++;

    log.info({
      contractId,
      contractAddress: signedTx.predictedAddress,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      msg: 'Contract deployed successfully',
    });

    return signedTx.predictedAddress!;
  }
}
