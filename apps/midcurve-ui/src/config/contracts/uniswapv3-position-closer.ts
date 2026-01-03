/**
 * UniswapV3PositionCloser Contract Configuration
 *
 * ABI and utilities for interacting with the automation position closer contract.
 * This contract allows users to set up automated close orders for their positions.
 *
 * On-Chain Access Control:
 * - registerClose()   - msg.sender == ownerOf(nftId)  → User signs via Wagmi
 * - cancelClose()     - msg.sender == order.owner    → User signs via Wagmi
 * - setCloseBounds()  - msg.sender == order.owner    → User signs via Wagmi
 * - setCloseOperator()- msg.sender == order.owner    → User signs via Wagmi
 * - setClosePayout()  - msg.sender == order.owner    → User signs via Wagmi
 * - setCloseValidUntil() - msg.sender == order.owner → User signs via Wagmi
 * - setCloseSlippage()- msg.sender == order.owner    → User signs via Wagmi
 * - executeClose()    - msg.sender == order.operator → Automation wallet signs
 */

/**
 * UniswapV3PositionCloser ABI
 *
 * Minimal ABI with only the functions needed for UI interaction.
 * Full contract deployed separately per user per chain.
 */
export const POSITION_CLOSER_ABI = [
  // =============================================================================
  // View Functions
  // =============================================================================
  {
    type: 'function',
    name: 'nfpm',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'closeOrders',
    inputs: [{ name: 'closeId', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
      { name: 'nftId', type: 'uint256' },
      { name: 'sqrtPriceX96Lower', type: 'uint160' },
      { name: 'sqrtPriceX96Upper', type: 'uint160' },
      { name: 'payoutAddress', type: 'address' },
      { name: 'validUntil', type: 'uint256' },
      { name: 'slippageBps', type: 'uint16' },
      { name: 'executed', type: 'bool' },
      { name: 'cancelled', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'closeIdCounter',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },

  // =============================================================================
  // Registration & Lifecycle (User Signs)
  // =============================================================================
  {
    type: 'function',
    name: 'registerClose',
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'sqrtPriceX96Lower', type: 'uint160' },
      { name: 'sqrtPriceX96Upper', type: 'uint160' },
      { name: 'payoutAddress', type: 'address' },
      { name: 'validUntil', type: 'uint256' },
      { name: 'slippageBps', type: 'uint16' },
    ],
    outputs: [{ name: 'closeId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'cancelClose',
    inputs: [{ name: 'closeId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // =============================================================================
  // Update Functions (User Signs)
  // =============================================================================
  {
    type: 'function',
    name: 'setCloseBounds',
    inputs: [
      { name: 'closeId', type: 'uint256' },
      { name: 'sqrtPriceX96Lower', type: 'uint160' },
      { name: 'sqrtPriceX96Upper', type: 'uint160' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setCloseOperator',
    inputs: [
      { name: 'closeId', type: 'uint256' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setClosePayout',
    inputs: [
      { name: 'closeId', type: 'uint256' },
      { name: 'payoutAddress', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setCloseValidUntil',
    inputs: [
      { name: 'closeId', type: 'uint256' },
      { name: 'validUntil', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setCloseSlippage',
    inputs: [
      { name: 'closeId', type: 'uint256' },
      { name: 'slippageBps', type: 'uint16' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // =============================================================================
  // Execution (Automation Wallet Signs)
  // =============================================================================
  {
    type: 'function',
    name: 'executeClose',
    inputs: [
      { name: 'closeId', type: 'uint256' },
      { name: 'feeRecipient', type: 'address' },
      { name: 'feeBps', type: 'uint16' },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },

  // =============================================================================
  // Events
  // =============================================================================
  {
    type: 'event',
    name: 'CloseRegistered',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'nftId', type: 'uint256', indexed: true },
      { name: 'sqrtPriceX96Lower', type: 'uint160', indexed: false },
      { name: 'sqrtPriceX96Upper', type: 'uint160', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CloseExecuted',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'executor', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CloseCancelled',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'CloseBoundsUpdated',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'sqrtPriceX96Lower', type: 'uint160', indexed: false },
      { name: 'sqrtPriceX96Upper', type: 'uint160', indexed: false },
    ],
  },
] as const;

/**
 * Event topic for CloseRegistered event
 * keccak256("CloseRegistered(uint256,address,uint256,uint160,uint160)")
 */
export const CLOSE_REGISTERED_EVENT_TOPIC =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'; // TODO: Calculate actual topic

/**
 * Event topic for CloseExecuted event
 */
export const CLOSE_EXECUTED_EVENT_TOPIC =
  '0x0000000000000000000000000000000000000000000000000000000000000000'; // TODO: Calculate actual topic

/**
 * Event topic for CloseCancelled event
 */
export const CLOSE_CANCELLED_EVENT_TOPIC =
  '0x0000000000000000000000000000000000000000000000000000000000000000'; // TODO: Calculate actual topic
