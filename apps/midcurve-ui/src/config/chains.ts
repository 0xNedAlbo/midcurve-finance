/**
 * General EVM Chain Metadata Configuration
 *
 * IMPORTANT: This file contains ONLY public chain metadata (NO RPC URLs).
 * Per architecture guidelines, the frontend never accesses RPC endpoints directly.
 * All blockchain reads flow through the backend API routes.
 *
 * This is a GENERAL config for all EVM chains supported by the platform.
 * For protocol-specific chain support, see config/protocols/*.ts
 */

export interface ChainMetadata {
  chainId: number;
  name: string;
  shortName: string;
  slug: EvmChainSlug;
  explorer: string;
  description?: string;
  logo?: string;
}

/**
 * Supported EVM chain slugs across all protocols
 */
export type EvmChainSlug =
  | 'ethereum'
  | 'arbitrum'
  | 'base'
  | 'bsc'
  | 'polygon'
  | 'optimism';

/**
 * Metadata for all supported EVM chains
 */
export const CHAIN_METADATA: Record<EvmChainSlug, ChainMetadata> = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    shortName: 'Ethereum',
    slug: 'ethereum',
    explorer: 'https://etherscan.io',
    description: 'High liquidity, established ecosystem, higher gas costs',
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    slug: 'arbitrum',
    explorer: 'https://arbiscan.io',
    description: 'Low fees, fast transactions, Ethereum security',
  },
  base: {
    chainId: 8453,
    name: 'Base',
    shortName: 'Base',
    slug: 'base',
    explorer: 'https://basescan.org',
    description: 'Coinbase L2, low fees, growing ecosystem',
  },
  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    shortName: 'BSC',
    slug: 'bsc',
    explorer: 'https://bscscan.com',
    description: 'Binance L1, low fees, high throughput',
  },
  polygon: {
    chainId: 137,
    name: 'Polygon',
    shortName: 'Polygon',
    slug: 'polygon',
    explorer: 'https://polygonscan.com',
    description: 'Ethereum sidechain, low fees, fast finality',
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    shortName: 'Optimism',
    slug: 'optimism',
    explorer: 'https://optimistic.etherscan.io',
    description: 'Optimistic rollup, low fees, Ethereum security',
  },
};

/**
 * All supported EVM chain slugs
 */
export const ALL_EVM_CHAINS: EvmChainSlug[] = [
  'ethereum',
  'arbitrum',
  'base',
  'bsc',
  'polygon',
  'optimism',
];

/**
 * Get chain metadata by slug
 */
export function getChainMetadata(slug: string): ChainMetadata | undefined {
  return CHAIN_METADATA[slug as EvmChainSlug];
}

/**
 * Get chain ID by slug
 */
export function getChainId(slug: EvmChainSlug): number {
  return CHAIN_METADATA[slug].chainId;
}

/**
 * Check if a slug is a valid EVM chain
 */
export function isValidChainSlug(slug: string): slug is EvmChainSlug {
  return ALL_EVM_CHAINS.includes(slug as EvmChainSlug);
}

/**
 * Get chain metadata by chain ID
 */
export function getChainMetadataByChainId(
  chainId: number
): ChainMetadata | undefined {
  return Object.values(CHAIN_METADATA).find(
    (chain) => chain.chainId === chainId
  );
}

/**
 * Get chain slug by chain ID
 */
export function getChainSlugByChainId(
  chainId: number
): EvmChainSlug | undefined {
  const chain = getChainMetadataByChainId(chainId);
  return chain?.slug;
}
