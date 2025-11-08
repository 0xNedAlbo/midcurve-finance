/**
 * useErc20TransferWatch Hook
 *
 * React hook for subscribing to ERC-20 Transfer events with automatic cleanup.
 * Provides a simple API for components to watch Transfer events without managing
 * subscription lifecycle manually.
 *
 * Features:
 * - Automatic subscription on mount
 * - Automatic unsubscription on unmount
 * - React Strict Mode compatible (handles double mount/unmount)
 * - Stable callback reference (doesn't re-subscribe when callback changes)
 * - Conditional watching (enabled/disabled)
 *
 * Benefits over direct useWatchContractEvent:
 * - Single RPC subscription per token (shared across components)
 * - Reference counting (auto-cleanup when no subscribers)
 * - No duplicate subscriptions
 *
 * @example
 * ```tsx
 * function TokenBalance({ token, wallet, chainId }) {
 *   const { refetch } = useQuery(['balance', token, wallet]);
 *
 *   useErc20TransferWatch({
 *     chainId,
 *     tokenAddress: token,
 *     walletAddress: wallet,
 *     onTransfer: (event) => {
 *       console.log('Transfer detected:', event);
 *       refetch(); // Update balance
 *     },
 *   });
 *
 *   return <div>Balance: ...</div>;
 * }
 * ```
 */

'use client';

import { useEffect, useRef } from 'react';
import { useErc20TransferEventManager } from './erc20-transfer-event-context';
import type { Erc20TransferEvent } from './erc20-transfer-event-manager';

/**
 * Options for useErc20TransferWatch hook
 */
export interface UseErc20TransferWatchOptions {
  /**
   * EVM chain ID to watch events on
   * Example: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * ERC-20 token contract address to watch
   * Example: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" (WETH)
   *
   * Set to null to disable watching
   */
  tokenAddress: string | null;

  /**
   * Wallet address to filter Transfer events for
   * Only events where this wallet is the sender OR receiver will trigger callback
   * Example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
   *
   * Set to null to disable watching
   */
  walletAddress: string | null;

  /**
   * Callback function invoked when relevant Transfer event detected
   * Receives event data including from, to, value, txHash, etc.
   *
   * @param event - Transfer event data
   */
  onTransfer: (event: Erc20TransferEvent) => void;

  /**
   * Whether watching is enabled
   * Set to false to temporarily disable without unmounting component
   *
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook to watch ERC-20 Transfer events for a specific token and wallet
 *
 * Subscribes to the singleton event manager on mount and unsubscribes on unmount.
 * Automatically handles component lifecycle and prevents memory leaks.
 *
 * **Important:** This hook does NOT return anything. It manages subscriptions as a side effect.
 * Use the `onTransfer` callback to react to events.
 *
 * @param options - Configuration options for watching Transfer events
 *
 * @example
 * ```tsx
 * // Basic usage: refetch balance when transfer detected
 * function TokenCard({ token, wallet }) {
 *   const { refetch } = useTokenBalance({ token, wallet });
 *
 *   useErc20TransferWatch({
 *     chainId: 1,
 *     tokenAddress: token,
 *     walletAddress: wallet,
 *     onTransfer: () => refetch(),
 *   });
 *
 *   return <div>...</div>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Conditional watching: only watch when modal is open
 * function TransferModal({ isOpen, token, wallet }) {
 *   useErc20TransferWatch({
 *     chainId: 1,
 *     tokenAddress: token,
 *     walletAddress: wallet,
 *     onTransfer: (event) => {
 *       toast.success(`Transfer detected: ${event.value} tokens`);
 *     },
 *     enabled: isOpen, // Only watch when modal is open
 *   });
 *
 *   return <Modal isOpen={isOpen}>...</Modal>;
 * }
 * ```
 */
export function useErc20TransferWatch(
  options: UseErc20TransferWatchOptions
): void {
  const {
    chainId,
    tokenAddress,
    walletAddress,
    onTransfer,
    enabled = true,
  } = options;

  // Get singleton manager from context
  const manager = useErc20TransferEventManager();

  // Store callback in ref to avoid re-subscribing when it changes
  // This is a performance optimization: changing the callback doesn't
  // trigger unsubscribe/resubscribe, we just use the latest callback
  const callbackRef = useRef(onTransfer);
  callbackRef.current = onTransfer;

  useEffect(() => {
    // Don't subscribe if disabled or missing required params
    if (!enabled || !tokenAddress || !walletAddress) {
      return;
    }

    // Subscribe to Transfer events
    const unsubscribe = manager.subscribe(
      chainId,
      tokenAddress,
      walletAddress,
      (event) => {
        // Use latest callback from ref (not stale closure)
        callbackRef.current(event);
      }
    );

    // Cleanup: unsubscribe when component unmounts or dependencies change
    return () => {
      unsubscribe();
    };
  }, [enabled, chainId, tokenAddress, walletAddress, manager]);
}
