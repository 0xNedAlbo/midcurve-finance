/**
 * Uniswap V3 NonfungiblePositionManager Contract Configuration
 *
 * Contract addresses and ABI for the NonfungiblePositionManager contract
 * across all supported EVM chains.
 *
 * Note: BSC uses PancakeSwap V3, which has a different contract address.
 */

import type { Address } from 'viem';

/**
 * NonfungiblePositionManager contract addresses by chain ID
 */
export const NONFUNGIBLE_POSITION_MANAGER_ADDRESSES: Record<number, Address> = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Ethereum
  42161: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Arbitrum
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', // Base
  137: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Polygon
  10: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Optimism
  56: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613', // BSC (PancakeSwap V3)
};

/**
 * Get NonfungiblePositionManager address for a given chain ID
 */
export function getNonfungiblePositionManagerAddress(
  chainId: number
): Address | undefined {
  return NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId];
}

/**
 * NonfungiblePositionManager ABI
 * Contains functions for position creation, modification, and withdrawal
 */
export const NONFUNGIBLE_POSITION_MANAGER_ABI = [
  // mint() - Create new position
  {
    inputs: [
      {
        components: [
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'amount0Desired', type: 'uint256' },
          { name: 'amount1Desired', type: 'uint256' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'mint',
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  // increaseLiquidity() - Add liquidity to existing position
  {
    inputs: [
      {
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'amount0Desired', type: 'uint256' },
          { name: 'amount1Desired', type: 'uint256' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'increaseLiquidity',
    outputs: [
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  // decreaseLiquidity() - Remove liquidity from position
  {
    inputs: [
      {
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'liquidity', type: 'uint128' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'decreaseLiquidity',
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  // collect() - Collect tokens from position
  {
    inputs: [
      {
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'amount0Max', type: 'uint128' },
          { name: 'amount1Max', type: 'uint128' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'collect',
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  // multicall() - Execute multiple operations in one transaction
  {
    inputs: [{ name: 'data', type: 'bytes[]' }],
    name: 'multicall',
    outputs: [{ name: 'results', type: 'bytes[]' }],
    stateMutability: 'payable',
    type: 'function',
  },
  // Transfer event for extracting tokenId
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: true, name: 'tokenId', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
  // IncreaseLiquidity event
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'liquidity', type: 'uint128' },
      { indexed: false, name: 'amount0', type: 'uint256' },
      { indexed: false, name: 'amount1', type: 'uint256' },
    ],
    name: 'IncreaseLiquidity',
    type: 'event',
  },
  // DecreaseLiquidity event
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'liquidity', type: 'uint128' },
      { indexed: false, name: 'amount0', type: 'uint256' },
      { indexed: false, name: 'amount1', type: 'uint256' },
    ],
    name: 'DecreaseLiquidity',
    type: 'event',
  },
  // Collect event
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'recipient', type: 'address' },
      { indexed: false, name: 'amount0', type: 'uint256' },
      { indexed: false, name: 'amount1', type: 'uint256' },
    ],
    name: 'Collect',
    type: 'event',
  },
] as const;
