/**
 * ABI for IPositionStore
 * From contracts/src/interfaces/IPositionStore.sol
 */
export const POSITION_STORE_ABI = [
  // updatePosition(bytes32 positionId, PositionState calldata state)
  {
    type: 'function',
    name: 'updatePosition',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'nftTokenId', type: 'uint256' },
          { name: 'poolId', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'liquidity', type: 'uint128' },
          { name: 'feeGrowthInside0LastX128', type: 'uint256' },
          { name: 'feeGrowthInside1LastX128', type: 'uint256' },
          { name: 'tokensOwed0', type: 'uint128' },
          { name: 'tokensOwed1', type: 'uint128' },
          { name: 'lastUpdated', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // getPosition(bytes32 positionId) returns (PositionState memory)
  {
    type: 'function',
    name: 'getPosition',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'nftTokenId', type: 'uint256' },
          { name: 'poolId', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'liquidity', type: 'uint128' },
          { name: 'feeGrowthInside0LastX128', type: 'uint256' },
          { name: 'feeGrowthInside1LastX128', type: 'uint256' },
          { name: 'tokensOwed0', type: 'uint128' },
          { name: 'tokensOwed1', type: 'uint128' },
          { name: 'lastUpdated', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  // isOwner(bytes32 positionId, address strategy) returns (bool)
  {
    type: 'function',
    name: 'isOwner',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'strategy', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  // Events
  {
    type: 'event',
    name: 'PositionUpdated',
    inputs: [
      { name: 'positionId', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'liquidity', type: 'uint128', indexed: false },
    ],
  },
  // Errors
  {
    type: 'error',
    name: 'NotPositionOwner',
    inputs: [],
  },
] as const;
