/**
 * Hedge Vault Service
 *
 * Provides CRUD operations and lifecycle management for hedge vaults.
 * Hedge vaults are ERC-4626 vaults that manage Uniswap V3 LP positions
 * with automated SIL/TIP triggers.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { HedgeVault, HedgeVaultExecution, Prisma } from '@midcurve/database';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type {
  RegisterHedgeVaultInput,
  UpdateHedgeVaultStateInput,
  RecordHedgeVaultExecutionInput,
  MarkExecutionCompletedInput,
  MarkExecutionFailedInput,
  FindHedgeVaultsOptions,
  HedgeVaultMonitoringStatus,
} from '../types/automation/index.js';

/**
 * Dependencies for HedgeVaultService
 */
export interface HedgeVaultServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Hedge Vault with optional executions
 */
export interface HedgeVaultWithExecutions extends HedgeVault {
  executions?: HedgeVaultExecution[];
}

/**
 * Hedge Vault Service
 *
 * Handles all hedge vault-related database operations including:
 * - Registering new vaults for monitoring
 * - Finding vaults by various criteria
 * - Managing vault state (synced from chain)
 * - Recording and managing execution attempts
 */
export class HedgeVaultService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new HedgeVaultService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: HedgeVaultServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('HedgeVaultService');
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Registers a new hedge vault for monitoring
   *
   * @param input - Vault registration input
   * @returns The created hedge vault
   */
  async register(input: RegisterHedgeVaultInput): Promise<HedgeVault> {
    log.methodEntry(this.logger, 'register', {
      vaultAddress: input.vaultAddress,
      chainId: input.chainId,
      poolAddress: input.poolAddress,
    });

    try {
      const result = await this.prisma.hedgeVault.create({
        data: {
          vaultAddress: input.vaultAddress,
          chainId: input.chainId,
          positionId: input.positionId,
          poolAddress: input.poolAddress,
          token0IsQuote: input.token0IsQuote,
          silSqrtPriceX96: input.silSqrtPriceX96,
          tipSqrtPriceX96: input.tipSqrtPriceX96,
          lossCapBps: input.lossCapBps,
          reopenCooldownBlocks: input.reopenCooldownBlocks.toString(),
          operatorId: input.operatorId,
          state: 'UNINITIALIZED',
          monitoringStatus: 'pending',
        },
      });

      this.logger.info(
        {
          id: result.id,
          vaultAddress: result.vaultAddress,
          chainId: result.chainId,
        },
        'Hedge vault registered'
      );

      log.methodExit(this.logger, 'register', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'register', error as Error, { input });
      throw error;
    }
  }

  /**
   * Finds a hedge vault by ID
   *
   * @param id - Vault ID
   * @param includeExecutions - Whether to include execution history
   * @returns The vault if found, null otherwise
   */
  async findById(
    id: string,
    includeExecutions = false
  ): Promise<HedgeVaultWithExecutions | null> {
    log.methodEntry(this.logger, 'findById', { id, includeExecutions });

    try {
      const result = await this.prisma.hedgeVault.findUnique({
        where: { id },
        include: includeExecutions ? { executions: true } : undefined,
      });

      log.methodExit(this.logger, 'findById', { id, found: !!result });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Finds a hedge vault by contract address
   *
   * @param vaultAddress - On-chain vault address
   * @param includeExecutions - Whether to include execution history
   * @returns The vault if found, null otherwise
   */
  async findByAddress(
    vaultAddress: string,
    includeExecutions = false
  ): Promise<HedgeVaultWithExecutions | null> {
    log.methodEntry(this.logger, 'findByAddress', { vaultAddress, includeExecutions });

    try {
      const result = await this.prisma.hedgeVault.findUnique({
        where: { vaultAddress },
        include: includeExecutions ? { executions: true } : undefined,
      });

      log.methodExit(this.logger, 'findByAddress', { vaultAddress, found: !!result });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findByAddress', error as Error, { vaultAddress });
      throw error;
    }
  }

  /**
   * Finds hedge vaults with optional filters
   *
   * @param options - Search options
   * @returns Array of matching vaults
   */
  async find(options: FindHedgeVaultsOptions = {}): Promise<HedgeVaultWithExecutions[]> {
    log.methodEntry(this.logger, 'find', { ...options });

    try {
      const where: Prisma.HedgeVaultWhereInput = {};

      if (options.chainId !== undefined) {
        where.chainId = options.chainId;
      }
      if (options.poolAddress !== undefined) {
        where.poolAddress = options.poolAddress;
      }
      if (options.state !== undefined) {
        where.state = options.state;
      }
      if (options.monitoringStatus !== undefined) {
        where.monitoringStatus = options.monitoringStatus;
      }

      const result = await this.prisma.hedgeVault.findMany({
        where,
        include: options.includeExecutions ? { executions: true } : undefined,
        take: options.limit,
        orderBy: { createdAt: 'desc' },
      });

      log.methodExit(this.logger, 'find', { count: result.length });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'find', error as Error, { ...options });
      throw error;
    }
  }

  /**
   * Finds active vaults for a specific pool (for price monitoring)
   *
   * @param chainId - Chain ID
   * @param poolAddress - Pool address
   * @returns Array of active vaults
   */
  async findActiveForPool(chainId: number, poolAddress: string): Promise<HedgeVault[]> {
    log.methodEntry(this.logger, 'findActiveForPool', { chainId, poolAddress });

    try {
      const result = await this.prisma.hedgeVault.findMany({
        where: {
          chainId,
          poolAddress,
          monitoringStatus: 'active',
          state: {
            in: ['IN_POSITION', 'OUT_OF_POSITION_QUOTE', 'OUT_OF_POSITION_BASE'],
          },
        },
      });

      log.methodExit(this.logger, 'findActiveForPool', { count: result.length });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findActiveForPool', error as Error, {
        chainId,
        poolAddress,
      });
      throw error;
    }
  }

  /**
   * Finds all active vaults for monitoring (across all pools)
   *
   * @returns Array of all active vaults
   */
  async findActiveVaults(): Promise<HedgeVault[]> {
    log.methodEntry(this.logger, 'findActiveVaults');

    try {
      const result = await this.prisma.hedgeVault.findMany({
        where: {
          monitoringStatus: 'active',
          state: {
            in: ['IN_POSITION', 'OUT_OF_POSITION_QUOTE', 'OUT_OF_POSITION_BASE'],
          },
        },
        orderBy: { poolAddress: 'asc' },
      });

      log.methodExit(this.logger, 'findActiveVaults', { count: result.length });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findActiveVaults', error as Error);
      throw error;
    }
  }

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  /**
   * Updates vault state from chain data
   *
   * @param vaultId - Vault ID
   * @param input - State update input
   * @returns Updated vault
   */
  async updateState(vaultId: string, input: UpdateHedgeVaultStateInput): Promise<HedgeVault> {
    log.methodEntry(this.logger, 'updateState', { vaultId, state: input.state });

    try {
      const result = await this.prisma.hedgeVault.update({
        where: { id: vaultId },
        data: {
          state: input.state,
          currentTokenId: input.currentTokenId,
          lastCloseBlock: input.lastCloseBlock?.toString(),
          costBasis: input.costBasis,
        },
      });

      this.logger.info(
        { vaultId, newState: input.state },
        'Hedge vault state updated'
      );

      log.methodExit(this.logger, 'updateState', { vaultId, state: input.state });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'updateState', error as Error, { vaultId, input });
      throw error;
    }
  }

  /**
   * Sets the monitoring status for a vault
   *
   * @param vaultId - Vault ID
   * @param status - New monitoring status
   * @returns Updated vault
   */
  async setMonitoringStatus(
    vaultId: string,
    status: HedgeVaultMonitoringStatus
  ): Promise<HedgeVault> {
    log.methodEntry(this.logger, 'setMonitoringStatus', { vaultId, status });

    try {
      const result = await this.prisma.hedgeVault.update({
        where: { id: vaultId },
        data: { monitoringStatus: status },
      });

      this.logger.info(
        { vaultId, monitoringStatus: status },
        'Hedge vault monitoring status updated'
      );

      log.methodExit(this.logger, 'setMonitoringStatus', { vaultId, status });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'setMonitoringStatus', error as Error, {
        vaultId,
        status,
      });
      throw error;
    }
  }

  // ============================================================================
  // EXECUTION MANAGEMENT
  // ============================================================================

  /**
   * Records a new execution attempt
   *
   * @param vaultId - Vault ID
   * @param input - Execution input
   * @returns Created execution record
   */
  async recordExecution(
    vaultId: string,
    input: RecordHedgeVaultExecutionInput
  ): Promise<HedgeVaultExecution> {
    log.methodEntry(this.logger, 'recordExecution', { vaultId, triggerType: input.triggerType });

    try {
      const result = await this.prisma.hedgeVaultExecution.create({
        data: {
          vaultId,
          triggerType: input.triggerType,
          triggerSqrtPriceX96: input.triggerSqrtPriceX96,
          status: 'pending',
        },
      });

      this.logger.info(
        { executionId: result.id, vaultId, triggerType: input.triggerType },
        'Hedge vault execution recorded'
      );

      log.methodExit(this.logger, 'recordExecution', { executionId: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'recordExecution', error as Error, { vaultId, input });
      throw error;
    }
  }

  /**
   * Marks an execution as in progress
   *
   * @param executionId - Execution ID
   * @returns Updated execution
   */
  async markExecutionExecuting(executionId: string): Promise<HedgeVaultExecution> {
    log.methodEntry(this.logger, 'markExecutionExecuting', { executionId });

    try {
      const result = await this.prisma.hedgeVaultExecution.update({
        where: { id: executionId },
        data: { status: 'executing' },
      });

      log.methodExit(this.logger, 'markExecutionExecuting', { executionId });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markExecutionExecuting', error as Error, { executionId });
      throw error;
    }
  }

  /**
   * Marks an execution as completed
   *
   * @param executionId - Execution ID
   * @param input - Completion details
   * @returns Updated execution
   */
  async markExecutionCompleted(
    executionId: string,
    input: MarkExecutionCompletedInput
  ): Promise<HedgeVaultExecution> {
    log.methodEntry(this.logger, 'markExecutionCompleted', { executionId, txHash: input.txHash });

    try {
      const result = await this.prisma.hedgeVaultExecution.update({
        where: { id: executionId },
        data: {
          status: 'completed',
          txHash: input.txHash,
          executionSqrtPriceX96: input.executionSqrtPriceX96,
          quoteAmount: input.quoteAmount,
          baseAmount: input.baseAmount,
          completedAt: new Date(),
        },
      });

      this.logger.info(
        { executionId, txHash: input.txHash },
        'Hedge vault execution completed'
      );

      log.methodExit(this.logger, 'markExecutionCompleted', { executionId });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markExecutionCompleted', error as Error, {
        executionId,
        input,
      });
      throw error;
    }
  }

  /**
   * Marks an execution as failed
   *
   * @param executionId - Execution ID
   * @param input - Failure details
   * @returns Updated execution
   */
  async markExecutionFailed(
    executionId: string,
    input: MarkExecutionFailedInput
  ): Promise<HedgeVaultExecution> {
    log.methodEntry(this.logger, 'markExecutionFailed', { executionId, error: input.error });

    try {
      const result = await this.prisma.hedgeVaultExecution.update({
        where: { id: executionId },
        data: {
          status: 'failed',
          error: input.error,
          retryCount: input.retryCount,
          completedAt: new Date(),
        },
      });

      this.logger.warn(
        { executionId, error: input.error, retryCount: input.retryCount },
        'Hedge vault execution failed'
      );

      log.methodExit(this.logger, 'markExecutionFailed', { executionId });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markExecutionFailed', error as Error, {
        executionId,
        input,
      });
      throw error;
    }
  }

  /**
   * Increments the retry count for an execution
   *
   * @param executionId - Execution ID
   * @returns Updated execution
   */
  async incrementRetryCount(executionId: string): Promise<HedgeVaultExecution> {
    log.methodEntry(this.logger, 'incrementRetryCount', { executionId });

    try {
      const result = await this.prisma.hedgeVaultExecution.update({
        where: { id: executionId },
        data: {
          retryCount: { increment: 1 },
          status: 'pending', // Reset to pending for retry
        },
      });

      this.logger.info(
        { executionId, newRetryCount: result.retryCount },
        'Hedge vault execution retry count incremented'
      );

      log.methodExit(this.logger, 'incrementRetryCount', { executionId });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'incrementRetryCount', error as Error, { executionId });
      throw error;
    }
  }

  /**
   * Finds pending executions for a vault
   *
   * @param vaultId - Vault ID
   * @returns Array of pending executions
   */
  async findPendingExecutions(vaultId: string): Promise<HedgeVaultExecution[]> {
    log.methodEntry(this.logger, 'findPendingExecutions', { vaultId });

    try {
      const result = await this.prisma.hedgeVaultExecution.findMany({
        where: {
          vaultId,
          status: { in: ['pending', 'executing'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      log.methodExit(this.logger, 'findPendingExecutions', { count: result.length });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'findPendingExecutions', error as Error, { vaultId });
      throw error;
    }
  }

  /**
   * Gets the latest execution for a vault
   *
   * @param vaultId - Vault ID
   * @returns Latest execution or null
   */
  async getLatestExecution(vaultId: string): Promise<HedgeVaultExecution | null> {
    log.methodEntry(this.logger, 'getLatestExecution', { vaultId });

    try {
      const result = await this.prisma.hedgeVaultExecution.findFirst({
        where: { vaultId },
        orderBy: { createdAt: 'desc' },
      });

      log.methodExit(this.logger, 'getLatestExecution', { found: !!result });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'getLatestExecution', error as Error, { vaultId });
      throw error;
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Deletes a hedge vault and all related records
   *
   * @param vaultId - Vault ID
   */
  async delete(vaultId: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { vaultId });

    try {
      await this.prisma.hedgeVault.delete({
        where: { id: vaultId },
      });

      this.logger.info({ vaultId }, 'Hedge vault deleted');
      log.methodExit(this.logger, 'delete', { vaultId });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { vaultId });
      throw error;
    }
  }

  /**
   * Gets count of active vaults per pool (for monitoring purposes)
   *
   * @returns Map of poolAddress -> vault count
   */
  async getActiveVaultCounts(): Promise<Map<string, number>> {
    log.methodEntry(this.logger, 'getActiveVaultCounts');

    try {
      const result = await this.prisma.hedgeVault.groupBy({
        by: ['poolAddress'],
        where: {
          monitoringStatus: 'active',
          state: {
            in: ['IN_POSITION', 'OUT_OF_POSITION_QUOTE', 'OUT_OF_POSITION_BASE'],
          },
        },
        _count: { id: true },
      });

      const countMap = new Map<string, number>();
      for (const row of result) {
        countMap.set(row.poolAddress, row._count.id);
      }

      log.methodExit(this.logger, 'getActiveVaultCounts', { poolCount: countMap.size });
      return countMap;
    } catch (error) {
      log.methodError(this.logger, 'getActiveVaultCounts', error as Error);
      throw error;
    }
  }
}
