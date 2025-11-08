/**
 * ERC-20 Transfer Event Context
 *
 * React Context Provider that initializes and manages the ERC-20 Transfer Event Manager singleton.
 * Provides the manager instance to all child components via React Context.
 *
 * Features:
 * - Initializes singleton with wagmi's PublicClient
 * - Automatic cleanup on unmount
 * - Type-safe context access via custom hook
 *
 * Usage:
 * 1. Wrap your app with <Erc20TransferEventProvider>
 * 2. Use useErc20TransferEventManager() hook in child components
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * <Erc20TransferEventProvider>
 *   <App />
 * </Erc20TransferEventProvider>
 * ```
 *
 * @example
 * ```tsx
 * // components/token-card.tsx
 * const manager = useErc20TransferEventManager();
 * const unsubscribe = manager.subscribe(...);
 * ```
 */

'use client';

import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { usePublicClient } from 'wagmi';
import { Erc20TransferEventManager } from './erc20-transfer-event-manager';

/**
 * React Context for ERC-20 Transfer Event Manager
 * Provides singleton instance to all child components
 */
const Erc20TransferEventContext = createContext<Erc20TransferEventManager | null>(
  null
);

/**
 * Props for Erc20TransferEventProvider
 */
interface Erc20TransferEventProviderProps {
  children: ReactNode;
}

/**
 * Provider component for ERC-20 Transfer Event Manager
 *
 * Initializes the singleton with wagmi's PublicClient and provides it
 * to all child components via Context. Handles cleanup on unmount.
 *
 * @param props - Provider props
 * @param props.children - Child components that can access the manager
 */
export function Erc20TransferEventProvider({
  children,
}: Erc20TransferEventProviderProps) {
  // Get wagmi's public client for current chain
  const publicClient = usePublicClient();

  // Get singleton instance (created once, persists across re-renders)
  const manager = Erc20TransferEventManager.getInstance();

  // Update public client when it changes (chain switching, wallet connection)
  useEffect(() => {
    if (publicClient) {
      manager.setPublicClient(publicClient);
    }
  }, [publicClient, manager]);

  // Cleanup all watchers when provider unmounts (app closes)
  useEffect(() => {
    return () => {
      manager.destroy();
    };
  }, [manager]);

  return (
    <Erc20TransferEventContext.Provider value={manager}>
      {children}
    </Erc20TransferEventContext.Provider>
  );
}

/**
 * Hook to access the ERC-20 Transfer Event Manager from child components
 *
 * @returns Erc20TransferEventManager singleton instance
 * @throws Error if used outside of Erc20TransferEventProvider
 *
 * @example
 * ```tsx
 * function TokenBalance() {
 *   const manager = useErc20TransferEventManager();
 *
 *   useEffect(() => {
 *     const unsubscribe = manager.subscribe(
 *       1, // chainId
 *       '0xToken...', // tokenAddress
 *       '0xWallet...', // walletAddress
 *       (event) => console.log('Transfer:', event)
 *     );
 *
 *     return () => unsubscribe();
 *   }, [manager]);
 *
 *   return <div>...</div>;
 * }
 * ```
 */
export function useErc20TransferEventManager(): Erc20TransferEventManager {
  const manager = useContext(Erc20TransferEventContext);

  if (!manager) {
    throw new Error(
      'useErc20TransferEventManager must be used within Erc20TransferEventProvider. ' +
        'Wrap your app with <Erc20TransferEventProvider> in app/layout.tsx'
    );
  }

  return manager;
}
