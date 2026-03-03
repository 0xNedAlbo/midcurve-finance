/**
 * UniswapV3 Protocol Configuration
 *
 * Single source of truth for UniswapV3 contract addresses and deployment
 * metadata across all supported EVM chains.
 *
 * Consumed by both frontend and backend packages.
 * No runtime dependencies (pure data + lookup functions).
 *
 * Official docs: https://docs.uniswap.org/contracts/v3/reference/deployments/
 */

// ============================================================================
// Supported Chains
// ============================================================================

/** Chain IDs where UniswapV3 is deployed */
export const UNISWAPV3_CHAIN_IDS: readonly number[] = [
  1, // Ethereum
  42161, // Arbitrum
  8453, // Base
  11155111, // Sepolia
  31337, // Local Anvil fork
];

/** Check if a chain has UniswapV3 deployed */
export function isUniswapV3Chain(chainId: number): boolean {
  return UNISWAPV3_CHAIN_IDS.includes(chainId);
}

// ============================================================================
// NonfungiblePositionManager (NFPM) Addresses
// ============================================================================

/** Hex address type (compatible with viem Address without the dependency) */
type HexAddress = `0x${string}`;

/**
 * NFPM contract addresses by chain ID.
 * The Position Manager is an ERC-721 contract that wraps UniswapV3 positions.
 */
export const UNISWAPV3_NFPM_ADDRESSES: Readonly<Record<number, HexAddress>> = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  42161: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  11155111: '0x1238536071E1c677A632429e3655c799b22cDA52',
  31337: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Anvil forks mainnet
};

/** Get NFPM address for a chain. Throws if chain is not supported. */
export function getUniswapV3NfpmAddress(chainId: number): HexAddress {
  const address = UNISWAPV3_NFPM_ADDRESSES[chainId];
  if (!address) {
    throw new Error(
      `UniswapV3 NFPM not deployed on chain ${chainId}. ` +
        `Supported: ${UNISWAPV3_CHAIN_IDS.join(', ')}`
    );
  }
  return address;
}

// ============================================================================
// Factory Addresses
// ============================================================================

/**
 * Factory contract addresses by chain ID.
 * Used for pool discovery and validation.
 */
export const UNISWAPV3_FACTORY_ADDRESSES: Readonly<Record<number, HexAddress>> = {
  1: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  42161: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  11155111: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
  31337: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Anvil forks mainnet
};

/** Get Factory address for a chain. Throws if chain is not supported. */
export function getUniswapV3FactoryAddress(chainId: number): HexAddress {
  const address = UNISWAPV3_FACTORY_ADDRESSES[chainId];
  if (!address) {
    throw new Error(
      `UniswapV3 Factory not deployed on chain ${chainId}. ` +
        `Supported: ${UNISWAPV3_CHAIN_IDS.join(', ')}`
    );
  }
  return address;
}

// ============================================================================
// NFPM Deployment Blocks
// ============================================================================

/**
 * Block numbers when the NFPM contract was deployed on each chain.
 * Used for incremental event syncing to avoid querying before contract existed.
 */
export const UNISWAPV3_NFPM_DEPLOYMENT_BLOCKS: Readonly<Record<number, bigint>> =
  {
    1: 12369621n,
    42161: 165n,
    8453: 1371680n,
    11155111: 3510000n,
    31337: 12369621n, // Anvil forks mainnet
  };

/** Get NFPM deployment block for a chain. Throws if chain is not supported. */
export function getUniswapV3NfpmDeploymentBlock(chainId: number): bigint {
  const block = UNISWAPV3_NFPM_DEPLOYMENT_BLOCKS[chainId];
  if (block === undefined) {
    throw new Error(
      `UniswapV3 NFPM deployment block unknown for chain ${chainId}. ` +
        `Supported: ${UNISWAPV3_CHAIN_IDS.join(', ')}`
    );
  }
  return block;
}
