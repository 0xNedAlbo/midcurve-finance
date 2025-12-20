/**
 * Lifecycle Service
 *
 * Orchestrates strategy lifecycle operations:
 * - Start: Create loop, publish LIFECYCLE_START event
 * - Shutdown: Publish LIFECYCLE_SHUTDOWN event, stop loop, teardown topology
 *
 * Operations are non-blocking. API routes return 202 and poll for status.
 */

import type { Channel } from 'amqplib';
import { createPublicClient, http, type Address, type Abi } from 'viem';
import { logger, evmLog } from '../../../lib/logger';
import { getDatabaseClient } from '../clients/database-client';
import { getSignerClient } from '../clients/signer-client';
import { getLoopRegistry, type LoopStatus } from '../registry/loop-registry';
import { StrategyLoop } from '../orchestrator/strategy-loop';
import {
  EXCHANGES,
  ROUTING_KEYS,
  teardownStrategyTopology,
} from '../mq/topology';
import {
  createLifecycleEvent,
  LIFECYCLE_START,
  LIFECYCLE_SHUTDOWN,
  serializeMessage,
} from '../mq/messages';
import type { StrategyManifest } from '../types/manifest';

// =============================================================================
// Types
// =============================================================================

export type LifecycleOperationStatus =
  | 'pending'
  | 'publishing_event'
  | 'waiting_for_transition'
  | 'starting_loop'
  | 'stopping_loop'
  | 'teardown_topology'
  | 'completed'
  | 'failed';

export interface LifecycleOperationState {
  contractAddress: Address;
  operation: 'start' | 'shutdown';
  status: LifecycleOperationStatus;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

// =============================================================================
// Error
// =============================================================================

export class LifecycleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'LifecycleError';
  }
}

// =============================================================================
// Service
// =============================================================================

class LifecycleService {
  private readonly log = logger.child({ service: 'LifecycleService' });

  /** Active operations by contract address */
  private readonly operations = new Map<Address, LifecycleOperationState>();

  /**
   * Get the current state of a lifecycle operation
   */
  getOperationState(contractAddress: Address): LifecycleOperationState | undefined {
    const normalized = contractAddress.toLowerCase() as Address;
    return this.operations.get(normalized);
  }

  /**
   * Start a strategy (non-blocking)
   *
   * 1. Create StrategyLoop
   * 2. Register in LoopRegistry
   * 3. Start loop (background)
   * 4. Publish LIFECYCLE_START event
   */
  async startStrategy(
    contractAddress: Address,
    channel: Channel
  ): Promise<LifecycleOperationState> {
    evmLog.methodEntry(this.log, 'startStrategy', { contractAddress });

    const normalized = contractAddress.toLowerCase() as Address;

    // Check if operation already in progress
    const existing = this.operations.get(normalized);
    if (existing && !['completed', 'failed'].includes(existing.status)) {
      this.log.warn({
        contractAddress,
        status: existing.status,
        msg: 'Operation already in progress',
      });
      return existing;
    }

    // Create initial state
    const state: LifecycleOperationState = {
      contractAddress: normalized,
      operation: 'start',
      status: 'pending',
      startedAt: new Date(),
    };
    this.operations.set(normalized, state);

    // Run in background
    this.runStart(normalized, channel).catch((error) => {
      this.log.error({ contractAddress, error, msg: 'Start operation failed' });
      const currentState = this.operations.get(normalized);
      if (currentState) {
        currentState.status = 'failed';
        currentState.error = error instanceof Error ? error.message : 'Unknown error';
        currentState.completedAt = new Date();
      }
    });

    evmLog.methodExit(this.log, 'startStrategy', { status: state.status });
    return state;
  }

  /**
   * Shutdown a strategy (non-blocking)
   *
   * 1. Publish LIFECYCLE_SHUTDOWN event
   * 2. Wait for on-chain transition to SHUTDOWN
   * 3. Stop loop
   * 4. Teardown RabbitMQ topology
   */
  async shutdownStrategy(
    contractAddress: Address,
    channel: Channel
  ): Promise<LifecycleOperationState> {
    evmLog.methodEntry(this.log, 'shutdownStrategy', { contractAddress });

    const normalized = contractAddress.toLowerCase() as Address;

    // Check if operation already in progress
    const existing = this.operations.get(normalized);
    if (existing && !['completed', 'failed'].includes(existing.status)) {
      this.log.warn({
        contractAddress,
        status: existing.status,
        msg: 'Operation already in progress',
      });
      return existing;
    }

    // Create initial state
    const state: LifecycleOperationState = {
      contractAddress: normalized,
      operation: 'shutdown',
      status: 'pending',
      startedAt: new Date(),
    };
    this.operations.set(normalized, state);

    // Run in background
    this.runShutdown(normalized, channel).catch((error) => {
      this.log.error({ contractAddress, error, msg: 'Shutdown operation failed' });
      const currentState = this.operations.get(normalized);
      if (currentState) {
        currentState.status = 'failed';
        currentState.error = error instanceof Error ? error.message : 'Unknown error';
        currentState.completedAt = new Date();
      }
    });

    evmLog.methodExit(this.log, 'shutdownStrategy', { status: state.status });
    return state;
  }

  // =============================================================================
  // Internal Operations
  // =============================================================================

  /**
   * Run the start operation
   */
  private async runStart(
    contractAddress: Address,
    channel: Channel
  ): Promise<void> {
    const state = this.operations.get(contractAddress)!;

    try {
      // Fetch strategy data
      const dbClient = getDatabaseClient();
      const strategy = await dbClient.getStrategyByAddress(contractAddress);

      if (!strategy) {
        throw new LifecycleError(
          `Strategy with address '${contractAddress}' not found`,
          'STRATEGY_NOT_FOUND',
          404
        );
      }

      // Allow start from 'deployed' or 'shutdown' states
      if (!['deployed', 'shutdown'].includes(strategy.status)) {
        throw new LifecycleError(
          `Cannot start strategy in '${strategy.status}' state`,
          'INVALID_STATE',
          400
        );
      }

      if (!strategy.manifest) {
        throw new LifecycleError(
          `Strategy has no manifest`,
          'NO_MANIFEST',
          400
        );
      }

      // Validate vault if strategy requires funding
      const manifest = strategy.manifest as unknown as StrategyManifest;
      if (manifest.fundingToken) {
        await this.validateVaultBeforeStart(strategy.id, manifest);
      }

      // Create and register loop
      state.status = 'starting_loop';
      this.log.info({ contractAddress, msg: 'Creating strategy loop' });

      const registry = getLoopRegistry();

      // Check if loop already exists
      if (registry.has(contractAddress)) {
        const existingEntry = registry.get(contractAddress)!;
        if (existingEntry.status === 'running') {
          throw new LifecycleError(
            'Strategy loop already running',
            'LOOP_ALREADY_RUNNING',
            409
          );
        }
        // Remove stale entry
        registry.unregister(contractAddress);
      }

      const rpcUrl = process.env.SEMSEE_RPC_URL || 'http://localhost:8545';
      const chainId = strategy.chainId ?? 31337;

      // Determine signing mode: use signer API if SIGNER_SERVICE_URL is set
      // Otherwise fall back to local private key (development mode)
      const signerServiceUrl = process.env.SIGNER_SERVICE_URL;
      const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;

      let loop: StrategyLoop;

      if (signerServiceUrl) {
        // Production mode: use signer API
        const signerClient = getSignerClient();
        loop = new StrategyLoop({
          strategyAddress: contractAddress,
          channel,
          strategyId: strategy.id,
          signerClient,
          rpcUrl,
          chainId,
          abi: strategy.manifest.abi as readonly unknown[],
        });
        this.log.info({ contractAddress, msg: 'Using signer API for transaction signing' });
      } else if (operatorPrivateKey) {
        // Development mode: use local private key
        loop = new StrategyLoop({
          strategyAddress: contractAddress,
          channel,
          operatorPrivateKey: operatorPrivateKey as `0x${string}`,
          rpcUrl,
          chainId,
          abi: strategy.manifest.abi as readonly unknown[],
        });
        this.log.info({ contractAddress, msg: 'Using local private key for transaction signing' });
      } else {
        throw new LifecycleError(
          'Neither SIGNER_SERVICE_URL nor OPERATOR_PRIVATE_KEY configured',
          'CONFIG_ERROR',
          500
        );
      }

      registry.register(strategy.id, contractAddress, loop);

      // Start loop (non-blocking)
      loop.start().then(() => {
        registry.updateStatus(contractAddress, 'stopped');
      }).catch((error) => {
        this.log.error({ contractAddress, error, msg: 'Loop crashed' });
        registry.updateStatus(
          contractAddress,
          'error',
          error instanceof Error ? error.message : 'Unknown error'
        );
      });

      registry.updateStatus(contractAddress, 'running');

      // Publish LIFECYCLE_START event
      state.status = 'publishing_event';
      this.log.info({ contractAddress, msg: 'Publishing LIFECYCLE_START event' });

      const startEvent = createLifecycleEvent(LIFECYCLE_START);
      const routingKey = ROUTING_KEYS.lifecycle(contractAddress);

      channel.publish(
        EXCHANGES.EVENTS,
        routingKey,
        serializeMessage(startEvent),
        { persistent: true }
      );

      // Complete
      state.status = 'completed';
      state.completedAt = new Date();

      this.log.info({ contractAddress, msg: 'Strategy started' });
    } catch (error) {
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : 'Unknown error';
      state.completedAt = new Date();
      throw error;
    }
  }

  /**
   * Run the shutdown operation
   */
  private async runShutdown(
    contractAddress: Address,
    channel: Channel
  ): Promise<void> {
    const state = this.operations.get(contractAddress)!;

    try {
      // Fetch strategy data
      const dbClient = getDatabaseClient();
      const strategy = await dbClient.getStrategyByAddress(contractAddress);

      if (!strategy) {
        throw new LifecycleError(
          `Strategy with address '${contractAddress}' not found`,
          'STRATEGY_NOT_FOUND',
          404
        );
      }

      if (strategy.status !== 'active') {
        throw new LifecycleError(
          `Cannot shutdown strategy in '${strategy.status}' state`,
          'INVALID_STATE',
          400
        );
      }

      // Publish LIFECYCLE_SHUTDOWN event
      state.status = 'publishing_event';
      this.log.info({ contractAddress, msg: 'Publishing LIFECYCLE_SHUTDOWN event' });

      const shutdownEvent = createLifecycleEvent(LIFECYCLE_SHUTDOWN);
      const routingKey = ROUTING_KEYS.lifecycle(contractAddress);

      channel.publish(
        EXCHANGES.EVENTS,
        routingKey,
        serializeMessage(shutdownEvent),
        { persistent: true }
      );

      // Wait for on-chain transition (poll contract)
      state.status = 'waiting_for_transition';
      this.log.info({ contractAddress, msg: 'Waiting for on-chain shutdown' });

      const chainId = strategy.chainId ?? 31337;
      await this.waitForShutdown(contractAddress, chainId, strategy.manifest?.abi as Abi);

      // Stop the loop
      state.status = 'stopping_loop';
      this.log.info({ contractAddress, msg: 'Stopping strategy loop' });

      const registry = getLoopRegistry();
      const entry = registry.get(contractAddress);

      if (entry) {
        registry.updateStatus(contractAddress, 'stopping');
        await entry.loop.stop();
        registry.updateStatus(contractAddress, 'stopped');
        registry.unregister(contractAddress);
      }

      // Teardown RabbitMQ topology
      state.status = 'teardown_topology';
      this.log.info({ contractAddress, msg: 'Tearing down RabbitMQ topology' });

      await teardownStrategyTopology(channel, contractAddress);

      // Complete
      state.status = 'completed';
      state.completedAt = new Date();

      this.log.info({ contractAddress, msg: 'Strategy shutdown complete' });
    } catch (error) {
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : 'Unknown error';
      state.completedAt = new Date();
      throw error;
    }
  }

  /**
   * Poll contract until lifecycleStatus is SHUTDOWN (4)
   */
  private async waitForShutdown(
    contractAddress: Address,
    chainId: number,
    abi: Abi,
    timeoutMs: number = 60000
  ): Promise<void> {
    const rpcUrl = process.env.SEMSEE_RPC_URL || 'http://localhost:8545';
    const chain = {
      id: chainId,
      name: 'SEMSEE',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [rpcUrl] },
      },
    } as const;

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const startTime = Date.now();
    const SHUTDOWN_STATUS = 4; // LifecycleStatus.SHUTDOWN

    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await publicClient.readContract({
          address: contractAddress,
          abi,
          functionName: 'lifecycleStatus',
        });

        if (Number(status) === SHUTDOWN_STATUS) {
          return;
        }
      } catch (error) {
        this.log.warn({
          contractAddress,
          error,
          msg: 'Failed to read lifecycle status',
        });
      }

      await this.sleep(1000);
    }

    throw new LifecycleError(
      'Timeout waiting for on-chain shutdown',
      'SHUTDOWN_TIMEOUT',
      408
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Validate vault configuration before starting a strategy that requires funding
   *
   * Checks:
   * 1. Vault is registered (vaultConfig exists)
   * 2. Vault has funds (tokenBalance > 0)
   * 3. Vault has gas pool (gasPool > MIN_GAS_POOL)
   */
  private async validateVaultBeforeStart(
    strategyId: string,
    manifest: StrategyManifest
  ): Promise<void> {
    const dbClient = getDatabaseClient();
    const vaultInfo = await dbClient.getStrategyVaultInfo(strategyId);

    // 1. Check vault is registered
    if (!vaultInfo) {
      throw new LifecycleError(
        'Strategy requires vault funding but no vault is registered. ' +
        'Deploy a SimpleTokenVault and call POST /api/strategy/:id/vault to register it.',
        'VAULT_NOT_DEPLOYED',
        400
      );
    }

    // 2. Validate vault config type (currently only EVM supported)
    const vaultConfig = vaultInfo.vaultConfig;
    if (vaultConfig.type !== 'evm') {
      // Future-proofing: when other vault types are added, this will be a compile error
      // reminding us to handle them
      throw new LifecycleError(
        `Unsupported vault type: ${(vaultConfig as { type: string }).type}`,
        'UNSUPPORTED_VAULT_TYPE',
        400
      );
    }

    // 3. Validate chain matches manifest
    if (vaultConfig.chainId !== manifest.fundingToken!.chainId) {
      throw new LifecycleError(
        `Vault chain (${vaultConfig.chainId}) does not match manifest fundingToken chain (${manifest.fundingToken!.chainId})`,
        'VAULT_CHAIN_MISMATCH',
        400
      );
    }

    // 4. Read vault balance and gas pool from chain
    const RPC_URL_ENV_MAP: Record<number, string> = {
      1: 'RPC_URL_ETHEREUM',
      42161: 'RPC_URL_ARBITRUM',
      8453: 'RPC_URL_BASE',
      56: 'RPC_URL_BSC',
      137: 'RPC_URL_POLYGON',
      10: 'RPC_URL_OPTIMISM',
    };

    const envVar = RPC_URL_ENV_MAP[vaultConfig.chainId];
    if (!envVar) {
      throw new LifecycleError(
        `Unsupported vault chain: ${vaultConfig.chainId}`,
        'UNSUPPORTED_CHAIN',
        400
      );
    }

    const rpcUrl = process.env[envVar];
    if (!rpcUrl) {
      // Skip on-chain validation if RPC not configured (development)
      this.log.warn({
        strategyId,
        chainId: vaultConfig.chainId,
        envVar,
        msg: 'Skipping vault balance check - RPC URL not configured',
      });
      return;
    }

    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    const VAULT_ABI = [
      { type: 'function', name: 'tokenBalance', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
      { type: 'function', name: 'gasPool', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
      { type: 'function', name: 'isShutdown', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
    ] as const;

    try {
      const [tokenBalance, gasPool, isShutdown] = await Promise.all([
        client.readContract({
          address: vaultConfig.vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: 'tokenBalance',
        }),
        client.readContract({
          address: vaultConfig.vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: 'gasPool',
        }),
        client.readContract({
          address: vaultConfig.vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: 'isShutdown',
        }),
      ]);

      // Check vault not shutdown
      if (isShutdown) {
        throw new LifecycleError(
          'Vault is shutdown',
          'VAULT_SHUTDOWN',
          400
        );
      }

      // Check vault has funds
      if (tokenBalance === 0n) {
        throw new LifecycleError(
          'Vault is empty. Deposit tokens before starting the strategy.',
          'VAULT_EMPTY',
          400
        );
      }

      // Check gas pool (minimum 0.01 ETH)
      const MIN_GAS_POOL = BigInt(10 ** 16); // 0.01 ETH
      if (gasPool < MIN_GAS_POOL) {
        throw new LifecycleError(
          `Vault gas pool too low (${gasPool} wei). Minimum 0.01 ETH required.`,
          'GAS_POOL_INSUFFICIENT',
          400
        );
      }

      this.log.info({
        strategyId,
        vaultAddress: vaultConfig.vaultAddress,
        tokenBalance: tokenBalance.toString(),
        gasPool: gasPool.toString(),
        msg: 'Vault validation passed',
      });
    } catch (error) {
      if (error instanceof LifecycleError) {
        throw error;
      }
      this.log.error({
        strategyId,
        vaultAddress: vaultConfig.vaultAddress,
        error,
        msg: 'Failed to read vault state',
      });
      throw new LifecycleError(
        `Failed to read vault state: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VAULT_READ_FAILED',
        500
      );
    }
  }

  /**
   * Clear completed/failed operations from memory
   */
  cleanup(): void {
    for (const [addr, state] of this.operations) {
      if (['completed', 'failed'].includes(state.status)) {
        // Keep for 1 hour after completion
        const completedAt = state.completedAt?.getTime() ?? 0;
        if (Date.now() - completedAt > 3600000) {
          this.operations.delete(addr);
        }
      }
    }
  }

  /**
   * Get status info for API responses
   */
  getLoopInfo(contractAddress: Address): {
    loopRunning: boolean;
    loopStatus?: LoopStatus;
    epoch?: number;
    eventsProcessed?: number;
    effectsProcessed?: number;
  } {
    const registry = getLoopRegistry();
    const entry = registry.get(contractAddress);

    if (!entry) {
      return { loopRunning: false };
    }

    const loopState = entry.loop.getState();

    return {
      loopRunning: entry.status === 'running',
      loopStatus: entry.status,
      epoch: Number(loopState.epoch),
      eventsProcessed: loopState.eventsProcessed,
      effectsProcessed: loopState.effectsProcessed,
    };
  }
}

// =============================================================================
// Singleton
// =============================================================================

let lifecycleServiceInstance: LifecycleService | null = null;

export function getLifecycleService(): LifecycleService {
  if (!lifecycleServiceInstance) {
    lifecycleServiceInstance = new LifecycleService();
  }
  return lifecycleServiceInstance;
}

export { LifecycleService };
