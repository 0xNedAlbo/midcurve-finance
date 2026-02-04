/**
 * UniswapV3PositionCloser ABI
 *
 * Partial ABI for the PositionCloser Diamond contract, containing only the
 * functions needed for registering SL/TP orders from the frontend.
 */

export const POSITION_CLOSER_ABI = [
  // registerOrder function
  {
    type: 'function',
    name: 'registerOrder',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'nftId', type: 'uint256' },
          { name: 'pool', type: 'address' },
          { name: 'triggerMode', type: 'uint8' },  // TriggerMode enum: 0=LOWER, 1=UPPER
          { name: 'triggerTick', type: 'int24' },
          { name: 'payout', type: 'address' },
          { name: 'operator', type: 'address' },
          { name: 'validUntil', type: 'uint256' },
          { name: 'slippageBps', type: 'uint16' },
          { name: 'swapDirection', type: 'uint8' },  // SwapDirection enum: 0=NONE, 1=TOKEN0_TO_1, 2=TOKEN1_TO_0
          { name: 'swapSlippageBps', type: 'uint16' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // cancelOrder function
  {
    type: 'function',
    name: 'cancelOrder',
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'triggerMode', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // hasOrder view function
  {
    type: 'function',
    name: 'hasOrder',
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'triggerMode', type: 'uint8' },
    ],
    outputs: [{ name: 'exists', type: 'bool' }],
    stateMutability: 'view',
  },
  // getOrder view function
  {
    type: 'function',
    name: 'getOrder',
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'triggerMode', type: 'uint8' },
    ],
    outputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'status', type: 'uint8' },
          { name: 'nftId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'pool', type: 'address' },
          { name: 'triggerTick', type: 'int24' },
          { name: 'payout', type: 'address' },
          { name: 'operator', type: 'address' },
          { name: 'validUntil', type: 'uint256' },
          { name: 'slippageBps', type: 'uint16' },
          { name: 'swapDirection', type: 'uint8' },
          { name: 'swapSlippageBps', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  // Events
  {
    type: 'event',
    name: 'OrderRegistered',
    inputs: [
      { name: 'nftId', type: 'uint256', indexed: true },
      { name: 'triggerMode', type: 'uint8', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: false },
      { name: 'operator', type: 'address', indexed: false },
      { name: 'payout', type: 'address', indexed: false },
      { name: 'triggerTick', type: 'int24', indexed: false },
      { name: 'validUntil', type: 'uint256', indexed: false },
      { name: 'slippageBps', type: 'uint16', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OrderCancelled',
    inputs: [
      { name: 'nftId', type: 'uint256', indexed: true },
      { name: 'triggerMode', type: 'uint8', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
] as const;
