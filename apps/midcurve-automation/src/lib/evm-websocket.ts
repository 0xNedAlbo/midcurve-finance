/**
 * WebSocket Client Utilities for EVM Chains
 *
 * Provides WebSocket-enabled public clients for event subscriptions.
 * Separate from HTTP clients (evm.ts) to allow independent lifecycle management.
 */

import { createPublicClient, webSocket, type PublicClient, type Chain } from 'viem';
import { mainnet, arbitrum, base, sepolia, localhost } from 'viem/chains';
import { getWsRpcEnvVarName } from '@midcurve/shared';
import type { SupportedChainId } from './config';
import { automationLogger } from './logger';

const log = automationLogger.child({ component: 'evm-websocket' });

/**
 * Production chain configurations with WebSocket RPC environment variables
 * WS env var names derived from chain registry.
 */
const PRODUCTION_WS_CONFIGS: Record<number, { chain: Chain; rpcEnvVar: string }> = {
  1: { chain: mainnet, rpcEnvVar: getWsRpcEnvVarName(1) },
  42161: { chain: arbitrum, rpcEnvVar: getWsRpcEnvVarName(42161) },
  8453: { chain: base, rpcEnvVar: getWsRpcEnvVarName(8453) },
};

/**
 * Development chain configurations (dev/test only)
 */
const DEV_WS_CONFIGS: Record<number, { chain: Chain; rpcEnvVar: string }> = {
  11155111: { chain: sepolia, rpcEnvVar: getWsRpcEnvVarName(11155111) },
  31337: { chain: { ...localhost, id: 31337 }, rpcEnvVar: getWsRpcEnvVarName(31337) },
};

/**
 * WebSocket chain configurations
 * Dev chains are only included in non-production environments.
 */
const WS_CHAIN_CONFIGS: Record<SupportedChainId, { chain: Chain; rpcEnvVar: string }> =
  process.env.NODE_ENV === 'production'
    ? (PRODUCTION_WS_CONFIGS as Record<SupportedChainId, { chain: Chain; rpcEnvVar: string }>)
    : ({ ...PRODUCTION_WS_CONFIGS, ...DEV_WS_CONFIGS } as Record<
        SupportedChainId,
        { chain: Chain; rpcEnvVar: string }
      >);

/**
 * Cache for WebSocket clients (one per chain)
 */
const wsClientCache = new Map<SupportedChainId, PublicClient>();

/**
 * Get WebSocket RPC URL for a chain from environment
 * Returns undefined if not configured (graceful degradation)
 */
function getWsRpcUrl(chainId: SupportedChainId): string | undefined {
  const config = WS_CHAIN_CONFIGS[chainId];
  if (!config) return undefined;
  return process.env[config.rpcEnvVar];
}

/**
 * Check if WebSocket is available for a chain
 *
 * @param chainId - Chain ID to check
 * @returns true if WebSocket RPC URL is configured
 */
export function isWebSocketAvailable(chainId: number): boolean {
  const config = WS_CHAIN_CONFIGS[chainId as SupportedChainId];
  if (!config) return false;
  return !!process.env[config.rpcEnvVar];
}

/**
 * Get or create a WebSocket public client for a chain
 *
 * Returns null if WebSocket URL not configured (allows graceful degradation).
 * Use isWebSocketAvailable() to check before calling.
 *
 * @param chainId - Chain ID
 * @returns PublicClient with WebSocket transport, or null if unavailable
 */
export function getWebSocketClient(chainId: SupportedChainId): PublicClient | null {
  // Check cache first
  const cached = wsClientCache.get(chainId);
  if (cached) return cached;

  // Get WebSocket URL
  const wsUrl = getWsRpcUrl(chainId);
  if (!wsUrl) {
    log.warn({ chainId, msg: 'WebSocket RPC URL not configured for chain' });
    return null;
  }

  // Get chain configuration
  const config = WS_CHAIN_CONFIGS[chainId];
  if (!config) {
    log.warn({ chainId, msg: 'Chain configuration not found' });
    return null;
  }

  // Create client with reconnection settings
  const client = createPublicClient({
    chain: config.chain,
    transport: webSocket(wsUrl, {
      reconnect: {
        attempts: 10,
        delay: 3000,
      },
    }),
  });

  wsClientCache.set(chainId, client);

  log.info({
    chainId,
    chain: config.chain.name,
    msg: 'Created WebSocket client',
  });

  return client;
}

/**
 * Close a WebSocket client for a chain
 *
 * Removes from cache and allows garbage collection.
 *
 * @param chainId - Chain ID to close
 */
export function closeWebSocketClient(chainId: SupportedChainId): void {
  const cached = wsClientCache.get(chainId);
  if (cached) {
    wsClientCache.delete(chainId);
    log.info({ chainId, msg: 'Closed WebSocket client' });
  }
}

/**
 * Close all WebSocket clients
 *
 * Call during graceful shutdown.
 */
export function closeAllWebSocketClients(): void {
  const chainIds = Array.from(wsClientCache.keys());
  for (const chainId of chainIds) {
    closeWebSocketClient(chainId);
  }
  log.info({ closedCount: chainIds.length, msg: 'Closed all WebSocket clients' });
}

/**
 * Get the count of active WebSocket clients
 */
export function getActiveWebSocketClientCount(): number {
  return wsClientCache.size;
}

/**
 * Get list of chain IDs with active WebSocket clients
 */
export function getActiveWebSocketChainIds(): SupportedChainId[] {
  return Array.from(wsClientCache.keys());
}
