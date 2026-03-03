/**
 * Uniswap V3 Protocol Configuration (Frontend)
 *
 * UI-specific helpers (chain dropdowns, popular tokens for wizard).
 * Contract addresses and deployment metadata live in @midcurve/shared.
 */

import type { EvmChainSlug, ChainMetadata } from '../chains';
import { CHAIN_METADATA } from '../chains';
import {
  UNISWAPV3_CHAIN_IDS,
  CHAIN_ID_TO_SLUG,
  type ChainSlug,
} from '@midcurve/shared';

/**
 * Chains where Uniswap V3 is deployed and supported (as slugs).
 * Derived from the shared UNISWAPV3_CHAIN_IDS via CHAIN_ID_TO_SLUG.
 * Dev chains are filtered out unless VITE_ENABLE_DEV_CHAINS=true
 * (CHAIN_METADATA only includes dev chains when enabled).
 */
export const UNISWAPV3_SUPPORTED_CHAINS: readonly EvmChainSlug[] =
  UNISWAPV3_CHAIN_IDS
    .reduce<EvmChainSlug[]>((acc, id) => {
      const slug = CHAIN_ID_TO_SLUG[id] as ChainSlug | undefined;
      if (slug && CHAIN_METADATA[slug]) acc.push(slug);
      return acc;
    }, []);

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
