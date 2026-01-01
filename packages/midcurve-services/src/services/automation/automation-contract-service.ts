/**
 * Automation Contract Service
 *
 * Provides CRUD operations for automation contracts.
 * Each user deploys one contract per protocol per chain.
 */

import { PrismaClient } from '@midcurve/database';
import type { Prisma } from '@midcurve/database';
import {
  AutomationContractFactory,
  type AutomationContractInterface,
  type AutomationContractType,
} from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type {
  DeployContractInput,
  UpdateContractDeploymentInput,
  FindContractOptions,
} from '../types/automation/index.js';

/**
 * Dependencies for AutomationContractService
 */
export interface AutomationContractServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Automation Contract Service
 *
 * Handles all automation contract-related database operations including:
 * - Deploying new contracts
 * - Finding contracts by user, chain, type
 * - Updating contract state after deployment
 * - Deactivating contracts
 */
export class AutomationContractService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new AutomationContractService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: AutomationContractServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('AutomationContractService');
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Creates a new automation contract record (before deployment)
   *
   * @param input - Contract creation input
   * @returns The created contract
   */
  async create(input: DeployContractInput): Promise<AutomationContractInterface> {
    log.methodEntry(this.logger, 'create', {
      userId: input.userId,
      contractType: input.contractType,
      chainId: input.chainId,
    });

    try {
      // Check if contract already exists for this user/type/chain
      const existing = await this.findByUserAndChain(
        input.userId,
        input.contractType,
        input.chainId
      );

      if (existing) {
        throw new Error(
          `Automation contract already exists for user ${input.userId} ` +
            `on chain ${input.chainId} with type ${input.contractType}`
        );
      }

      // Create initial config based on contract type
      const config = this.createInitialConfig(input);
      const state = this.createInitialState(input.contractType);

      const result = await this.prisma.automationContract.create({
        data: {
          userId: input.userId,
          contractType: input.contractType,
          isActive: true,
          config: config as unknown as Prisma.InputJsonValue,
          state: state as unknown as Prisma.InputJsonValue,
        },
      });

      const contract = this.mapToContract(result);

      this.logger.info(
        {
          id: contract.id,
          userId: contract.userId,
          contractType: contract.contractType,
        },
        'Automation contract created'
      );

      log.methodExit(this.logger, 'create', { id: contract.id });
      return contract;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, { input });
      throw error;
    }
  }

  /**
   * Finds a contract by ID
   *
   * @param id - Contract ID
   * @returns The contract if found, null otherwise
   */
  async findById(id: string): Promise<AutomationContractInterface | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      const result = await this.prisma.automationContract.findUnique({
        where: { id },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      const contract = this.mapToContract(result);
      log.methodExit(this.logger, 'findById', { id, found: true });
      return contract;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Finds a contract by user ID, contract type, and chain ID
   *
   * @param userId - User ID
   * @param contractType - Contract type (protocol)
   * @param chainId - Chain ID
   * @returns The contract if found, null otherwise
   */
  async findByUserAndChain(
    userId: string,
    contractType: AutomationContractType,
    chainId: number
  ): Promise<AutomationContractInterface | null> {
    log.methodEntry(this.logger, 'findByUserAndChain', {
      userId,
      contractType,
      chainId,
    });

    try {
      // Query contracts and filter by chainId in config
      const results = await this.prisma.automationContract.findMany({
        where: {
          userId,
          contractType,
        },
      });

      // Filter by chainId in config
      const matchingResult = results.find((r) => {
        const config = r.config as Record<string, unknown>;
        return config.chainId === chainId;
      });

      if (!matchingResult) {
        log.methodExit(this.logger, 'findByUserAndChain', { found: false });
        return null;
      }

      const contract = this.mapToContract(matchingResult);
      log.methodExit(this.logger, 'findByUserAndChain', {
        found: true,
        id: contract.id,
      });
      return contract;
    } catch (error) {
      log.methodError(this.logger, 'findByUserAndChain', error as Error, {
        userId,
        contractType,
        chainId,
      });
      throw error;
    }
  }

  /**
   * Finds all contracts for a user
   *
   * @param userId - User ID
   * @param options - Find options for filtering
   * @returns Array of contracts
   */
  async findByUserId(
    userId: string,
    options: FindContractOptions = {}
  ): Promise<AutomationContractInterface[]> {
    log.methodEntry(this.logger, 'findByUserId', { userId, options });

    try {
      const whereClause: Prisma.AutomationContractWhereInput = { userId };

      if (options.contractType) {
        whereClause.contractType = options.contractType;
      }

      if (options.isActive !== undefined) {
        whereClause.isActive = options.isActive;
      }

      let results = await this.prisma.automationContract.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
      });

      // Filter by chainId if provided
      if (options.chainId !== undefined) {
        results = results.filter((r) => {
          const config = r.config as Record<string, unknown>;
          return config.chainId === options.chainId;
        });
      }

      const contracts = results.map((r) => this.mapToContract(r));

      log.methodExit(this.logger, 'findByUserId', {
        userId,
        count: contracts.length,
      });
      return contracts;
    } catch (error) {
      log.methodError(this.logger, 'findByUserId', error as Error, {
        userId,
        options,
      });
      throw error;
    }
  }

  /**
   * Updates contract after successful deployment
   *
   * @param id - Contract ID
   * @param input - Deployment information
   * @returns The updated contract
   */
  async markDeployed(
    id: string,
    input: UpdateContractDeploymentInput
  ): Promise<AutomationContractInterface> {
    log.methodEntry(this.logger, 'markDeployed', { id, input });

    try {
      const existing = await this.prisma.automationContract.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Automation contract not found: ${id}`);
      }

      // Update config with contract address and operator
      const config = existing.config as Record<string, unknown>;
      const updatedConfig = {
        ...config,
        contractAddress: input.contractAddress,
        operatorAddress: input.operatorAddress,
        ...(input.nfpmAddress && { nfpmAddress: input.nfpmAddress }),
      };

      // Update state with deployment info
      const state = existing.state as Record<string, unknown>;
      const updatedState = {
        ...state,
        deploymentTxHash: input.deploymentTxHash,
        deployedAt: new Date().toISOString(),
      };

      const result = await this.prisma.automationContract.update({
        where: { id },
        data: {
          config: updatedConfig as unknown as Prisma.InputJsonValue,
          state: updatedState as unknown as Prisma.InputJsonValue,
        },
      });

      const contract = this.mapToContract(result);

      this.logger.info(
        {
          id: contract.id,
          contractAddress: input.contractAddress,
        },
        'Automation contract marked as deployed'
      );

      log.methodExit(this.logger, 'markDeployed', { id });
      return contract;
    } catch (error) {
      log.methodError(this.logger, 'markDeployed', error as Error, { id, input });
      throw error;
    }
  }

  /**
   * Deactivates a contract
   *
   * @param id - Contract ID
   * @returns The updated contract
   */
  async deactivate(id: string): Promise<AutomationContractInterface> {
    log.methodEntry(this.logger, 'deactivate', { id });

    try {
      const result = await this.prisma.automationContract.update({
        where: { id },
        data: { isActive: false },
      });

      const contract = this.mapToContract(result);

      this.logger.info({ id: contract.id }, 'Automation contract deactivated');
      log.methodExit(this.logger, 'deactivate', { id });
      return contract;
    } catch (error) {
      log.methodError(this.logger, 'deactivate', error as Error, { id });
      throw error;
    }
  }

  /**
   * Increments the lastCloseId for a contract
   *
   * @param id - Contract ID
   * @returns The new closeId
   */
  async getNextCloseId(id: string): Promise<number> {
    log.methodEntry(this.logger, 'getNextCloseId', { id });

    try {
      const existing = await this.prisma.automationContract.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Automation contract not found: ${id}`);
      }

      const state = existing.state as Record<string, unknown>;
      const currentCloseId = (state.lastCloseId as number) || 0;
      const nextCloseId = currentCloseId + 1;

      await this.prisma.automationContract.update({
        where: { id },
        data: {
          state: {
            ...state,
            lastCloseId: nextCloseId,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      log.methodExit(this.logger, 'getNextCloseId', { id, nextCloseId });
      return nextCloseId;
    } catch (error) {
      log.methodError(this.logger, 'getNextCloseId', error as Error, { id });
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Creates initial config based on contract type
   */
  private createInitialConfig(input: DeployContractInput): Record<string, unknown> {
    switch (input.contractType) {
      case 'uniswapv3':
        return {
          chainId: input.chainId,
          contractAddress: null,
          nfpmAddress: null,
          operatorAddress: null,
        };
      default:
        throw new Error(`Unknown contract type: ${input.contractType}`);
    }
  }

  /**
   * Creates initial state based on contract type
   */
  private createInitialState(contractType: AutomationContractType): Record<string, unknown> {
    switch (contractType) {
      case 'uniswapv3':
        return {
          deploymentTxHash: null,
          deployedAt: null,
          lastCloseId: 0,
        };
      default:
        throw new Error(`Unknown contract type: ${contractType}`);
    }
  }

  /**
   * Maps database result to typed contract using factory pattern
   */
  private mapToContract(
    dbResult: Prisma.AutomationContractGetPayload<Record<string, never>>
  ): AutomationContractInterface {
    // Use factory for runtime type dispatch
    return AutomationContractFactory.fromDB({
      id: dbResult.id,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      contractType: dbResult.contractType as AutomationContractType,
      userId: dbResult.userId,
      isActive: dbResult.isActive,
      config: dbResult.config as Record<string, unknown>,
      state: dbResult.state as Record<string, unknown>,
    });
  }
}
