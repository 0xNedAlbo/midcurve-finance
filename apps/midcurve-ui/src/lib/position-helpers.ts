/**
 * Position Helper Functions - Protocol-Agnostic Utilities
 *
 * Provides protocol-specific logic for operations that vary by DEX protocol:
 * - Delete endpoint routing
 * - Position identifier formatting
 * - Chain name formatting
 *
 * These helpers enable protocol-agnostic components to work with
 * protocol-specific data structures and API endpoints.
 */

import type { ListPositionData } from '@midcurve/api-shared';

/**
 * Get DELETE endpoint for a position
 *
 * Routes to protocol-specific DELETE endpoint based on position protocol.
 *
 * @param position - Position data (protocol-agnostic type)
 * @returns API endpoint URL for deleting the position
 * @throws Error if protocol doesn't support deletion
 *
 * @example
 * ```typescript
 * // UniswapV3 position
 * getDeleteEndpoint(position)
 * // => "/api/v1/positions/uniswapv3/1/123456"
 *
 * // Orca position (future)
 * getDeleteEndpoint(position)
 * // => "/api/v1/positions/orca/abc123def456"
 * ```
 */
export function getDeleteEndpoint(position: ListPositionData): string {
  switch (position.protocol) {
    case 'uniswapv3': {
      const config = position.config as { chainId: number; nftId: number };
      return `/api/v1/positions/uniswapv3/${config.chainId}/${config.nftId}`;
    }
    // Future: Add Orca, Raydium, etc.
    // case 'orca': {
    //   const config = position.config as { positionId: string };
    //   return `/api/v1/positions/orca/${config.positionId}`;
    // }
    default:
      throw new Error(`Delete not supported for protocol: ${position.protocol}`);
  }
}

/**
 * Get human-readable position identifier
 *
 * Formats position identifier for display based on protocol conventions.
 *
 * @param position - Position data (protocol-agnostic type)
 * @returns Formatted identifier string
 *
 * @example
 * ```typescript
 * // UniswapV3 NFT
 * getPositionIdentifier(position) // => "#123456"
 *
 * // Orca position (future)
 * getPositionIdentifier(position) // => "abc123de..."
 * ```
 */
export function getPositionIdentifier(position: ListPositionData): string {
  switch (position.protocol) {
    case 'uniswapv3': {
      const config = position.config as { nftId: number };
      return `#${config.nftId}`;
    }
    // Future: Add Orca, Raydium, etc.
    // case 'orca': {
    //   const config = position.config as { positionId: string };
    //   return config.positionId.slice(0, 8) + '...';
    // }
    default:
      return position.id.slice(0, 8) + '...';
  }
}

/**
 * Format EVM chain ID to human-readable name
 *
 * Converts numeric chain ID to display name.
 *
 * @param chainId - EVM chain ID (e.g., 1 = Ethereum)
 * @returns Human-readable chain name
 *
 * @example
 * ```typescript
 * formatChainName(1)      // => "Ethereum"
 * formatChainName(42161)  // => "Arbitrum"
 * formatChainName(999)    // => "Chain 999"
 * ```
 */
export function formatChainName(chainId: number): string {
  const chains: Record<number, string> = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    8453: 'Base',
    56: 'BNB Chain',
    137: 'Polygon',
    10: 'Optimism',
  };
  return chains[chainId] || `Chain ${chainId}`;
}
