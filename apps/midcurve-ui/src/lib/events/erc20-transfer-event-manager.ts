/**
 * ERC-20 Transfer Event Manager (Singleton)
 *
 * Manages Transfer event subscriptions for ERC-20 tokens across all EVM chains.
 * Implements reference counting to maintain a single RPC subscription per token,
 * regardless of how many React components are watching that token.
 *
 * Features:
 * - Single RPC subscription per token (efficient)
 * - Automatic watcher creation/destruction based on subscriber count
 * - Event filtering by wallet address (only relevant subscribers notified)
 * - Memory leak prevention through reference counting
 * - Type-safe callback system
 *
 * Architecture:
 * - Map<tokenKey, WatcherState> where tokenKey = "${chainId}-${tokenAddress}"
 * - WatcherState tracks: unwatch function + Map of subscribers
 * - Each subscriber has unique ID + wallet address + callback
 *
 * @example
 * ```typescript
 * const manager = Erc20TransferEventManager.getInstance();
 * manager.setPublicClient(publicClient);
 *
 * const unsubscribe = manager.subscribe(
 *   1,                    // chainId (Ethereum)
 *   '0xToken...',         // tokenAddress
 *   '0xWallet...',        // walletAddress
 *   (event) => {          // callback
 *     console.log('Transfer detected:', event);
 *   }
 * );
 *
 * // Later: cleanup
 * unsubscribe();
 * ```
 */

import { nanoid } from 'nanoid';
import type { PublicClient } from 'viem';

/**
 * ERC-20 Transfer event data
 */
export interface Erc20TransferEvent {
  from: string;
  to: string;
  value: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: number;
}

/**
 * Callback function invoked when relevant Transfer event detected
 */
export type Erc20TransferCallback = (event: Erc20TransferEvent) => void;

/**
 * Function to unsubscribe from Transfer events
 */
export type UnsubscribeFn = () => void;

/**
 * Unique identifier for each subscriber
 */
type SubscriberId = string;

/**
 * Subscriber information stored in watcher
 */
interface SubscriberInfo {
  walletAddress: string;
  callback: Erc20TransferCallback;
}

/**
 * State for each token watcher
 * Tracks the viem unwatch function and all subscribers
 */
interface WatcherState {
  /**
   * Function to stop watching events (from viem's watchContractEvent)
   */
  unwatch: () => void;

  /**
   * Map of subscriber ID to subscriber info
   * Used for reference counting and callback dispatch
   */
  subscribers: Map<SubscriberId, SubscriberInfo>;
}

/**
 * ERC-20 Transfer event ABI
 * Standard Transfer event signature for all ERC-20 tokens
 */
const ERC20_TRANSFER_EVENT_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
  },
] as const;

/**
 * Singleton manager for ERC-20 Transfer event subscriptions
 *
 * Maintains a single RPC subscription per token, with multiple subscribers.
 * Automatically creates watchers when first subscriber arrives, and destroys
 * watchers when last subscriber leaves.
 */
export class Erc20TransferEventManager {
  private static instance: Erc20TransferEventManager | null = null;

  /**
   * Map of active watchers keyed by "${chainId}-${tokenAddress}"
   */
  private watchers: Map<string, WatcherState>;

  /**
   * Viem public client for interacting with EVM chains
   * Must be set via setPublicClient() before subscribing
   */
  private publicClient: PublicClient | null;

  /**
   * Private constructor (singleton pattern)
   */
  private constructor() {
    this.watchers = new Map();
    this.publicClient = null;
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): Erc20TransferEventManager {
    if (!Erc20TransferEventManager.instance) {
      Erc20TransferEventManager.instance = new Erc20TransferEventManager();
    }
    return Erc20TransferEventManager.instance;
  }

  /**
   * Set the public client for watching events
   * Must be called before subscribing to events
   *
   * @param client - Viem public client from wagmi
   */
  public setPublicClient(client: PublicClient): void {
    this.publicClient = client;
  }

  /**
   * Subscribe to Transfer events for a specific ERC-20 token and wallet
   *
   * Creates a watcher if this is the first subscriber for this token.
   * Increments reference count and adds subscriber to notification list.
   *
   * @param chainId - EVM chain ID (1 = Ethereum, 42161 = Arbitrum, etc.)
   * @param tokenAddress - ERC-20 contract address
   * @param walletAddress - Wallet address to filter events for
   * @param callback - Function to call when Transfer event detected
   * @returns Unsubscribe function to cleanup when done
   *
   * @throws Error if publicClient not set
   */
  public subscribe(
    chainId: number,
    tokenAddress: string,
    walletAddress: string,
    callback: Erc20TransferCallback
  ): UnsubscribeFn {
    if (!this.publicClient) {
      throw new Error(
        'PublicClient not set. Call setPublicClient() before subscribing.'
      );
    }

    const tokenKey = this.getTokenKey(chainId, tokenAddress);
    const subscriberId = nanoid();

    // Create watcher if this is the first subscriber for this token
    if (!this.watchers.has(tokenKey)) {
      this.createWatcher(chainId, tokenAddress, tokenKey);
    }

    // Add subscriber to watcher's subscriber list
    const watcher = this.watchers.get(tokenKey)!;
    watcher.subscribers.set(subscriberId, {
      walletAddress: walletAddress.toLowerCase(), // Normalize for comparison
      callback,
    });

    // Return unsubscribe function
    return () => {
      this.unsubscribe(tokenKey, subscriberId, chainId, tokenAddress);
    };
  }

  /**
   * Create a new watcher for the specified token
   * Sets up watchContractEvent via viem and stores the unwatch function
   *
   * @param chainId - EVM chain ID
   * @param tokenAddress - ERC-20 contract address
   * @param tokenKey - Key for watchers Map
   */
  private createWatcher(
    _chainId: number,
    tokenAddress: string,
    tokenKey: string
  ): void {
    if (!this.publicClient) {
      throw new Error('PublicClient not set');
    }

    // Watch Transfer events for this token using viem
    const unwatch = this.publicClient.watchContractEvent({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_TRANSFER_EVENT_ABI,
      eventName: 'Transfer',
      onLogs: (logs) => {
        this.handleTransferLogs(tokenKey, logs);
      },
      // Polling configuration inherited from wagmi config
      // Can be overridden here if needed: pollingInterval: 12000
    });

    // Store watcher state
    this.watchers.set(tokenKey, {
      unwatch,
      subscribers: new Map(),
    });
  }

  /**
   * Handle Transfer event logs from viem
   * Filters events and notifies relevant subscribers
   *
   * @param tokenKey - Key for watchers Map
   * @param logs - Array of Transfer event logs from viem
   */
  private handleTransferLogs(tokenKey: string, logs: any[]): void {
    const watcher = this.watchers.get(tokenKey);
    if (!watcher) return;

    // Process each Transfer event log
    logs.forEach((log) => {
      const from = log.args?.from as string | undefined;
      const to = log.args?.to as string | undefined;
      const value = log.args?.value as bigint | undefined;

      if (!from || !to || value === undefined) return;

      const fromLower = from.toLowerCase();
      const toLower = to.toLowerCase();

      // Notify subscribers whose wallet is involved in this transfer
      watcher.subscribers.forEach(({ walletAddress, callback }) => {
        if (walletAddress === fromLower || walletAddress === toLower) {
          const event: Erc20TransferEvent = {
            from: from,
            to: to,
            value: value.toString(),
            transactionHash: log.transactionHash || '0x',
            blockNumber: log.blockNumber?.toString() || '0',
            logIndex: log.logIndex || 0,
          };

          // Invoke subscriber's callback
          callback(event);
        }
      });
    });
  }

  /**
   * Unsubscribe a specific subscriber from Transfer events
   * Destroys watcher if this was the last subscriber
   *
   * @param tokenKey - Key for watchers Map
   * @param subscriberId - Unique subscriber ID
   * @param chainId - EVM chain ID (for logging)
   * @param tokenAddress - Token address (for logging)
   */
  private unsubscribe(
    tokenKey: string,
    subscriberId: SubscriberId,
    _chainId: number,
    _tokenAddress: string
  ): void {
    const watcher = this.watchers.get(tokenKey);
    if (!watcher) return;

    // Remove subscriber
    watcher.subscribers.delete(subscriberId);

    // If no more subscribers, destroy watcher (cleanup)
    if (watcher.subscribers.size === 0) {
      watcher.unwatch(); // Stop watching events
      this.watchers.delete(tokenKey);
    }
  }

  /**
   * Generate unique key for token across chains
   *
   * @param chainId - EVM chain ID
   * @param tokenAddress - ERC-20 contract address
   * @returns Key in format "${chainId}-${tokenAddress}"
   */
  private getTokenKey(chainId: number, tokenAddress: string): string {
    return `${chainId}-${tokenAddress.toLowerCase()}`;
  }

  /**
   * Destroy all watchers and cleanup
   * Should be called when application unmounts
   */
  public destroy(): void {
    this.watchers.forEach((watcher) => {
      watcher.unwatch();
    });

    this.watchers.clear();
  }

  /**
   * Get current number of active watchers (for debugging)
   */
  public getActiveWatcherCount(): number {
    return this.watchers.size;
  }

  /**
   * Get total number of subscribers across all watchers (for debugging)
   */
  public getTotalSubscriberCount(): number {
    let total = 0;
    this.watchers.forEach((watcher) => {
      total += watcher.subscribers.size;
    });
    return total;
  }
}
