/**
 * MidcurveSwapRouter ABI (minimal subset for service reads)
 */

import type { Abi } from 'viem';

/**
 * Minimal ABI for MidcurveSwapRouter read operations.
 * Only includes functions needed by SwapRouterService.
 */
export const MIDCURVE_SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'getSwapTokens',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'isSwapToken',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getAdapter',
    stateMutability: 'view',
    inputs: [{ name: 'venueId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const satisfies Abi;
