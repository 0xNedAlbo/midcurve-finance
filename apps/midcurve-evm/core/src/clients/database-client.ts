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
 * Constructor parameter definition from manifest
 */
interface ConstructorParam {
  name: string;
  type: string;
  source: 'user-wallet' | 'automation-wallet' | 'user-input' | 'derived';
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
        manifest: true,
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

    const result: StrategyDeploymentData = {
      id: strategy.id,
      status: strategy.status,
      manifest: strategy.manifest
        ? {
            id: strategy.manifest.id,
            slug: strategy.manifest.slug,
            bytecode: strategy.manifest.bytecode as Hex,
            abi: strategy.manifest.abi as unknown as Abi,
            constructorParams: strategy.manifest.constructorParams as unknown as ConstructorParam[],
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
        manifest: true,
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

    const result: StrategyLifecycleData = {
      id: strategy.id,
      status: strategy.status,
      contractAddress: strategy.contractAddress as Address | null,
      chainId: strategy.chainId,
      manifest: strategy.manifest
        ? {
            id: strategy.manifest.id,
            slug: strategy.manifest.slug,
            abi: strategy.manifest.abi as unknown as Abi,
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
