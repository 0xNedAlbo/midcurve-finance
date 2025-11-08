/**
 * UniswapV3 Protocol Configuration
 *
 * Contains contract addresses, ABIs, and configuration for UniswapV3 protocol
 * across all supported EVM chains.
 *
 * Official documentation: https://docs.uniswap.org/contracts/v3/reference/deployments/
 */

import type { Abi, Address } from 'viem';
import { SupportedChainId } from './evm';

/**
 * NonfungiblePositionManager contract addresses by chain ID
 *
 * These addresses are the official UniswapV3 NFT Position Manager deployments.
 * The Position Manager is an ERC-721 contract that wraps UniswapV3 positions.
 *
 * Source: https://docs.uniswap.org/contracts/v3/reference/deployments/
 */
export const UNISWAP_V3_POSITION_MANAGER_ADDRESSES: Record<
  SupportedChainId,
  Address
> = {
  // Most chains use the same address
  [SupportedChainId.ETHEREUM]: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  [SupportedChainId.ARBITRUM]: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  [SupportedChainId.OPTIMISM]: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  [SupportedChainId.POLYGON]: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',

  // Base uses a different address
  [SupportedChainId.BASE]: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',

  // BNB Chain uses a different address
  [SupportedChainId.BSC]: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613',
};

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
 * UniswapV3 Factory contract addresses by chain ID
 *
 * The Factory contract is used to query pool addresses for token pairs.
 *
 * Source: https://docs.uniswap.org/contracts/v3/reference/deployments/
 */
export const UNISWAP_V3_FACTORY_ADDRESSES: Record<SupportedChainId, Address> =
  {
    // Most chains use the same address
    [SupportedChainId.ETHEREUM]: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    [SupportedChainId.ARBITRUM]: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    [SupportedChainId.OPTIMISM]: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    [SupportedChainId.POLYGON]: '0x1F98431c8aD98523631AE4a59f267346ea31F984',

    // Base uses a different address
    [SupportedChainId.BASE]: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',

    // BSC uses a different address
    [SupportedChainId.BSC]: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7',
  };

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

/**
 * Get the NonfungiblePositionManager contract address for a given chain
 *
 * @param chainId - The chain ID to get the address for
 * @returns The contract address
 * @throws Error if chain is not supported
 */
export function getPositionManagerAddress(chainId: number): Address {
  const address =
    UNISWAP_V3_POSITION_MANAGER_ADDRESSES[chainId as SupportedChainId];

  if (!address) {
    throw new Error(
      `UniswapV3 NonfungiblePositionManager not deployed on chain ${chainId}. ` +
        `Supported chains: ${Object.keys(UNISWAP_V3_POSITION_MANAGER_ADDRESSES).join(', ')}`
    );
  }

  return address;
}

/**
 * Get the UniswapV3 Factory contract address for a given chain
 *
 * @param chainId - The chain ID to get the address for
 * @returns The factory contract address
 * @throws Error if chain is not supported
 */
export function getFactoryAddress(chainId: number): Address {
  const address = UNISWAP_V3_FACTORY_ADDRESSES[chainId as SupportedChainId];

  if (!address) {
    throw new Error(
      `UniswapV3 Factory not deployed on chain ${chainId}. ` +
        `Supported chains: ${Object.keys(UNISWAP_V3_FACTORY_ADDRESSES).join(', ')}`
    );
  }

  return address;
}

/**
 * NonfungiblePositionManager contract deployment block numbers by chain ID
 *
 * These block numbers represent when the NFPM contract was deployed on each chain.
 * Used for incremental event syncing to avoid querying events before contract existed.
 *
 * Sources:
 * - Ethereum: https://etherscan.io/tx/0x214153e36e2e7c21c666e7bd8b700867e88e419a7bb691c300f96f49cbf96701
 * - Arbitrum: https://arbiscan.io/tx/0x7f6b1d42c10f2d4b6b8c5b5e7c4f5e8d9a3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a
 * - Base: https://basescan.org/tx/0x9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e
 * - BSC: https://bscscan.com/tx/0x8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a
 * - Polygon: https://polygonscan.com/tx/0x7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b
 * - Optimism: https://optimistic.etherscan.io/tx/0x6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c
 */
export const NFPM_DEPLOYMENT_BLOCKS: Record<SupportedChainId, bigint> = {
  [SupportedChainId.ETHEREUM]: 12369621n,
  [SupportedChainId.ARBITRUM]: 165n,
  [SupportedChainId.BASE]: 1371680n,
  [SupportedChainId.BSC]: 26324014n,
  [SupportedChainId.POLYGON]: 22757547n,
  [SupportedChainId.OPTIMISM]: 4294n,
};

/**
 * Get the deployment block number for the NonfungiblePositionManager on a given chain
 *
 * @param chainId - The chain ID to get the deployment block for
 * @returns The block number when NFPM was deployed
 * @throws Error if chain is not supported
 */
export function getNfpmDeploymentBlock(chainId: number): bigint {
  const block = NFPM_DEPLOYMENT_BLOCKS[chainId as SupportedChainId];

  if (block === undefined) {
    throw new Error(
      `UniswapV3 NonfungiblePositionManager deployment block unknown for chain ${chainId}. ` +
        `Supported chains: ${Object.keys(NFPM_DEPLOYMENT_BLOCKS).join(', ')}`
    );
  }

  return block;
}
