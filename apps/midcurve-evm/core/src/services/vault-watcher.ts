/**
 * Vault Watcher Service
 *
 * Monitors SimpleTokenVault contracts on public chains for deposit/withdraw events.
 * Publishes FUNDING step events to strategy event queues when vault state changes.
 *
 * Architecture:
 * - Watches vault events on public chain (Ethereum, Arbitrum, etc.)
 * - Publishes step events to SEMSEE strategy via RabbitMQ
 * - Strategy receives events and updates its internal funding state
 *
 * Events monitored:
 * - Deposited(address indexed owner, uint256 amount) → FUNDING_DEPOSITED
 * - Withdrawn(address indexed owner, address indexed to, uint256 amount) → FUNDING_WITHDRAWN
 */

import type { Channel } from 'amqplib';
import {
  type Address,
  type Hex,
  type Log,
  createPublicClient,
  http,
  parseAbiItem,
  keccak256,
  toHex,
  encodeAbiParameters,
} from 'viem';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { parseVaultConfig, isEvmVaultConfig } from '../types/vault-config';
import {
  type StepEventMessage,
  serializeMessage,
} from '../mq/messages.js';
import { EXCHANGES, ROUTING_KEYS } from '../mq/topology.js';

// =============================================================================
// Constants
// =============================================================================

/** Step event type for funding notifications (must match FundingMixin.sol) */
const STEP_EVENT_FUNDING = keccak256(toHex('STEP_EVENT_FUNDING')) as Hex;

/** Funding event version (must match FundingMixin.sol) */
const FUNDING_EVENT_VERSION = 1;

/** Funding event sub-types */
const FUNDING_DEPOSITED = keccak256(toHex('DEPOSITED')) as Hex;
const FUNDING_WITHDRAWN = keccak256(toHex('WITHDRAWN')) as Hex;

/** Vault event ABI items */
const DEPOSITED_EVENT = parseAbiItem('event Deposited(address indexed owner, uint256 amount)');
const WITHDRAWN_EVENT = parseAbiItem('event Withdrawn(address indexed owner, address indexed to, uint256 amount)');

/** SimpleTokenVault ABI for reading token balance */
const VAULT_ABI = [
  {
    type: 'function',
    name: 'tokenBalance',
    inputs: [],
    outputs: [{ type: 'uint256', name: '' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [{ type: 'address', name: '' }],
    stateMutability: 'view',
  },
] as const;

/** Map of chain IDs to RPC URL environment variable names */
const RPC_URL_ENV_MAP: Record<number, string> = {
  1: 'RPC_URL_ETHEREUM',
  42161: 'RPC_URL_ARBITRUM',
  8453: 'RPC_URL_BASE',
  56: 'RPC_URL_BSC',
  137: 'RPC_URL_POLYGON',
  10: 'RPC_URL_OPTIMISM',
};

// =============================================================================
// Types
// =============================================================================

interface WatchedVault {
  /** Strategy contract address on SEMSEE */
  strategyAddress: Address;
  /** Vault contract address on public chain */
  vaultAddress: Address;
  /** Public chain ID */
  chainId: number;
  /** Vault token address */
  tokenAddress: Address;
}

// =============================================================================
// Service
// =============================================================================

const log = logger.child({ service: 'VaultWatcher' });

export class VaultWatcher {
  private readonly channel: Channel;
  private readonly pollingIntervalMs: number;
  private watchedVaults: WatchedVault[] = [];
  private running = false;
  private abortController: AbortController | null = null;

  constructor(channel: Channel, pollingIntervalMs = 15000) {
    this.channel = channel;
    this.pollingIntervalMs = pollingIntervalMs;
  }

  /**
   * Start the vault watcher.
   * Loads all active strategies with vaults and begins monitoring.
   */
  async start(): Promise<void> {
    if (this.running) {
      log.warn({ msg: 'VaultWatcher already running' });
      return;
    }

    this.running = true;
    this.abortController = new AbortController();

    log.info({ msg: 'Starting VaultWatcher' });

    // Load initial vaults
    await this.refreshVaultList();

    // Start polling loop
    this.pollLoop();
  }

  /**
   * Stop the vault watcher gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    log.info({ msg: 'Stopping VaultWatcher' });
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Refresh the list of vaults to watch from the database.
   * Called periodically to pick up new deployments.
   */
  async refreshVaultList(): Promise<void> {
    log.info({ msg: 'Refreshing vault list' });

    try {
      // Find all active strategies with vault config
      const strategies = await prisma.strategy.findMany({
        where: {
          vaultConfig: { not: { equals: null } },
          vaultTokenId: { not: null },
          status: { in: ['active', 'starting', 'deployed'] },
        },
        include: {
          vaultToken: true,
        },
      });

      const vaults: WatchedVault[] = [];

      for (const strategy of strategies) {
        if (!strategy.contractAddress || !strategy.vaultConfig || !strategy.vaultToken) {
          continue;
        }

        try {
          const vaultConfig = parseVaultConfig(strategy.vaultConfig);
          if (!isEvmVaultConfig(vaultConfig)) {
            continue;
          }

          const tokenConfig = strategy.vaultToken.config as { address?: string } | null;
          if (!tokenConfig?.address) {
            continue;
          }

          vaults.push({
            strategyAddress: strategy.contractAddress as Address,
            vaultAddress: vaultConfig.vaultAddress as Address,
            chainId: vaultConfig.chainId,
            tokenAddress: tokenConfig.address as Address,
          });
        } catch (error) {
          log.warn({
            strategyAddress: strategy.contractAddress,
            error: error instanceof Error ? error.message : 'Unknown error',
            msg: 'Failed to parse vault config',
          });
        }
      }

      this.watchedVaults = vaults;
      log.info({ vaultCount: vaults.length, msg: 'Vault list refreshed' });
    } catch (error) {
      log.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Failed to refresh vault list',
      });
    }
  }

  /**
   * Main polling loop.
   */
  private async pollLoop(): Promise<void> {
    let lastPollTime = Date.now();
    const refreshIntervalMs = 60000; // Refresh vault list every minute

    while (this.running && !this.abortController?.signal.aborted) {
      try {
        // Check if we should refresh the vault list
        if (Date.now() - lastPollTime > refreshIntervalMs) {
          await this.refreshVaultList();
          lastPollTime = Date.now();
        }

        // Poll each chain's vaults
        const chainVaults = this.groupVaultsByChain();

        await Promise.all(
          Object.entries(chainVaults).map(([chainId, vaults]) =>
            this.pollChain(Number(chainId), vaults)
          )
        );

        // Wait before next poll
        await this.sleep(this.pollingIntervalMs);
      } catch (error) {
        log.error({
          error: error instanceof Error ? error.message : 'Unknown error',
          msg: 'Poll loop error',
        });
        await this.sleep(this.pollingIntervalMs);
      }
    }
  }

  /**
   * Group vaults by chain ID for efficient batch queries.
   */
  private groupVaultsByChain(): Record<number, WatchedVault[]> {
    const groups: Record<number, WatchedVault[]> = {};

    for (const vault of this.watchedVaults) {
      if (!groups[vault.chainId]) {
        groups[vault.chainId] = [];
      }
      groups[vault.chainId].push(vault);
    }

    return groups;
  }

  /**
   * Poll a single chain for vault events.
   */
  private async pollChain(chainId: number, vaults: WatchedVault[]): Promise<void> {
    const envVar = RPC_URL_ENV_MAP[chainId];
    if (!envVar) {
      log.warn({ chainId, msg: 'Unsupported chain ID' });
      return;
    }

    const rpcUrl = process.env[envVar];
    if (!rpcUrl) {
      log.warn({ chainId, envVar, msg: 'RPC URL not configured' });
      return;
    }

    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    try {
      // Get current block number
      const currentBlock = await client.getBlockNumber();

      // Look back 100 blocks (approximately 20 minutes on most chains)
      // In production, would track last processed block per vault
      const fromBlock = currentBlock - 100n;

      // Get deposit events
      const depositLogs = await client.getLogs({
        address: vaults.map((v) => v.vaultAddress),
        event: DEPOSITED_EVENT,
        fromBlock,
        toBlock: currentBlock,
      });

      // Get withdrawal events
      const withdrawLogs = await client.getLogs({
        address: vaults.map((v) => v.vaultAddress),
        event: WITHDRAWN_EVENT,
        fromBlock,
        toBlock: currentBlock,
      });

      // Process deposit events
      for (const logEntry of depositLogs) {
        const vault = vaults.find(
          (v) => v.vaultAddress.toLowerCase() === logEntry.address.toLowerCase()
        );
        if (vault) {
          await this.handleDepositLog(vault, logEntry, client, chainId);
        }
      }

      // Process withdrawal events
      for (const logEntry of withdrawLogs) {
        const vault = vaults.find(
          (v) => v.vaultAddress.toLowerCase() === logEntry.address.toLowerCase()
        );
        if (vault) {
          await this.handleWithdrawLog(vault, logEntry, client, chainId);
        }
      }
    } catch (error) {
      log.error({
        chainId,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Failed to poll chain',
      });
    }
  }

  /**
   * Handle a Deposited event.
   */
  private async handleDepositLog(
    vault: WatchedVault,
    logEntry: Log<bigint, number, false, typeof DEPOSITED_EVENT>,
    client: ReturnType<typeof createPublicClient>,
    chainId: number
  ): Promise<void> {
    const amount = logEntry.args.amount ?? 0n;

    log.info({
      vaultAddress: vault.vaultAddress,
      strategyAddress: vault.strategyAddress,
      amount: amount.toString(),
      txHash: logEntry.transactionHash,
      msg: 'Deposit detected',
    });

    // Get current vault balance
    const newBalance = await client.readContract({
      address: vault.vaultAddress,
      abi: VAULT_ABI,
      functionName: 'tokenBalance',
    });

    // Publish funding event
    await this.publishFundingEvent(
      vault,
      FUNDING_DEPOSITED,
      chainId,
      amount,
      newBalance
    );
  }

  /**
   * Handle a Withdrawn event.
   */
  private async handleWithdrawLog(
    vault: WatchedVault,
    logEntry: Log<bigint, number, false, typeof WITHDRAWN_EVENT>,
    client: ReturnType<typeof createPublicClient>,
    chainId: number
  ): Promise<void> {
    const amount = logEntry.args.amount ?? 0n;

    log.info({
      vaultAddress: vault.vaultAddress,
      strategyAddress: vault.strategyAddress,
      amount: amount.toString(),
      txHash: logEntry.transactionHash,
      msg: 'Withdrawal detected',
    });

    // Get current vault balance
    const newBalance = await client.readContract({
      address: vault.vaultAddress,
      abi: VAULT_ABI,
      functionName: 'tokenBalance',
    });

    // Publish funding event
    await this.publishFundingEvent(
      vault,
      FUNDING_WITHDRAWN,
      chainId,
      amount,
      newBalance
    );
  }

  /**
   * Publish a funding step event to the strategy's event queue.
   */
  private async publishFundingEvent(
    vault: WatchedVault,
    fundingEventType: Hex,
    chainId: number,
    amount: bigint,
    newVaultBalance: bigint
  ): Promise<void> {
    // Encode payload: (fundingEventType, chainId, tokenAddress, amount, newVaultBalance)
    const payload = encodeAbiParameters(
      [
        { type: 'bytes32', name: 'fundingEventType' },
        { type: 'uint256', name: 'chainId' },
        { type: 'address', name: 'tokenAddress' },
        { type: 'uint256', name: 'amount' },
        { type: 'uint256', name: 'newVaultBalance' },
      ],
      [fundingEventType, BigInt(chainId), vault.tokenAddress, amount, newVaultBalance]
    );

    const stepEvent: StepEventMessage = {
      eventType: STEP_EVENT_FUNDING,
      eventVersion: FUNDING_EVENT_VERSION,
      payload,
      timestamp: Date.now(),
      source: 'vault-watcher',
    };

    const routingKey = ROUTING_KEYS.funding(vault.strategyAddress);

    try {
      const published = this.channel.publish(
        EXCHANGES.EVENTS,
        routingKey,
        serializeMessage(stepEvent),
        { persistent: true }
      );

      if (!published) {
        log.error({
          strategyAddress: vault.strategyAddress,
          msg: 'Failed to publish funding event - channel buffer full',
        });
      } else {
        log.info({
          strategyAddress: vault.strategyAddress,
          routingKey,
          eventType: fundingEventType === FUNDING_DEPOSITED ? 'DEPOSITED' : 'WITHDRAWN',
          amount: amount.toString(),
          newBalance: newVaultBalance.toString(),
          msg: 'Published funding event',
        });
      }
    } catch (error) {
      log.error({
        strategyAddress: vault.strategyAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Failed to publish funding event',
      });
    }
  }

  /**
   * Get current status.
   */
  getStatus(): { running: boolean; watchedVaults: number } {
    return {
      running: this.running,
      watchedVaults: this.watchedVaults.length,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Singleton (survives Next.js HMR in development)
// =============================================================================

// Use globalThis to prevent singleton from being reset during Hot Module Reloading
const globalForVaultWatcher = globalThis as unknown as {
  vaultWatcher: VaultWatcher | undefined;
};

/**
 * Get the singleton vault watcher instance.
 * Must call initialize() first.
 */
export function getVaultWatcher(): VaultWatcher | null {
  return globalForVaultWatcher.vaultWatcher ?? null;
}

/**
 * Initialize the vault watcher with a RabbitMQ channel.
 */
export function initializeVaultWatcher(channel: Channel): VaultWatcher {
  if (globalForVaultWatcher.vaultWatcher) {
    return globalForVaultWatcher.vaultWatcher;
  }

  globalForVaultWatcher.vaultWatcher = new VaultWatcher(channel);
  return globalForVaultWatcher.vaultWatcher;
}
