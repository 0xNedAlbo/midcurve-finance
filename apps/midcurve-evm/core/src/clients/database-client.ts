/**
 * Database Client
 *
 * Provides read-only access to the database for strategy lookups.
 * Write operations should go through midcurve-services.
 *
 * This client wraps Prisma queries and returns data in a format
 * suitable for the EVM Core orchestrator.
 */

import { prisma } from '../../../lib/prisma';
import { logger, evmLog } from '../../../lib/logger';
import type { Address, Hex, Abi } from 'viem';
import { parseVaultConfig, type VaultConfig } from '../types/vault-config.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Strategy data needed for deployment
 */
export interface StrategyDeploymentData {
  id: string;
  status: string;
  manifest: {
    id: string;
    slug: string;
    bytecode: Hex;
    abi: Abi;
    constructorParams: ConstructorParam[];
  };
  config: Record<string, unknown>;
  automationWallet: {
    id: string;
    walletAddress: Address;
    kmsKeyId: string;
  } | null;
}

/**
 * Strategy data needed for lifecycle operations
 */
export interface StrategyLifecycleData {
  id: string;
  status: string;
  contractAddress: Address | null;
  chainId: number | null;
  manifest: {
    id: string;
    slug: string;
    abi: Abi;
  };
  automationWallet: {
    id: string;
    walletAddress: Address;
  } | null;
}

/**
 * Minimal strategy info for status checks
 */
export interface StrategyStatusData {
  id: string;
  status: string;
  contractAddress: Address | null;
  chainId: number | null;
  createdAt: Date;
}

/**
 * Vault info for a strategy
 *
 * Contains all information needed to interact with the strategy's vault
 * on the public chain.
 */
export interface StrategyVaultInfo {
  /** Strategy ID */
  strategyId: string;
  /** Vault configuration (parsed from JSON) */
  vaultConfig: VaultConfig;
  /** Vault token ID (reference to Token record) */
  vaultTokenId: string;
  /** Vault token details */
  vaultToken: {
    id: string;
    symbol: string;
    decimals: number;
    /** Token address (from config.address for ERC20) */
    address: Address;
  };
  /** When vault was deployed/registered */
  vaultDeployedAt: Date;
  /** Operator wallet address (for vault operations) */
  operatorAddress: Address;
}

/**
 * Constructor parameter definition from manifest
 */
interface ConstructorParam {
  name: string;
  type: string;
  source: 'operator-address' | 'core-address' | 'user-input';
  label?: string;
  description?: string;
  required?: boolean;
  default?: string;
}

// =============================================================================
// Error
// =============================================================================

export class DatabaseClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'DatabaseClientError';
  }
}

// =============================================================================
// Client
// =============================================================================

class DatabaseClient {
  private readonly log = logger.child({ client: 'DatabaseClient' });

  /**
   * Get strategy by ID with deployment data
   *
   * @param strategyId - Strategy ID
   * @returns Strategy data for deployment or null if not found
   */
  async getStrategyForDeployment(
    strategyId: string
  ): Promise<StrategyDeploymentData | null> {
    evmLog.methodEntry(this.log, 'getStrategyForDeployment', { strategyId });

    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      include: {
        automationWallets: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!strategy) {
      evmLog.methodExit(this.log, 'getStrategyForDeployment', { found: false });
      return null;
    }

    const wallet = strategy.automationWallets[0];
    const walletConfig = wallet?.config as { walletAddress: string; kmsKeyId: string } | undefined;

    // Parse manifest from JSON field
    const manifestJson = strategy.manifest as {
      id?: string;
      slug?: string;
      bytecode?: string;
      abi?: unknown;
      constructorParams?: unknown[];
    } | null;

    const result: StrategyDeploymentData = {
      id: strategy.id,
      status: strategy.status,
      manifest: manifestJson
        ? {
            id: manifestJson.id ?? strategy.id,
            slug: manifestJson.slug ?? 'unknown',
            bytecode: manifestJson.bytecode as Hex,
            abi: manifestJson.abi as unknown as Abi,
            constructorParams: manifestJson.constructorParams as unknown as ConstructorParam[],
          }
        : (null as unknown as StrategyDeploymentData['manifest']),
      config: (strategy.config as Record<string, unknown>) ?? {},
      automationWallet: walletConfig
        ? {
            id: wallet!.id,
            walletAddress: walletConfig.walletAddress as Address,
            kmsKeyId: walletConfig.kmsKeyId,
          }
        : null,
    };

    evmLog.methodExit(this.log, 'getStrategyForDeployment', {
      found: true,
      hasManifest: !!result.manifest,
      hasWallet: !!result.automationWallet,
    });

    return result;
  }

  /**
   * Get strategy by contract address for lifecycle operations
   *
   * @param contractAddress - Deployed contract address
   * @returns Strategy lifecycle data or null if not found
   */
  async getStrategyByAddress(
    contractAddress: Address
  ): Promise<StrategyLifecycleData | null> {
    evmLog.methodEntry(this.log, 'getStrategyByAddress', { contractAddress });

    const strategy = await prisma.strategy.findFirst({
      where: { contractAddress: contractAddress.toLowerCase() },
      include: {
        automationWallets: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!strategy) {
      evmLog.methodExit(this.log, 'getStrategyByAddress', { found: false });
      return null;
    }

    const wallet = strategy.automationWallets[0];
    const walletConfig = wallet?.config as { walletAddress: string } | undefined;

    // Parse manifest from JSON field
    const manifestJson = strategy.manifest as {
      id?: string;
      slug?: string;
      abi?: unknown;
    } | null;

    const result: StrategyLifecycleData = {
      id: strategy.id,
      status: strategy.status,
      contractAddress: strategy.contractAddress as Address | null,
      chainId: strategy.chainId,
      manifest: manifestJson
        ? {
            id: manifestJson.id ?? strategy.id,
            slug: manifestJson.slug ?? 'unknown',
            abi: manifestJson.abi as unknown as Abi,
          }
        : (null as unknown as StrategyLifecycleData['manifest']),
      automationWallet: walletConfig
        ? {
            id: wallet!.id,
            walletAddress: walletConfig.walletAddress as Address,
          }
        : null,
    };

    evmLog.methodExit(this.log, 'getStrategyByAddress', {
      found: true,
      id: result.id,
      status: result.status,
    });

    return result;
  }

  /**
   * Get strategy status by contract address
   *
   * @param contractAddress - Deployed contract address
   * @returns Strategy status data or null if not found
   */
  async getStrategyStatus(contractAddress: Address): Promise<StrategyStatusData | null> {
    evmLog.methodEntry(this.log, 'getStrategyStatus', { contractAddress });

    const strategy = await prisma.strategy.findFirst({
      where: { contractAddress: contractAddress.toLowerCase() },
      select: {
        id: true,
        status: true,
        contractAddress: true,
        chainId: true,
        createdAt: true,
      },
    });

    if (!strategy) {
      evmLog.methodExit(this.log, 'getStrategyStatus', { found: false });
      return null;
    }

    const result: StrategyStatusData = {
      id: strategy.id,
      status: strategy.status,
      contractAddress: strategy.contractAddress as Address | null,
      chainId: strategy.chainId,
      createdAt: strategy.createdAt,
    };

    evmLog.methodExit(this.log, 'getStrategyStatus', {
      found: true,
      status: result.status,
    });

    return result;
  }

  /**
   * Get strategy by ID (minimal data)
   *
   * @param strategyId - Strategy ID
   * @returns Strategy status data or null if not found
   */
  async getStrategyById(strategyId: string): Promise<StrategyStatusData | null> {
    evmLog.methodEntry(this.log, 'getStrategyById', { strategyId });

    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      select: {
        id: true,
        status: true,
        contractAddress: true,
        chainId: true,
        createdAt: true,
      },
    });

    if (!strategy) {
      evmLog.methodExit(this.log, 'getStrategyById', { found: false });
      return null;
    }

    const result: StrategyStatusData = {
      id: strategy.id,
      status: strategy.status,
      contractAddress: strategy.contractAddress as Address | null,
      chainId: strategy.chainId,
      createdAt: strategy.createdAt,
    };

    evmLog.methodExit(this.log, 'getStrategyById', {
      found: true,
      status: result.status,
    });

    return result;
  }

  /**
   * Get vault info for a strategy
   *
   * Returns vault configuration and token details needed for vault operations.
   * Returns null if strategy not found or vault not configured.
   *
   * @param strategyId - Strategy ID
   * @returns Vault info or null if not found/configured
   */
  async getStrategyVaultInfo(strategyId: string): Promise<StrategyVaultInfo | null> {
    evmLog.methodEntry(this.log, 'getStrategyVaultInfo', { strategyId });

    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      select: {
        id: true,
        vaultConfig: true,
        vaultTokenId: true,
        vaultDeployedAt: true,
        vaultToken: {
          select: {
            id: true,
            symbol: true,
            decimals: true,
            config: true,
          },
        },
        automationWallets: {
          where: { isActive: true },
          take: 1,
          select: {
            config: true,
          },
        },
      },
    });

    if (!strategy) {
      evmLog.methodExit(this.log, 'getStrategyVaultInfo', { found: false, reason: 'strategy_not_found' });
      return null;
    }

    // Check if vault is configured
    if (!strategy.vaultConfig || !strategy.vaultTokenId || !strategy.vaultDeployedAt) {
      evmLog.methodExit(this.log, 'getStrategyVaultInfo', { found: false, reason: 'vault_not_configured' });
      return null;
    }

    // Check if vault token exists
    if (!strategy.vaultToken) {
      this.log.error({ strategyId, vaultTokenId: strategy.vaultTokenId, msg: 'Vault token not found in database' });
      evmLog.methodExit(this.log, 'getStrategyVaultInfo', { found: false, reason: 'vault_token_not_found' });
      return null;
    }

    // Check if operator wallet exists
    const wallet = strategy.automationWallets[0];
    const walletConfig = wallet?.config as { walletAddress: string } | undefined;
    if (!walletConfig?.walletAddress) {
      this.log.error({ strategyId, msg: 'No active automation wallet found' });
      evmLog.methodExit(this.log, 'getStrategyVaultInfo', { found: false, reason: 'no_operator_wallet' });
      return null;
    }

    // Parse vault config
    let vaultConfig: VaultConfig;
    try {
      vaultConfig = parseVaultConfig(strategy.vaultConfig);
    } catch (error) {
      this.log.error({ strategyId, vaultConfig: strategy.vaultConfig, error, msg: 'Invalid vault config' });
      evmLog.methodExit(this.log, 'getStrategyVaultInfo', { found: false, reason: 'invalid_vault_config' });
      return null;
    }

    // Extract token address from config
    const tokenConfig = strategy.vaultToken.config as { address?: string } | undefined;
    if (!tokenConfig?.address) {
      this.log.error({ strategyId, tokenConfig, msg: 'Token config missing address' });
      evmLog.methodExit(this.log, 'getStrategyVaultInfo', { found: false, reason: 'token_missing_address' });
      return null;
    }

    const result: StrategyVaultInfo = {
      strategyId: strategy.id,
      vaultConfig,
      vaultTokenId: strategy.vaultTokenId,
      vaultToken: {
        id: strategy.vaultToken.id,
        symbol: strategy.vaultToken.symbol,
        decimals: strategy.vaultToken.decimals,
        address: tokenConfig.address as Address,
      },
      vaultDeployedAt: strategy.vaultDeployedAt,
      operatorAddress: walletConfig.walletAddress as Address,
    };

    evmLog.methodExit(this.log, 'getStrategyVaultInfo', {
      found: true,
      vaultType: vaultConfig.type,
      chainId: vaultConfig.type === 'evm' ? vaultConfig.chainId : undefined,
    });

    return result;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let databaseClientInstance: DatabaseClient | null = null;

/**
 * Get the singleton database client instance
 */
export function getDatabaseClient(): DatabaseClient {
  if (!databaseClientInstance) {
    databaseClientInstance = new DatabaseClient();
  }
  return databaseClientInstance;
}

export { DatabaseClient };
