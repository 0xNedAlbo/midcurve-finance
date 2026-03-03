/**
 * UniswapV3 Protocol Configuration
 *
 * ABIs and type definitions for UniswapV3 protocol.
 * Contract addresses and deployment metadata are imported from @midcurve/shared.
 *
 * Official documentation: https://docs.uniswap.org/contracts/v3/reference/deployments/
 */

import type { Abi, Address } from 'viem';

// Re-export contract addresses and lookup functions from shared package.
// Aliased to preserve existing import names across 7+ consumer files.
export {
  UNISWAPV3_NFPM_ADDRESSES as UNISWAP_V3_POSITION_MANAGER_ADDRESSES,
  UNISWAPV3_FACTORY_ADDRESSES as UNISWAP_V3_FACTORY_ADDRESSES,
  UNISWAPV3_NFPM_DEPLOYMENT_BLOCKS as NFPM_DEPLOYMENT_BLOCKS,
  getUniswapV3NfpmAddress as getPositionManagerAddress,
  getUniswapV3FactoryAddress as getFactoryAddress,
  getUniswapV3NfpmDeploymentBlock as getNfpmDeploymentBlock,
} from '@midcurve/shared';

/**
 * NonfungiblePositionManager ABI
 *
 * Contains only the functions we need for position discovery and management:
 * - positions(tokenId): Get position data
 * - ownerOf(tokenId): Get position owner
 * - balanceOf(owner): Get number of positions owned
 * - tokenOfOwnerByIndex(owner, index): Enumerate positions
 *
 * Full ABI: https://github.com/Uniswap/v3-periphery/blob/main/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json
 */
export const UNISWAP_V3_POSITION_MANAGER_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'positions',
    outputs: [
      { internalType: 'uint96', name: 'nonce', type: 'uint96' },
      { internalType: 'address', name: 'operator', type: 'address' },
      { internalType: 'address', name: 'token0', type: 'address' },
      { internalType: 'address', name: 'token1', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
      { internalType: 'int24', name: 'tickLower', type: 'int24' },
      { internalType: 'int24', name: 'tickUpper', type: 'int24' },
      { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      {
        internalType: 'uint256',
        name: 'feeGrowthInside0LastX128',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'feeGrowthInside1LastX128',
        type: 'uint256',
      },
      { internalType: 'uint128', name: 'tokensOwed0', type: 'uint128' },
      { internalType: 'uint128', name: 'tokensOwed1', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'uint256', name: 'index', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint128', name: 'amount0Max', type: 'uint128' },
          { internalType: 'uint128', name: 'amount1Max', type: 'uint128' },
        ],
        internalType: 'struct INonfungiblePositionManager.CollectParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'collect',
    outputs: [
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
] as const satisfies Abi;

/**
 * Type-safe return type for positions() function call
 */
export interface UniswapV3PositionData {
  /** Nonce for permit functionality */
  nonce: bigint;
  /** Address approved for permit functionality */
  operator: Address;
  /** Address of token0 */
  token0: Address;
  /** Address of token1 */
  token1: Address;
  /** Fee tier in basis points (e.g., 500 = 0.05%, 3000 = 0.30%) */
  fee: number;
  /** Lower tick boundary */
  tickLower: number;
  /** Upper tick boundary */
  tickUpper: number;
  /** Current liquidity in position */
  liquidity: bigint;
  /** Fee growth inside position for token0 */
  feeGrowthInside0LastX128: bigint;
  /** Fee growth inside position for token1 */
  feeGrowthInside1LastX128: bigint;
  /** Uncollected fees for token0 */
  tokensOwed0: bigint;
  /** Uncollected fees for token1 */
  tokensOwed1: bigint;
}

/**
 * UniswapV3 Factory ABI
 *
 * Contains only the getPool() function for querying pool addresses.
 */
export const UNISWAP_V3_FACTORY_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
    ],
    name: 'getPool',
    outputs: [{ internalType: 'address', name: 'pool', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const satisfies Abi;

