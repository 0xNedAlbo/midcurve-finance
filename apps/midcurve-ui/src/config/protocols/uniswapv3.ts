/**
 * Uniswap V3 Protocol Configuration
 *
 * This file defines which EVM chains support Uniswap V3 and protocol-specific
 * contract addresses. Each protocol (PancakeSwap, Aerodrome, etc.) will have
 * its own config file defining its supported chains.
 */

import type { EvmChainSlug, ChainMetadata } from '../chains';
import { CHAIN_METADATA, isLocalChainEnabled } from '../chains';

/**
 * Chains where Uniswap V3 is deployed and supported
 *
 * Note: BSC is NOT included (PancakeSwap V3 is the alternative on BSC)
 * Local chain (31337) is conditionally included for development environments
 */
export const UNISWAPV3_SUPPORTED_CHAINS: readonly EvmChainSlug[] = isLocalChainEnabled
  ? (['ethereum', 'arbitrum', 'base', 'local'] as const)
  : (['ethereum', 'arbitrum', 'base'] as const);

/**
 * Type for UniswapV3-supported chains only
 */
export type UniswapV3ChainSlug = (typeof UNISWAPV3_SUPPORTED_CHAINS)[number];

/**
 * Get chain metadata for a specific UniswapV3-supported chain
 */
export function getUniswapV3ChainMetadata(
  slug: EvmChainSlug
): ChainMetadata | undefined {
  if (!UNISWAPV3_SUPPORTED_CHAINS.includes(slug)) {
    return undefined;
  }
  return CHAIN_METADATA[slug];
}

/**
 * Check if a chain supports UniswapV3
 */
export function isUniswapV3SupportedChain(
  slug: string
): slug is UniswapV3ChainSlug {
  return UNISWAPV3_SUPPORTED_CHAINS.includes(slug as EvmChainSlug);
}

/**
 * Get all UniswapV3 chain metadata (for wizard dropdowns, filters, etc.)
 */
export function getAllUniswapV3Chains(): ChainMetadata[] {
  return UNISWAPV3_SUPPORTED_CHAINS.map((slug) => CHAIN_METADATA[slug]).filter(
    (chain): chain is ChainMetadata => chain !== undefined
  );
}

/**
 * UniswapV3 Factory Contract Addresses
 *
 * Used for pool discovery and validation
 */
export const UNISWAPV3_FACTORY_ADDRESSES: Partial<
  Record<EvmChainSlug, string>
> = {
  ethereum: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  arbitrum: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  base: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  // Local fork uses mainnet addresses (Anvil forks Ethereum mainnet)
  ...(isLocalChainEnabled && { local: '0x1F98431c8aD98523631AE4a59f267346ea31F984' }),
};

/**
 * UniswapV3 NonfungiblePositionManager Contract Addresses
 *
 * Used for transaction execution (minting, increasing liquidity, etc.)
 */
export const UNISWAPV3_POSITION_MANAGER_ADDRESSES: Partial<
  Record<EvmChainSlug, string>
> = {
  ethereum: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  arbitrum: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  base: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  // Local fork uses mainnet addresses (Anvil forks Ethereum mainnet)
  ...(isLocalChainEnabled && { local: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88' }),
};

/**
 * Get UniswapV3 factory address for a specific chain
 */
export function getUniswapV3FactoryAddress(
  slug: UniswapV3ChainSlug
): string | undefined {
  return UNISWAPV3_FACTORY_ADDRESSES[slug];
}

/**
 * Get UniswapV3 position manager address for a specific chain
 */
export function getUniswapV3PositionManagerAddress(
  slug: UniswapV3ChainSlug
): string | undefined {
  return UNISWAPV3_POSITION_MANAGER_ADDRESSES[slug];
}

/**
 * Popular Token Configuration for UniswapV3 Wizard
 *
 * These tokens appear as quick-select options in the position creation wizard.
 * Base tokens: Asset to track (WBTC, WETH, cbBTC)
 * Quote tokens: Value reference (WETH, USDC)
 */

export interface PopularToken {
  symbol: string;
  address: string;
  name: string;
}

export const UNISWAPV3_POPULAR_TOKENS = {
  ethereum: {
    base: [
      {
        symbol: 'WETH',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        name: 'Wrapped Ether',
      },
      {
        symbol: 'WBTC',
        address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        name: 'Wrapped Bitcoin',
      },
    ],
    quote: [
      {
        symbol: 'WETH',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        name: 'Wrapped Ether',
      },
      {
        symbol: 'USDC',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        name: 'USD Coin',
      },
    ],
  },
  arbitrum: {
    base: [
      {
        symbol: 'WETH',
        address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBAb1',
        name: 'Wrapped Ether',
      },
      {
        symbol: 'WBTC',
        address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
        name: 'Wrapped Bitcoin',
      },
    ],
    quote: [
      {
        symbol: 'WETH',
        address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBAb1',
        name: 'Wrapped Ether',
      },
      {
        symbol: 'USDC',
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        name: 'USD Coin',
      },
    ],
  },
  base: {
    base: [
      {
        symbol: 'WETH',
        address: '0x4200000000000000000000000000000000000006',
        name: 'Wrapped Ether',
      },
      {
        symbol: 'cbBTC',
        address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
        name: 'Coinbase Wrapped BTC',
      },
    ],
    quote: [
      {
        symbol: 'WETH',
        address: '0x4200000000000000000000000000000000000006',
        name: 'Wrapped Ether',
      },
      {
        symbol: 'USDC',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        name: 'USD Coin',
      },
    ],
  },
  // Local chain uses mainnet tokens (Anvil forks Ethereum mainnet)
  // MockUSD needs to be discovered via token search (address varies per deployment)
  local: {
    base: [
      {
        symbol: 'WETH',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        name: 'Wrapped Ether',
      },
    ],
    quote: [
      {
        symbol: 'WETH',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        name: 'Wrapped Ether',
      },
      {
        symbol: 'USDC',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        name: 'USD Coin',
      },
    ],
  },
} as const;

/**
 * Get popular tokens for a specific chain and token type
 */
export function getUniswapV3PopularTokens(
  chain: UniswapV3ChainSlug,
  type: 'base' | 'quote'
): PopularToken[] {
  const chainConfig = UNISWAPV3_POPULAR_TOKENS[
    chain as keyof typeof UNISWAPV3_POPULAR_TOKENS
  ];
  if (!chainConfig) return [];

  const tokens = chainConfig[type];
  return tokens ? [...tokens] : [];
}
