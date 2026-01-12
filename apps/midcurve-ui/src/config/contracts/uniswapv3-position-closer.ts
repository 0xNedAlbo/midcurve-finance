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
 * This is the shared contract - one per chain, shared by all users.
 * Each order specifies its own operator (user's autowallet).
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
      { name: 'pool', type: 'address' },
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
      {
        name: 'cfg',
        type: 'tuple',
        components: [
          { name: 'pool', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'sqrtPriceX96Lower', type: 'uint160' },
          { name: 'sqrtPriceX96Upper', type: 'uint160' },
          { name: 'mode', type: 'uint8' },  // TriggerMode enum: 0=LOWER_ONLY, 1=UPPER_ONLY, 2=BOTH
          { name: 'payout', type: 'address' },
          { name: 'operator', type: 'address' },
          { name: 'validUntil', type: 'uint256' },
          { name: 'slippageBps', type: 'uint16' },
          // SwapIntent tuple for optional post-close swap
          {
            name: 'swap',
            type: 'tuple',
            components: [
              { name: 'direction', type: 'uint8' },     // SwapDirection: 0=NONE, 1=BASE_TO_QUOTE, 2=QUOTE_TO_BASE
              { name: 'quoteToken', type: 'address' },  // User's quote token (token0 or token1)
              { name: 'swapSlippageBps', type: 'uint16' },  // Slippage for swap (0-10000)
            ],
          },
        ],
      },
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
      { name: 'mode', type: 'uint8' },  // TriggerMode enum: 0=LOWER_ONLY, 1=UPPER_ONLY, 2=BOTH
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
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: false },
      { name: 'operator', type: 'address', indexed: false },
      { name: 'payout', type: 'address', indexed: false },
      { name: 'lower', type: 'uint160', indexed: false },
      { name: 'upper', type: 'uint160', indexed: false },
      { name: 'mode', type: 'uint8', indexed: false },
      { name: 'validUntil', type: 'uint256', indexed: false },
      { name: 'slippageBps', type: 'uint16', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CloseFeeApplied',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'feeRecipient', type: 'address', indexed: true },
      { name: 'feeBps', type: 'uint16', indexed: false },
      { name: 'feeAmount0', type: 'uint256', indexed: false },
      { name: 'feeAmount1', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CloseExecuted',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'payout', type: 'address', indexed: false },
      { name: 'executionSqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'amount0Out', type: 'uint256', indexed: false },
      { name: 'amount1Out', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CloseCancelled',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'CloseOperatorUpdated',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'oldOperator', type: 'address', indexed: true },
      { name: 'newOperator', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ClosePayoutUpdated',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'oldPayout', type: 'address', indexed: true },
      { name: 'newPayout', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'CloseBoundsUpdated',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'oldLower', type: 'uint160', indexed: false },
      { name: 'oldUpper', type: 'uint160', indexed: false },
      { name: 'oldMode', type: 'uint8', indexed: false },
      { name: 'newLower', type: 'uint160', indexed: false },
      { name: 'newUpper', type: 'uint160', indexed: false },
      { name: 'newMode', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CloseValidUntilUpdated',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'oldValidUntil', type: 'uint256', indexed: false },
      { name: 'newValidUntil', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CloseSlippageUpdated',
    inputs: [
      { name: 'closeId', type: 'uint256', indexed: true },
      { name: 'oldSlippageBps', type: 'uint16', indexed: false },
      { name: 'newSlippageBps', type: 'uint16', indexed: false },
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
