/**
 * ABI for the PoolStore contract
 * Source: contracts/src/interfaces/IPoolStore.sol
 */
export const POOL_STORE_ABI = [
  {
    type: 'function',
    name: 'updatePool',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'poolAddress', type: 'address' },
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceX96', type: 'uint160' },
          { name: 'tick', type: 'int24' },
          { name: 'liquidity', type: 'uint128' },
          { name: 'feeGrowthGlobal0X128', type: 'uint256' },
          { name: 'feeGrowthGlobal1X128', type: 'uint256' },
          { name: 'lastUpdated', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getPool',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'poolAddress', type: 'address' },
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceX96', type: 'uint160' },
          { name: 'tick', type: 'int24' },
          { name: 'liquidity', type: 'uint128' },
          { name: 'feeGrowthGlobal0X128', type: 'uint256' },
          { name: 'feeGrowthGlobal1X128', type: 'uint256' },
          { name: 'lastUpdated', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentPrice',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentTick',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: 'tick', type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'PoolUpdated',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },
] as const;

/**
 * TypeScript type for PoolState
 */
export interface PoolState {
  chainId: bigint;
  poolAddress: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee: number;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
  lastUpdated: bigint;
}
