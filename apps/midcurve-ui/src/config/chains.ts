/**
 * General EVM Chain Metadata Configuration
 *
 * IMPORTANT: This file contains ONLY public chain metadata (NO RPC URLs).
 * Per architecture guidelines, the frontend never accesses RPC endpoints directly.
 * All blockchain reads flow through the backend API routes.
 *
 * This is a GENERAL config for all EVM chains supported by the platform.
 * For protocol-specific chain support, see config/protocols/*.ts
 *
 * Local Development Chain:
 * When VITE_ENABLE_LOCAL_CHAIN=true, a local Anvil fork chain (31337) is available
 * for testing the automation flow without external service dependencies.
 */

export interface ChainMetadata {
  chainId: number;
  name: string;
  shortName: string;
  slug: EvmChainSlug;
  /** Block explorer URL, or null for local chains without explorers */
  explorer: string | null;
  description?: string;
  logo?: string;
  /** Whether this is a local/test chain */
  isLocal?: boolean;
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
  | 'optimism'
  | 'local';

/**
 * Production chain metadata (always available)
 */
const PRODUCTION_CHAINS: Record<Exclude<EvmChainSlug, 'local'>, ChainMetadata> =
  {
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
 * Local chain metadata (development only)
 */
const LOCAL_CHAIN_METADATA: ChainMetadata = {
  chainId: 31337,
  name: 'Local Testnet',
  shortName: 'Local',
  slug: 'local',
  explorer: null, // No block explorer for local chain
  description: 'Local Anvil fork for development testing',
  isLocal: true,
};

/**
 * Check if local chain is enabled via environment variable
 */
export const isLocalChainEnabled =
  import.meta.env.VITE_ENABLE_LOCAL_CHAIN === 'true';

/**
 * Metadata for all supported EVM chains
 * Includes local chain only when VITE_ENABLE_LOCAL_CHAIN=true
 */
export const CHAIN_METADATA: Partial<Record<EvmChainSlug, ChainMetadata>> =
  isLocalChainEnabled
    ? { ...PRODUCTION_CHAINS, local: LOCAL_CHAIN_METADATA }
    : PRODUCTION_CHAINS;

/**
 * Production EVM chain slugs (always available)
 */
const PRODUCTION_CHAIN_SLUGS: Exclude<EvmChainSlug, 'local'>[] = [
  'ethereum',
  'arbitrum',
  'base',
  'bsc',
  'polygon',
  'optimism',
];

/**
 * All supported EVM chain slugs
 * Includes 'local' only when VITE_ENABLE_LOCAL_CHAIN=true
 */
export const ALL_EVM_CHAINS: EvmChainSlug[] = isLocalChainEnabled
  ? [...PRODUCTION_CHAIN_SLUGS, 'local']
  : PRODUCTION_CHAIN_SLUGS;

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
  const metadata = CHAIN_METADATA[slug];
  if (!metadata) {
    throw new Error(`Chain metadata not found for slug: ${slug}`);
  }
  return metadata.chainId;
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
