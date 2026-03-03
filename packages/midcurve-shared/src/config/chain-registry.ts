/**
 * Centralized Chain Registry
 *
 * Single source of truth for generic EVM chain metadata.
 * Consumed by both frontend and backend packages.
 *
 * What belongs here: chain IDs, names, slugs, explorer URLs,
 * CoinGecko platform IDs, env var suffixes, native currency info.
 *
 * What does NOT belong here: viem Chain objects, quote tokens,
 * subgraph URLs, finality config, or anything that reads
 * process.env / import.meta.env at import time.
 *
 * Protocol-specific config (contract addresses, deployment blocks)
 * lives in config/protocols/ (e.g. protocols/uniswapv3.ts).
 */

// ============================================================================
// Types
// ============================================================================

export type ChainSlug = 'ethereum' | 'arbitrum' | 'base' | 'sepolia' | 'local';

export interface ChainRegistryEntry {
  /** Numeric chain ID (e.g. 1, 42161, 8453, 31337) */
  id: number;
  /** Full chain name (e.g. "Ethereum Mainnet", "Arbitrum One") */
  name: string;
  /** Short display name (e.g. "Ethereum", "Arbitrum") */
  shortName: string;
  /** URL-safe slug (e.g. "ethereum", "arbitrum") */
  slug: ChainSlug;
  /** Block explorer info, or null for local chains */
  explorer: { name: string; baseUrl: string } | null;
  /** CoinGecko platform identifier, or null for local chains */
  coingeckoPlatformId: string | null;
  /** Native currency info */
  nativeCurrency: { symbol: string; decimals: number };
  /** Suffix for env var names (e.g. "ETHEREUM" → RPC_URL_ETHEREUM) */
  envVarSuffix: string;
  /** Whether this is a production (non-dev) chain */
  isProduction: boolean;
}

// ============================================================================
// Registry Data
// ============================================================================

export const CHAIN_REGISTRY: Readonly<Record<number, ChainRegistryEntry>> = {
  1: {
    id: 1,
    name: 'Ethereum Mainnet',
    shortName: 'Ethereum',
    slug: 'ethereum',
    explorer: { name: 'Etherscan', baseUrl: 'https://etherscan.io' },
    coingeckoPlatformId: 'ethereum',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    envVarSuffix: 'ETHEREUM',
    isProduction: true,
  },
  42161: {
    id: 42161,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    slug: 'arbitrum',
    explorer: { name: 'Arbiscan', baseUrl: 'https://arbiscan.io' },
    coingeckoPlatformId: 'arbitrum-one',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    envVarSuffix: 'ARBITRUM',
    isProduction: true,
  },
  8453: {
    id: 8453,
    name: 'Base',
    shortName: 'Base',
    slug: 'base',
    explorer: { name: 'Basescan', baseUrl: 'https://basescan.org' },
    coingeckoPlatformId: 'base',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    envVarSuffix: 'BASE',
    isProduction: true,
  },
  11155111: {
    id: 11155111,
    name: 'Ethereum Sepolia',
    shortName: 'Sepolia',
    slug: 'sepolia',
    explorer: { name: 'Etherscan', baseUrl: 'https://sepolia.etherscan.io' },
    coingeckoPlatformId: null,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    envVarSuffix: 'SEPOLIA',
    isProduction: false,
  },
  31337: {
    id: 31337,
    name: 'Local Testnet',
    shortName: 'Local',
    slug: 'local',
    explorer: null,
    coingeckoPlatformId: null,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    envVarSuffix: 'LOCAL',
    isProduction: false,
  },
};

// ============================================================================
// Derived Constants
// ============================================================================

/** Production chain IDs (excludes local/test chains) */
export const PRODUCTION_CHAIN_IDS: readonly number[] = Object.values(
  CHAIN_REGISTRY
)
  .filter((c) => c.isProduction)
  .map((c) => c.id);

/** All chain IDs including local/test */
export const ALL_CHAIN_IDS: readonly number[] = Object.values(
  CHAIN_REGISTRY
).map((c) => c.id);

/** Map chain ID → slug */
export const CHAIN_ID_TO_SLUG: Readonly<Record<number, ChainSlug>> =
  Object.fromEntries(
    Object.values(CHAIN_REGISTRY).map((c) => [c.id, c.slug])
  ) as Record<number, ChainSlug>;

/** Map slug → chain ID */
export const SLUG_TO_CHAIN_ID: Readonly<Record<string, number>> =
  Object.fromEntries(
    Object.values(CHAIN_REGISTRY).map((c) => [c.slug, c.id])
  ) as Record<string, number>;

/** Map chain ID → CoinGecko platform ID (production chains only) */
export const CHAIN_TO_COINGECKO_PLATFORM: Readonly<Record<number, string>> =
  Object.fromEntries(
    Object.values(CHAIN_REGISTRY)
      .filter((c) => c.coingeckoPlatformId !== null)
      .map((c) => [c.id, c.coingeckoPlatformId!])
  ) as Record<number, string>;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get registry entry for a chain ID. Throws if unknown.
 */
export function getChainEntry(chainId: number): ChainRegistryEntry {
  const entry = CHAIN_REGISTRY[chainId];
  if (!entry) {
    throw new Error(
      `Unknown chain ID: ${chainId}. Supported: ${ALL_CHAIN_IDS.join(', ')}`
    );
  }
  return entry;
}

/** Get full chain name (e.g. "Ethereum Mainnet") */
export function getChainName(chainId: number): string {
  return getChainEntry(chainId).name;
}

/** Get short chain name (e.g. "Ethereum") */
export function getChainShortName(chainId: number): string {
  return getChainEntry(chainId).shortName;
}

/** Get HTTP RPC env var name (e.g. "RPC_URL_ETHEREUM"). Does NOT read env. */
export function getRpcEnvVarName(chainId: number): string {
  return `RPC_URL_${getChainEntry(chainId).envVarSuffix}`;
}

/** Get WebSocket RPC env var name (e.g. "WS_RPC_URL_ETHEREUM"). Does NOT read env. */
export function getWsRpcEnvVarName(chainId: number): string {
  return `WS_RPC_URL_${getChainEntry(chainId).envVarSuffix}`;
}

/** Get explorer base URL, or undefined for chains without explorers */
export function getExplorerBaseUrl(chainId: number): string | undefined {
  return CHAIN_REGISTRY[chainId]?.explorer?.baseUrl;
}

/** Get explorer display name (e.g. "Etherscan"), or undefined */
export function getExplorerName(chainId: number): string | undefined {
  return CHAIN_REGISTRY[chainId]?.explorer?.name;
}

/** Build a full transaction URL, or '#' if chain has no explorer */
export function buildTxUrl(chainId: number, txHash: string): string {
  const baseUrl = getExplorerBaseUrl(chainId);
  if (!baseUrl) return '#';
  return `${baseUrl}/tx/${txHash}`;
}

/** Build a full block URL, or '#' if chain has no explorer */
export function buildBlockUrl(
  chainId: number,
  blockNumber: string | number
): string {
  const baseUrl = getExplorerBaseUrl(chainId);
  if (!baseUrl) return '#';
  return `${baseUrl}/block/${blockNumber}`;
}

/** Build a full address URL, or '#' if chain has no explorer */
export function buildAddressUrl(
  chainId: number,
  address: string
): string {
  const baseUrl = getExplorerBaseUrl(chainId);
  if (!baseUrl) return '#';
  return `${baseUrl}/address/${address}`;
}

/** Get native currency symbol (e.g. "ETH") */
export function getNativeCurrencySymbol(chainId: number): string {
  return getChainEntry(chainId).nativeCurrency.symbol;
}

/** Check if a chain ID is in the registry */
export function isSupportedChainId(chainId: number): boolean {
  return chainId in CHAIN_REGISTRY;
}

/** Check if a chain ID is a production (non-local) chain */
export function isProductionChainId(chainId: number): boolean {
  return CHAIN_REGISTRY[chainId]?.isProduction === true;
}
