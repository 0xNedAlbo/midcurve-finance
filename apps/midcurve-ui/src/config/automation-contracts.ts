/**
 * Automation Contract Configuration
 *
 * Contains contract addresses for UniswapV3PositionCloser and related automation contracts.
 */

import type { Address } from 'viem';

/**
 * UniswapV3PositionCloser contract addresses by chain ID
 * These are Diamond proxy contracts that handle SL/TP order registration and execution
 */
export const POSITION_CLOSER_ADDRESSES: Record<number, Address> = {
  1: '0x66deed7C4669680BEF6484E269689490aA385d9a',      // Ethereum Mainnet
  42161: '0x543e6637352c196727CBe28B4E130a105e604a0B',  // Arbitrum One
};

/**
 * Get the PositionCloser contract address for a given chain
 * @param chainId - The chain ID
 * @returns The contract address or null if not deployed on this chain
 */
export function getPositionCloserAddress(chainId: number): Address | null {
  return POSITION_CLOSER_ADDRESSES[chainId] ?? null;
}

/**
 * Check if automation (SL/TP orders) is supported on a given chain
 * @param chainId - The chain ID
 * @returns True if automation is supported
 */
export function isAutomationSupported(chainId: number): boolean {
  return chainId in POSITION_CLOSER_ADDRESSES;
}

/**
 * Trigger modes for close orders
 */
export const TriggerMode = {
  LOWER: 0,  // Stop Loss - triggers when currentTick <= triggerTick
  UPPER: 1,  // Take Profit - triggers when currentTick >= triggerTick
} as const;

export type TriggerModeValue = typeof TriggerMode[keyof typeof TriggerMode];

/**
 * Swap directions for post-close token conversion
 */
export const SwapDirection = {
  NONE: 0,        // Keep both tokens as-is
  TOKEN0_TO_1: 1, // Swap token0 to token1
  TOKEN1_TO_0: 2, // Swap token1 to token0
} as const;

export type SwapDirectionValue = typeof SwapDirection[keyof typeof SwapDirection];

/**
 * Default slippage values for close orders
 */
export const DEFAULT_CLOSE_ORDER_SLIPPAGE = {
  liquidityBps: 50,  // 0.5% slippage for liquidity decrease
  swapBps: 100,      // 1% slippage for post-close swap
} as const;
