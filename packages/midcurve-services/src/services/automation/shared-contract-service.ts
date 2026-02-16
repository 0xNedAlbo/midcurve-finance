/**
 * Shared Contract Service
 *
 * Provides read operations for the SharedContract registry.
 * SharedContracts are versioned, platform-independent contract deployments
 * (e.g., UniswapV3PositionCloser deployed on multiple EVM chains).
 */

import { prisma as prismaClient, PrismaClient, Prisma } from '@midcurve/database';
import type { SharedContract } from '@midcurve/database';
import {
  SharedContractTypeEnum,
  type SharedContractType,
  type SharedContractName,
  type SharedContractData,
  EvmSmartContractConfig,
  type EvmSmartContractConfigData,
  buildSharedContractHash,
} from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for SharedContractService
 */
export interface SharedContractServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Input for upserting a shared contract
 */
export interface UpsertSharedContractInput {
  sharedContractType: SharedContractType;
  sharedContractName: SharedContractName;
  interfaceVersionMajor: number;
  interfaceVersionMinor: number;
  chainId: number;
  address: string;
  isActive?: boolean;
}

/**
 * Shared Contract Service
 *
 * Handles read operations for the shared contract registry:
 * - Finding contracts by chain ID and name
 * - Finding the latest version for a chain
 * - Finding contracts by semantic hash
 */
export class SharedContractService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new SharedContractService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: SharedContractServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('SharedContractService');
  }

  // ============================================================================
  // READ OPERATIONS
  // ============================================================================

  /**
   * Find the latest active contract for a specific chain and contract name.
   *
   * @param chainId - The EVM chain ID
   * @param contractName - The contract name (e.g., 'UniswapV3PositionCloser')
   * @returns The latest active contract, or null if not found
   */
  async findLatestByChainAndName(
    chainId: number,
    contractName: SharedContractName
  ): Promise<SharedContractData<EvmSmartContractConfigData> | null> {
    log.methodEntry(this.logger, 'findLatestByChainAndName', {
      chainId,
      contractName,
    });

    try {
      // Query for the latest active contract matching criteria
      // Note: Prisma doesn't support JSON field filtering directly in where clause,
      // so we fetch all matching contracts and filter in memory
      const contracts = await this.prisma.sharedContract.findMany({
        where: {
          sharedContractType: SharedContractTypeEnum.EVM_SMART_CONTRACT,
          sharedContractName: contractName,
          isActive: true,
        },
        orderBy: [
          { interfaceVersionMajor: 'desc' },
          { interfaceVersionMinor: 'desc' },
        ],
      });

      // Filter by chainId from JSON config
      const matching = contracts.find((contract) => {
        const config = EvmSmartContractConfig.fromRecord(contract.config);
        return config.chainId === chainId;
      });

      if (!matching) {
        this.logger.debug({ chainId, contractName }, 'No contract found');
        return null;
      }

      const result = this.mapToSharedContractData(matching);
      log.methodExit(this.logger, 'findLatestByChainAndName', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findLatestByChainAndName', error as Error, {
        chainId,
        contractName,
      });
      throw error;
    }
  }

  /**
   * Find all latest active contracts for a specific chain.
   * Returns one contract per name (the latest version).
   *
   * @param chainId - The EVM chain ID
   * @returns Map of contract name to contract data
   */
  async findLatestContractsForChain(
    chainId: number
  ): Promise<Map<string, SharedContractData<EvmSmartContractConfigData>>> {
    log.methodEntry(this.logger, 'findLatestContractsForChain', { chainId });

    try {
      // Fetch all active EVM contracts
      const contracts = await this.prisma.sharedContract.findMany({
        where: {
          sharedContractType: SharedContractTypeEnum.EVM_SMART_CONTRACT,
          isActive: true,
        },
        orderBy: [
          { sharedContractName: 'asc' },
          { interfaceVersionMajor: 'desc' },
          { interfaceVersionMinor: 'desc' },
        ],
      });

      // Filter by chainId and take the first (latest) for each name
      const result = new Map<string, SharedContractData<EvmSmartContractConfigData>>();
      const seenNames = new Set<string>();

      for (const contract of contracts) {
        // Skip if we already have a contract for this name
        if (seenNames.has(contract.sharedContractName)) {
          continue;
        }

        // Check chainId from config
        const config = EvmSmartContractConfig.fromRecord(contract.config);
        if (config.chainId !== chainId) {
          continue;
        }

        // Add to result
        result.set(contract.sharedContractName, this.mapToSharedContractData(contract));
        seenNames.add(contract.sharedContractName);
      }

      log.methodExit(this.logger, 'findLatestContractsForChain', {
        chainId,
        contractCount: result.size,
      });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findLatestContractsForChain', error as Error, {
        chainId,
      });
      throw error;
    }
  }

  /**
   * Find a contract by its semantic hash.
   *
   * @param hash - The semantic hash (e.g., 'evm/uniswap-v3-position-closer/1/0')
   * @returns The contract, or null if not found
   */
  async findByHash(
    hash: string
  ): Promise<SharedContractData<EvmSmartContractConfigData> | null> {
    log.methodEntry(this.logger, 'findByHash', { hash });

    try {
      const contract = await this.prisma.sharedContract.findUnique({
        where: { sharedContractHash: hash },
      });

      if (!contract) {
        this.logger.debug({ hash }, 'No contract found for hash');
        return null;
      }

      const result = this.mapToSharedContractData(contract);
      log.methodExit(this.logger, 'findByHash', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findByHash', error as Error, { hash });
      throw error;
    }
  }

  /**
   * Find a contract by its database ID.
   *
   * @param id - The database ID
   * @returns The contract, or null if not found
   */
  async findById(
    id: string
  ): Promise<SharedContractData<EvmSmartContractConfigData> | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      const contract = await this.prisma.sharedContract.findUnique({
        where: { id },
      });

      if (!contract) {
        this.logger.debug({ id }, 'No contract found for id');
        return null;
      }

      const result = this.mapToSharedContractData(contract);
      log.methodExit(this.logger, 'findById', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Find all chains that have a given contract deployed (latest version per chain).
   *
   * @param contractName - The contract name (e.g., 'MidcurveSwapRouter')
   * @returns Array of { chainId, address } for each chain with the contract
   */
  async findChainsByContractName(
    contractName: SharedContractName
  ): Promise<{ chainId: number; address: string }[]> {
    log.methodEntry(this.logger, 'findChainsByContractName', { contractName });

    try {
      const contracts = await this.prisma.sharedContract.findMany({
        where: {
          sharedContractType: SharedContractTypeEnum.EVM_SMART_CONTRACT,
          sharedContractName: contractName,
          isActive: true,
        },
        orderBy: [
          { interfaceVersionMajor: 'desc' },
          { interfaceVersionMinor: 'desc' },
        ],
      });

      // Deduplicate by chainId (take latest version, which comes first due to ordering)
      const seen = new Set<number>();
      const result: { chainId: number; address: string }[] = [];

      for (const contract of contracts) {
        const config = EvmSmartContractConfig.fromRecord(contract.config);
        if (!seen.has(config.chainId)) {
          seen.add(config.chainId);
          result.push({ chainId: config.chainId, address: config.address });
        }
      }

      log.methodExit(this.logger, 'findChainsByContractName', {
        contractName,
        chainCount: result.length,
      });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findChainsByContractName', error as Error, {
        contractName,
      });
      throw error;
    }
  }

  // ============================================================================
  // WRITE OPERATIONS
  // ============================================================================

  /**
   * Create or update a shared contract by its semantic hash.
   *
   * This is idempotent - calling with the same hash updates the existing record,
   * calling with a new hash creates a new record.
   *
   * @param input - The contract data to upsert
   * @returns The upserted contract
   */
  async upsert(
    input: UpsertSharedContractInput
  ): Promise<SharedContractData<EvmSmartContractConfigData>> {
    log.methodEntry(this.logger, 'upsert', {
      name: input.sharedContractName,
      chainId: input.chainId,
      version: `${input.interfaceVersionMajor}.${input.interfaceVersionMinor}`,
    });

    try {
      // Build semantic hash including chainId
      const hash = buildSharedContractHash(
        input.sharedContractType,
        input.sharedContractName,
        input.interfaceVersionMajor,
        input.interfaceVersionMinor,
        input.chainId
      );

      // Build config JSON
      const config: EvmSmartContractConfigData = {
        chainId: input.chainId,
        address: input.address,
      };

      // Upsert using hash as unique key
      const result = await this.prisma.sharedContract.upsert({
        where: { sharedContractHash: hash },
        create: {
          sharedContractType: input.sharedContractType,
          sharedContractName: input.sharedContractName,
          interfaceVersionMajor: input.interfaceVersionMajor,
          interfaceVersionMinor: input.interfaceVersionMinor,
          sharedContractHash: hash,
          config: config as unknown as Prisma.InputJsonValue,
          isActive: input.isActive ?? true,
        },
        update: {
          config: config as unknown as Prisma.InputJsonValue,
          isActive: input.isActive ?? true,
        },
      });

      const contractData = this.mapToSharedContractData(result);
      log.methodExit(this.logger, 'upsert', {
        id: contractData.id,
        hash: contractData.sharedContractHash,
        isNew: result.createdAt.getTime() === result.updatedAt.getTime(),
      });

      return contractData;
    } catch (error) {
      log.methodError(this.logger, 'upsert', error as Error, {
        name: input.sharedContractName,
        chainId: input.chainId,
      });
      throw error;
    }
  }

  /**
   * Delete all shared contracts for a specific chain.
   * Used during local chain reset.
   *
   * @param chainId - The chain ID to delete contracts for
   * @returns Number of deleted contracts
   */
  async deleteByChainId(chainId: number): Promise<number> {
    log.methodEntry(this.logger, 'deleteByChainId', { chainId });

    try {
      // Fetch all contracts first to filter by chainId in config
      // Note: Prisma doesn't support JSON field filtering directly in where clause
      const contracts = await this.prisma.sharedContract.findMany({
        where: {
          sharedContractType: SharedContractTypeEnum.EVM_SMART_CONTRACT,
        },
      });

      // Filter by chainId from JSON config
      const toDelete = contracts.filter((contract) => {
        const config = EvmSmartContractConfig.fromRecord(contract.config);
        return config.chainId === chainId;
      });

      if (toDelete.length === 0) {
        this.logger.debug({ chainId }, 'No contracts found for chain');
        return 0;
      }

      // Delete matching contracts
      const deleted = await this.prisma.sharedContract.deleteMany({
        where: {
          id: { in: toDelete.map((c) => c.id) },
        },
      });

      log.methodExit(this.logger, 'deleteByChainId', {
        chainId,
        deletedCount: deleted.count,
      });

      return deleted.count;
    } catch (error) {
      log.methodError(this.logger, 'deleteByChainId', error as Error, {
        chainId,
      });
      throw error;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Maps a Prisma SharedContract record to SharedContractData
   */
  private mapToSharedContractData(
    record: SharedContract
  ): SharedContractData<EvmSmartContractConfigData> {
    const config = EvmSmartContractConfig.fromRecord(record.config);

    return {
      id: record.id,
      sharedContractType: record.sharedContractType as SharedContractType,
      sharedContractName: record.sharedContractName as SharedContractName,
      interfaceVersionMajor: record.interfaceVersionMajor,
      interfaceVersionMinor: record.interfaceVersionMinor,
      sharedContractHash: record.sharedContractHash,
      config: {
        chainId: config.chainId,
        address: config.address,
      },
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
