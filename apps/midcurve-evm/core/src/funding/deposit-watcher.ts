import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type Chain,
  parseAbiItem,
} from 'viem';
import { mainnet, arbitrum, base, optimism, polygon, bsc } from 'viem/chains';
import type pino from 'pino';
import { type DetectedErc20Deposit } from './types.js';

/**
 * Callback for when a deposit is detected
 */
export type OnDepositCallback = (
  strategyAddress: Address,
  deposit: DetectedErc20Deposit
) => Promise<void>;

/**
 * Strategy registration for deposit monitoring
 */
interface StrategyRegistration {
  strategyAddress: Address;
  ownerAddress: Address;
  watchedTokens: Set<Address>;
}

/**
 * Supported chain configuration
 */
const SUPPORTED_CHAINS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  10: optimism,
  137: polygon,
  56: bsc,
};

/**
 * ERC-20 Transfer event signature
 */
const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

/**
 * DepositWatcher monitors automation wallet for incoming ERC-20 deposits.
 *
 * For each configured chain:
 * - Watches for Transfer events TO the automation wallet
 * - Filters by registered strategy tokens
 * - Notifies the funding manager when deposits are detected
 *
 * Note: ETH deposits are handled separately via updateEthBalance() flow
 */
export class DepositWatcher {
  private chainClients: Map<number, PublicClient> = new Map();
  private strategies: Map<Address, StrategyRegistration> = new Map();
  private unsubscribeFns: Map<number, () => void> = new Map();
  private onDepositCallback?: OnDepositCallback;
  private isWatching = false;

  constructor(
    private automationWalletAddress: Address,
    private chainRpcUrls: Map<number, string>,
    private logger: pino.Logger
  ) {
    this.initializeChainClients();
  }

  /**
   * Initialize public clients for all configured chains
   */
  private initializeChainClients(): void {
    for (const [chainId, rpcUrl] of this.chainRpcUrls) {
      const chain = SUPPORTED_CHAINS[chainId];
      if (!chain) {
        this.logger.warn({ chainId }, 'Unsupported chain ID, skipping');
        continue;
      }

      try {
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });

        this.chainClients.set(chainId, publicClient);

        this.logger.info(
          { chainId, chainName: chain.name },
          'Initialized deposit watcher client'
        );
      } catch (error) {
        this.logger.error(
          { chainId, error },
          'Failed to initialize deposit watcher client'
        );
      }
    }
  }

  /**
   * Register a strategy for deposit monitoring
   */
  registerStrategy(
    strategyAddress: Address,
    ownerAddress: Address,
    tokens: Address[] = []
  ): void {
    const existing = this.strategies.get(strategyAddress);

    if (existing) {
      // Add new tokens to existing registration
      for (const token of tokens) {
        existing.watchedTokens.add(token);
      }
      this.logger.debug(
        { strategy: strategyAddress, tokenCount: existing.watchedTokens.size },
        'Updated strategy token list'
      );
    } else {
      // New registration
      this.strategies.set(strategyAddress, {
        strategyAddress,
        ownerAddress,
        watchedTokens: new Set(tokens),
      });
      this.logger.info(
        { strategy: strategyAddress, owner: ownerAddress, tokenCount: tokens.length },
        'Registered strategy for deposit monitoring'
      );
    }
  }

  /**
   * Unregister a strategy from deposit monitoring
   */
  unregisterStrategy(strategyAddress: Address): void {
    this.strategies.delete(strategyAddress);
    this.logger.info({ strategy: strategyAddress }, 'Unregistered strategy from deposit monitoring');
  }

  /**
   * Add a token to watch for a specific strategy
   */
  addWatchedToken(strategyAddress: Address, token: Address): void {
    const registration = this.strategies.get(strategyAddress);
    if (registration) {
      registration.watchedTokens.add(token);
      this.logger.info(
        { strategy: strategyAddress, token, tokenCount: registration.watchedTokens.size },
        'Added watched token for strategy'
      );
    } else {
      this.logger.warn(
        { strategy: strategyAddress, token },
        'Cannot add watched token - strategy not registered'
      );
    }
  }

  /**
   * Remove a token from watch for a specific strategy
   */
  removeWatchedToken(strategyAddress: Address, token: Address): void {
    const registration = this.strategies.get(strategyAddress);
    if (registration) {
      registration.watchedTokens.delete(token);
      this.logger.info(
        { strategy: strategyAddress, token, tokenCount: registration.watchedTokens.size },
        'Removed watched token for strategy'
      );
    } else {
      this.logger.warn(
        { strategy: strategyAddress, token },
        'Cannot remove watched token - strategy not registered'
      );
    }
  }

  /**
   * Set the callback for deposit notifications
   */
  setOnDepositCallback(callback: OnDepositCallback): void {
    this.onDepositCallback = callback;
  }

  /**
   * Start watching for deposits on all chains
   */
  async startWatching(): Promise<void> {
    if (this.isWatching) {
      this.logger.warn('Deposit watcher already running');
      return;
    }

    this.isWatching = true;

    for (const [chainId, client] of this.chainClients) {
      try {
        const unwatch = client.watchEvent({
          address: undefined, // Watch all ERC-20 contracts
          event: TRANSFER_EVENT,
          args: {
            to: this.automationWalletAddress,
          },
          onLogs: (logs) => this.handleTransferLogs(chainId, logs),
          onError: (error) => {
            this.logger.error(
              { chainId, error },
              'Error in deposit watcher'
            );
          },
        });

        this.unsubscribeFns.set(chainId, unwatch);

        this.logger.info(
          { chainId },
          'Started watching for deposits'
        );
      } catch (error) {
        this.logger.error(
          { chainId, error },
          'Failed to start deposit watching'
        );
      }
    }
  }

  /**
   * Stop watching for deposits
   */
  stopWatching(): void {
    for (const [chainId, unsubscribe] of this.unsubscribeFns) {
      try {
        unsubscribe();
        this.logger.info({ chainId }, 'Stopped watching for deposits');
      } catch (error) {
        this.logger.error({ chainId, error }, 'Error stopping deposit watcher');
      }
    }

    this.unsubscribeFns.clear();
    this.isWatching = false;
  }

  /**
   * Handle incoming Transfer event logs
   */
  private async handleTransferLogs(
    chainId: number,
    logs: Array<{
      address: Address;
      args: { from?: Address; to?: Address; value?: bigint };
      transactionHash: Hex;
      blockNumber: bigint;
    }>
  ): Promise<void> {
    for (const log of logs) {
      // Skip if args are incomplete
      if (!log.args.from || !log.args.to || log.args.value === undefined) {
        continue;
      }

      const token = log.address;
      const from = log.args.from;
      const amount = log.args.value;
      const txHash = log.transactionHash;
      const blockNumber = log.blockNumber;

      // Find strategy that watches this token
      const matchingStrategy = this.findStrategyForToken(token);

      if (!matchingStrategy) {
        this.logger.debug(
          { chainId, token, from, amount: amount.toString() },
          'Deposit detected but no strategy watching this token'
        );
        continue;
      }

      const deposit: DetectedErc20Deposit = {
        chainId: BigInt(chainId),
        token,
        amount,
        from,
        txHash,
        blockNumber,
      };

      this.logger.info(
        {
          chainId,
          strategy: matchingStrategy.strategyAddress,
          token,
          amount: amount.toString(),
          from,
          txHash,
        },
        'ERC-20 deposit detected'
      );

      // Notify the funding manager
      if (this.onDepositCallback) {
        try {
          await this.onDepositCallback(matchingStrategy.strategyAddress, deposit);
        } catch (error) {
          this.logger.error(
            { chainId, strategy: matchingStrategy.strategyAddress, error },
            'Error in deposit callback'
          );
        }
      }
    }
  }

  /**
   * Find a strategy that watches the given token
   * For now, returns the first match. In future, could use more sophisticated matching.
   */
  private findStrategyForToken(token: Address): StrategyRegistration | undefined {
    for (const registration of this.strategies.values()) {
      if (registration.watchedTokens.has(token)) {
        return registration;
      }
    }
    return undefined;
  }

  /**
   * Get all registered strategies
   */
  getRegisteredStrategies(): Address[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Check if watcher is running
   */
  isRunning(): boolean {
    return this.isWatching;
  }
}
