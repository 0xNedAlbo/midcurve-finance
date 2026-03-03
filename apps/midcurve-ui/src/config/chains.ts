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
 * Core chain data (IDs, names, slugs, explorer URLs) comes from the centralized
 * chain registry in @midcurve/shared. This file adds UI-specific metadata
 * (descriptions, logos) on top.
 *
 * Local Development Chain:
 * When VITE_ENABLE_LOCAL_CHAIN=true, a local Anvil fork chain (31337) is available
 * for testing the automation flow without external service dependencies.
 */

import {
  CHAIN_REGISTRY,
  type ChainSlug,
} from '@midcurve/shared';

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
 * Re-exported from the centralized chain registry.
 */
export type EvmChainSlug = ChainSlug;

/**
 * UI-specific descriptions per chain (not in the registry)
 */
const CHAIN_DESCRIPTIONS: Partial<Record<number, string>> = {
  1: 'High liquidity, established ecosystem, higher gas costs',
  42161: 'Low fees, fast transactions, Ethereum security',
  8453: 'Coinbase L2, low fees, growing ecosystem',
  31337: 'Local Anvil fork for development testing',
};

/**
 * Build ChainMetadata from registry entry + UI-specific description
 */
function buildChainMetadata(chainId: number): ChainMetadata {
  const entry = CHAIN_REGISTRY[chainId]!;
  return {
    chainId: entry.id,
    name: entry.name,
    shortName: entry.shortName,
    slug: entry.slug,
    explorer: entry.explorer?.baseUrl ?? null,
    description: CHAIN_DESCRIPTIONS[chainId],
    isLocal: !entry.isProduction,
  };
}

/**
 * Production chain metadata (always available)
 * Built from chain registry.
 */
const PRODUCTION_CHAINS: Record<Exclude<EvmChainSlug, 'local'>, ChainMetadata> = {
  ethereum: buildChainMetadata(1),
  arbitrum: buildChainMetadata(42161),
  base: buildChainMetadata(8453),
};

/**
 * Local chain metadata (development only)
 * Built from chain registry.
 */
const LOCAL_CHAIN_METADATA: ChainMetadata = buildChainMetadata(31337);

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
