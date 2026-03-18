/**
 * EVM Chain Configuration
 *
 * Centralized configuration for all supported EVM chains.
 * Manages RPC endpoints, public clients, and chain metadata.
 *
 * Production chains are configured via AppConfig (DB-backed settings).
 * Call `EvmConfig.initialize(appConfig)` at startup (done by `initAppConfig()`).
 *
 * Development-only chains (Sepolia, Local Anvil) still read from env vars
 * since they are not user-provided config.
 */

import {
  createPublicClient,
  defineChain,
  http,
  type PublicClient,
} from 'viem';
import {
  mainnet,
  arbitrum,
  base,
  sepolia,
  type Chain,
} from 'viem/chains';
import { type FinalityConfig, getChainEntry, getRpcEnvVarName, isProductionChainId } from '@midcurve/shared';
import type { AppConfig } from './app-config.js';

/**
 * Local Anvil chain definition for development testing
 * Only used when NODE_ENV !== 'production' and RPC_URL_LOCAL is set
 */
const localAnvil = defineChain({
  id: 31337,
  name: 'Local Anvil Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
  },
  testnet: true,
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
});

/**
 * Configuration for a single EVM chain
 */
export interface ChainConfig {
  /** Chain ID (e.g., 1 for Ethereum) */
  chainId: number;
  /** Human-readable chain name */
  name: string;
  /** RPC URL for this chain */
  rpcUrl: string;
  /** Block explorer URL (optional) */
  blockExplorer?: string;
  /** Viem chain definition */
  viemChain: Chain;
  /** Finality configuration for this chain */
  finality: FinalityConfig;
}

/**
 * Supported chain identifiers
 */
export enum SupportedChainId {
  ETHEREUM = 1,
  ARBITRUM = 42161,
  BASE = 8453,
  /** Sepolia testnet - only available in development */
  SEPOLIA = 11155111,
  /** Local Anvil chain - only available in development */
  LOCAL = 31337,
}

/**
 * Check if a chain ID is a local development chain
 */
export function isLocalChain(chainId: number): boolean {
  return chainId === SupportedChainId.LOCAL;
}

/**
 * Check if a chain ID is a non-production chain (testnet or local dev).
 * Non-production chains lack external service support (CoinGecko, subgraphs, etc.)
 */
export function isNonProductionChain(chainId: number): boolean {
  return !isProductionChainId(chainId);
}

/**
 * Get the fork source chain ID for a local development chain.
 *
 * Local Anvil chain (31337) is a fork of Ethereum mainnet (1),
 * so data lookups (e.g. CoinGecko token search) should use mainnet.
 * Only active in development mode — in production, returns the chainId as-is.
 */
export function getForkSourceChainId(chainId: number): number {
  if (
    chainId === SupportedChainId.LOCAL &&
    process.env['NODE_ENV'] !== 'production'
  ) {
    return SupportedChainId.ETHEREUM;
  }
  return chainId;
}

// Viem chain objects per chain ID (runtime-specific, can't live in registry)
const viemChains: Record<number, Chain> = {
  [SupportedChainId.ETHEREUM]: mainnet,
  [SupportedChainId.ARBITRUM]: arbitrum,
  [SupportedChainId.BASE]: base,
  [SupportedChainId.SEPOLIA]: sepolia,
  [SupportedChainId.LOCAL]: localAnvil,
};

/**
 * EVM Configuration Manager
 *
 * Manages chain configurations, RPC endpoints, and viem public clients.
 * Initialized from AppConfig (DB-backed) via `EvmConfig.initialize(appConfig)`.
 */
export class EvmConfig {
  private static instance: EvmConfig | null = null;
  private readonly chains: Map<number, ChainConfig>;
  private readonly clients: Map<number, PublicClient>;

  /**
   * Initialize the singleton from AppConfig.
   * Called by `initAppConfig()` after settings are loaded from DB.
   */
  static initialize(appConfig: AppConfig): void {
    EvmConfig.instance = new EvmConfig(appConfig);
  }

  /**
   * Initialize from explicit RPC URLs. For testing only.
   */
  static initializeForTest(rpcUrls: Record<number, string>): void {
    const testAppConfig: AppConfig = {
      alchemyApiKey: 'test-key',
      theGraphApiKey: 'test-key',
      coingeckoApiKey: null,
      walletconnectProjectId: 'test-project-id',
      rpcUrlEthereum: rpcUrls[SupportedChainId.ETHEREUM] ?? 'http://localhost:8545',
      rpcUrlArbitrum: rpcUrls[SupportedChainId.ARBITRUM] ?? 'http://localhost:8545',
      rpcUrlBase: rpcUrls[SupportedChainId.BASE] ?? 'http://localhost:8545',
    };
    EvmConfig.instance = new EvmConfig(testAppConfig);
  }

  /**
   * Get singleton instance.
   * Throws if `initialize()` hasn't been called.
   */
  static getInstance(): EvmConfig {
    if (!EvmConfig.instance) {
      throw new Error('EvmConfig not initialized — call initAppConfig() first');
    }
    return EvmConfig.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  static resetInstance(): void {
    EvmConfig.instance = null;
  }

  private constructor(appConfig: AppConfig) {
    this.chains = new Map();
    this.clients = new Map();
    this.initializeChains(appConfig);
  }

  /**
   * Initialize chain configurations from AppConfig (production chains)
   * and env vars (dev-only chains).
   */
  private initializeChains(appConfig: AppConfig): void {
    // Production chains — RPC URLs from AppConfig (DB-backed)
    const rpcUrls: Record<number, string> = {
      [SupportedChainId.ETHEREUM]: appConfig.rpcUrlEthereum,
      [SupportedChainId.ARBITRUM]: appConfig.rpcUrlArbitrum,
      [SupportedChainId.BASE]: appConfig.rpcUrlBase,
    };

    for (const [chainIdStr, rpcUrl] of Object.entries(rpcUrls)) {
      const chainId = Number(chainIdStr);
      const entry = getChainEntry(chainId);
      this.chains.set(chainId, {
        chainId,
        name: entry.shortName,
        rpcUrl,
        blockExplorer: entry.explorer?.baseUrl,
        viemChain: viemChains[chainId]!,
        finality: entry.finality,
      });
    }

    // Development-only chains (Sepolia, Local Anvil) — still from env vars
    if (process.env['NODE_ENV'] !== 'production') {
      for (const chainId of [SupportedChainId.SEPOLIA, SupportedChainId.LOCAL]) {
        const rpcEnvVar = getRpcEnvVarName(chainId);
        const rpcUrl = process.env[rpcEnvVar];
        if (rpcUrl) {
          const entry = getChainEntry(chainId);
          this.chains.set(chainId, {
            chainId,
            name: entry.shortName,
            rpcUrl,
            blockExplorer: entry.explorer?.baseUrl,
            viemChain: viemChains[chainId]!,
            finality: entry.finality,
          });
        }
      }
    }
  }

  /**
   * Get chain configuration by chain ID
   */
  getChainConfig(chainId: number): ChainConfig {
    const config = this.chains.get(chainId);
    if (!config) {
      throw new Error(
        `Chain ${chainId} is not configured. Supported chains: ${Array.from(
          this.chains.keys()
        ).join(', ')}`
      );
    }
    return config;
  }

  /**
   * Get viem PublicClient for a specific chain.
   * Creates and caches client instances.
   */
  getPublicClient(chainId: number): PublicClient {
    const cached = this.clients.get(chainId);
    if (cached) return cached;

    const config = this.getChainConfig(chainId);
    const client = createPublicClient({
      chain: config.viemChain,
      transport: http(config.rpcUrl),
    });

    this.clients.set(chainId, client);
    return client;
  }

  getSupportedChainIds(): number[] {
    return Array.from(this.chains.keys());
  }

  isChainSupported(chainId: number): boolean {
    return this.chains.has(chainId);
  }

  getFinalityConfig(chainId: number): FinalityConfig {
    const config = this.getChainConfig(chainId);
    return config.finality;
  }
}

/**
 * Get the default EvmConfig singleton instance
 */
export function getEvmConfig(): EvmConfig {
  return EvmConfig.getInstance();
}
