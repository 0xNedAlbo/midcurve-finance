/**
 * Strategy Service
 *
 * Provides CRUD operations and state management for automated strategies.
 * Strategies can manage multiple positions across different protocols and
 * have associated automation wallets.
 */

import { PrismaClient } from '@midcurve/database';
import type { Prisma } from '@midcurve/database';
import type {
  Strategy,
  StrategyStatus,
  StrategyConfig,
  StrategyManifest,
  AnyToken,
  StrategyAutomationWallet,
} from '@midcurve/shared';
import type {
  CreateStrategyInput,
  UpdateStrategyInput,
  ActivateStrategyInput,
  FindStrategyOptions,
} from '../types/strategy/index.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import {
  isValidTransition,
  StrategyInvalidStateError,
} from './helpers/index.js';

/**
 * Dependencies for StrategyService
 */
export interface StrategyServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Database result type for Strategy with optional relations
 *
 * NOTE: Metrics are NOT stored in the database.
 * They are computed on-demand by StrategyMetricsService from:
 * - StrategyLedgerEvent records (realized metrics)
 * - Position state calculations (unrealized metrics)
 */
interface StrategyDbResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  name: string;
  strategyType: string;
  status: string;
  contractAddress: string | null;
  chainId: number | null;
  quoteTokenId: string;
  config: unknown;
  manifest?: unknown;
  quoteToken?: any;
  automationWallets?: any[];
}

/**
 * Strategy Service
 *
 * Handles all strategy-related database operations including:
 * - CRUD operations
 * - State transitions (activate, pause, resume, shutdown)
 * - Wallet linking/unlinking
 * - Metrics aggregation
 *
 * Note: Strategy-owned positions are managed via StrategyPositionService,
 * not through Position linking.
 */
export class StrategyService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new StrategyService instance
   *
   * @param dependencies - Service dependencies
   * @param dependencies.prisma - Prisma client instance (optional, defaults to new PrismaClient)
   */
  constructor(dependencies: StrategyServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('StrategyService');
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Creates a new strategy
   *
   * @param input - Strategy creation input
   * @returns The created strategy
   *
   * @example
   * ```typescript
   * const strategy = await strategyService.create({
   *   userId: 'user_123',
   *   name: 'ETH-USDC Delta Neutral',
   *   strategyType: 'delta-neutral',
   *   config: { targetDelta: 0 },
   * });
   * ```
   */
  async create(input: CreateStrategyInput): Promise<Strategy> {
    log.methodEntry(this.logger, 'create', {
      userId: input.userId,
      name: input.name,
      strategyType: input.strategyType,
    });

    try {
      const result = await this.prisma.strategy.create({
        data: {
          userId: input.userId,
          name: input.name,
          strategyType: input.strategyType,
          config: input.config as Prisma.InputJsonValue,
          quoteTokenId: input.quoteTokenId,
          manifest: input.manifest
            ? (input.manifest as unknown as Prisma.InputJsonValue)
            : undefined,
          // Status defaults to 'pending'
          // NOTE: Metrics are not stored - computed on-demand by StrategyMetricsService
        },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info(
        { id: strategy.id, name: strategy.name, state: strategy.status },
        'Strategy created'
      );
      log.methodExit(this.logger, 'create', { id: strategy.id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, { input });
      throw error;
    }
  }

  /**
   * Finds a strategy by ID
   *
   * @param id - Strategy ID
   * @param options - Find options for including relations
   * @returns The strategy if found, null otherwise
   */
  async findById(id: string, options: FindStrategyOptions = {}): Promise<Strategy | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      const result = await this.prisma.strategy.findUnique({
        where: { id },
        include: this.getIncludeOptions(options),
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      const strategy = this.mapToStrategy(result as StrategyDbResult);
      log.methodExit(this.logger, 'findById', { id, found: true });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Finds a strategy by contract address
   *
   * @param contractAddress - Contract address on internal EVM
   * @param options - Find options for including relations
   * @returns The strategy if found, null otherwise
   */
  async findByContractAddress(
    contractAddress: string,
    options: FindStrategyOptions = {}
  ): Promise<Strategy | null> {
    log.methodEntry(this.logger, 'findByContractAddress', { contractAddress });

    try {
      const result = await this.prisma.strategy.findUnique({
        where: { contractAddress },
        include: this.getIncludeOptions(options),
      });

      if (!result) {
        log.methodExit(this.logger, 'findByContractAddress', {
          contractAddress,
          found: false,
        });
        return null;
      }

      const strategy = this.mapToStrategy(result as StrategyDbResult);
      log.methodExit(this.logger, 'findByContractAddress', {
        contractAddress,
        found: true,
      });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'findByContractAddress', error as Error, {
        contractAddress,
      });
      throw error;
    }
  }

  /**
   * Finds strategies by user ID
   *
   * @param userId - User ID
   * @param options - Find options for filtering and including relations
   * @returns Array of strategies
   */
  async findByUserId(
    userId: string,
    options: FindStrategyOptions = {}
  ): Promise<Strategy[]> {
    log.methodEntry(this.logger, 'findByUserId', { userId, options });

    try {
      const whereClause: Prisma.StrategyWhereInput = { userId };

      // Add state filter if provided
      if (options.status) {
        if (Array.isArray(options.status)) {
          whereClause.status = { in: options.status };
        } else {
          whereClause.status = options.status;
        }
      }

      // Add strategyType filter if provided
      if (options.strategyType) {
        whereClause.strategyType = options.strategyType;
      }

      const results = await this.prisma.strategy.findMany({
        where: whereClause,
        include: this.getIncludeOptions(options),
        orderBy: { createdAt: 'desc' },
      });

      const strategies = results.map((r) =>
        this.mapToStrategy(r as StrategyDbResult)
      );
      log.methodExit(this.logger, 'findByUserId', {
        userId,
        count: strategies.length,
      });
      return strategies;
    } catch (error) {
      log.methodError(this.logger, 'findByUserId', error as Error, {
        userId,
        options,
      });
      throw error;
    }
  }

  /**
   * Updates a strategy
   *
   * @param id - Strategy ID
   * @param input - Update input with optional fields
   * @returns The updated strategy
   * @throws Error if strategy not found
   */
  async update(id: string, input: UpdateStrategyInput): Promise<Strategy> {
    log.methodEntry(this.logger, 'update', { id, input });

    try {
      const data: Prisma.StrategyUpdateInput = {};

      if (input.name !== undefined) {
        data.name = input.name;
      }
      if (input.strategyType !== undefined) {
        data.strategyType = input.strategyType;
      }
      if (input.config !== undefined) {
        data.config = input.config as Prisma.InputJsonValue;
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data,
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info({ id: strategy.id }, 'Strategy updated');
      log.methodExit(this.logger, 'update', { id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'update', error as Error, { id, input });
      throw error;
    }
  }

  /**
   * Deletes a strategy
   *
   * Note: Positions and wallets linked to this strategy will have their
   * strategyId set to null (due to onDelete: SetNull in schema).
   *
   * @param id - Strategy ID
   * @throws Error if strategy not found
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      await this.prisma.strategy.delete({
        where: { id },
      });

      this.logger.info({ id }, 'Strategy deleted');
      log.methodExit(this.logger, 'delete', { id });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }

  // ============================================================================
  // STATE TRANSITIONS
  // ============================================================================

  /**
   * Updates strategy status with validation
   *
   * This is the core method for all state transitions. It validates that
   * the transition is allowed before updating the database.
   *
   * @param id - Strategy ID
   * @param newStatus - Target status
   * @param additionalData - Optional additional fields to update (e.g., contractAddress)
   * @returns The updated strategy
   * @throws StrategyInvalidStateError if transition is not valid
   */
  async updateStatus(
    id: string,
    newStatus: StrategyStatus,
    additionalData?: { chainId?: number; contractAddress?: string }
  ): Promise<Strategy> {
    log.methodEntry(this.logger, 'updateStatus', { id, newStatus, additionalData });

    try {
      const current = await this.prisma.strategy.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!current) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const currentStatus = current.status as StrategyStatus;
      if (!isValidTransition(currentStatus, newStatus)) {
        throw new StrategyInvalidStateError(id, currentStatus, newStatus);
      }

      const updateData: Prisma.StrategyUpdateInput = { status: newStatus };
      if (additionalData?.chainId !== undefined) {
        updateData.chainId = additionalData.chainId;
      }
      if (additionalData?.contractAddress !== undefined) {
        updateData.contractAddress = additionalData.contractAddress;
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data: updateData,
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info(
        {
          id: strategy.id,
          from: currentStatus,
          to: strategy.status,
          contractAddress: strategy.contractAddress,
        },
        'Strategy status updated'
      );
      log.methodExit(this.logger, 'updateStatus', { id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'updateStatus', error as Error, { id, newStatus });
      throw error;
    }
  }

  /**
   * Marks strategy as deploying (pending -> deploying)
   *
   * Called by services layer when user initiates deployment.
   * After this, EVM API handles the actual deployment.
   *
   * @param id - Strategy ID
   * @returns The updated strategy
   * @throws StrategyInvalidStateError if not in pending state
   */
  async markDeploying(id: string): Promise<Strategy> {
    return this.updateStatus(id, 'deploying');
  }

  /**
   * Marks strategy as deployed (deploying -> deployed)
   *
   * Called by EVM API when deployment completes successfully.
   * Sets the on-chain contract address and chain ID.
   *
   * @param id - Strategy ID
   * @param input - Deployment info with chainId and contractAddress
   * @returns The updated strategy
   * @throws StrategyInvalidStateError if not in deploying state
   */
  async markDeployed(id: string, input: ActivateStrategyInput): Promise<Strategy> {
    return this.updateStatus(id, 'deployed', {
      chainId: input.chainId,
      contractAddress: input.contractAddress,
    });
  }

  /**
   * Marks strategy as starting (deployed -> starting)
   *
   * Called by services layer when user initiates start.
   * After this, EVM API handles the START lifecycle event.
   *
   * @param id - Strategy ID
   * @returns The updated strategy
   * @throws StrategyInvalidStateError if not in deployed state
   */
  async markStarting(id: string): Promise<Strategy> {
    return this.updateStatus(id, 'starting');
  }

  /**
   * Marks strategy as active (starting -> active)
   *
   * Called by EVM API when onStart() hook completes.
   *
   * @param id - Strategy ID
   * @returns The updated strategy
   * @throws StrategyInvalidStateError if not in starting state
   */
  async markActive(id: string): Promise<Strategy> {
    return this.updateStatus(id, 'active');
  }

  /**
   * Marks strategy as shutting down (active -> shutting_down)
   *
   * Called by services layer when user initiates shutdown.
   * After this, EVM API handles the SHUTDOWN lifecycle event.
   *
   * @param id - Strategy ID
   * @returns The updated strategy
   * @throws StrategyInvalidStateError if not in active state
   */
  async markShuttingDown(id: string): Promise<Strategy> {
    return this.updateStatus(id, 'shutting_down');
  }

  /**
   * Marks strategy as shutdown (shutting_down -> shutdown)
   *
   * Called by EVM API when shutdown cleanup completes.
   * This is a terminal state - the strategy cannot be restarted.
   *
   * @param id - Strategy ID
   * @returns The updated strategy
   * @throws StrategyInvalidStateError if not in shutting_down state
   */
  async markShutdown(id: string): Promise<Strategy> {
    return this.updateStatus(id, 'shutdown');
  }

  // ============================================================================
  // DEPRECATED STATE TRANSITIONS (maintained for backward compatibility)
  // ============================================================================

  /**
   * @deprecated Use markDeployed() instead.
   * Activates a strategy - now handles pending -> deploying -> deployed flow
   */
  async activate(id: string, input: ActivateStrategyInput): Promise<Strategy> {
    log.methodEntry(this.logger, 'activate', { id, input });
    this.logger.warn({ id }, 'activate() is deprecated - use markDeployed() instead');

    // For backward compatibility, handle the old flow
    const current = await this.prisma.strategy.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!current) {
      throw new Error(`Strategy not found: ${id}`);
    }

    const currentStatus = current.status as StrategyStatus;

    // Handle old 'pending' -> 'active' flow by going through new states
    if (currentStatus === 'pending') {
      await this.markDeploying(id);
      return this.markDeployed(id, input);
    }

    throw new StrategyInvalidStateError(id, currentStatus, 'deployed');
  }

  /**
   * @deprecated Pause functionality removed - shutdown is the only way to stop a strategy
   */
  async pause(_id: string): Promise<Strategy> {
    throw new Error(
      'pause() has been removed. Use markShuttingDown() to initiate shutdown.'
    );
  }

  /**
   * @deprecated Resume functionality removed - shutdown is permanent
   */
  async resume(_id: string): Promise<Strategy> {
    throw new Error(
      'resume() has been removed. Strategies cannot be resumed after shutdown.'
    );
  }

  /**
   * @deprecated Use markShuttingDown() followed by markShutdown() instead.
   * Direct shutdown is no longer supported - must go through proper lifecycle.
   */
  async shutdown(id: string): Promise<Strategy> {
    log.methodEntry(this.logger, 'shutdown', { id });
    this.logger.warn(
      { id },
      'shutdown() is deprecated - use markShuttingDown() then markShutdown() instead'
    );

    const current = await this.prisma.strategy.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!current) {
      throw new Error(`Strategy not found: ${id}`);
    }

    const currentStatus = current.status as StrategyStatus;

    // Handle direct shutdown for backward compatibility
    if (currentStatus === 'active') {
      await this.markShuttingDown(id);
      return this.markShutdown(id);
    } else if (currentStatus === 'shutting_down') {
      return this.markShutdown(id);
    } else if (
      currentStatus === 'deploying' ||
      currentStatus === 'deployed' ||
      currentStatus === 'starting'
    ) {
      // Allow direct shutdown from intermediate states (failure case)
      return this.updateStatus(id, 'shutdown');
    }

    throw new StrategyInvalidStateError(id, currentStatus, 'shutdown');
  }

  // ============================================================================
  // WALLET MANAGEMENT
  // ============================================================================

  /**
   * Links an automation wallet to a strategy
   *
   * @param strategyId - Strategy ID
   * @param walletId - Automation wallet ID
   * @returns The updated strategy
   */
  async linkWallet(strategyId: string, walletId: string): Promise<Strategy> {
    log.methodEntry(this.logger, 'linkWallet', { strategyId, walletId });

    try {
      // Verify strategy exists
      const strategy = await this.prisma.strategy.findUnique({
        where: { id: strategyId },
      });

      if (!strategy) {
        throw new Error(`Strategy not found: ${strategyId}`);
      }

      // Update wallet with strategy reference
      await this.prisma.automationWallet.update({
        where: { id: walletId },
        data: { strategyId },
      });

      // Return updated strategy
      const result = await this.findById(strategyId, { includeWallets: true });

      this.logger.info({ strategyId, walletId }, 'Wallet linked to strategy');
      log.methodExit(this.logger, 'linkWallet', { strategyId, walletId });
      return result!;
    } catch (error) {
      log.methodError(this.logger, 'linkWallet', error as Error, {
        strategyId,
        walletId,
      });
      throw error;
    }
  }

  /**
   * Unlinks an automation wallet from its strategy
   *
   * @param walletId - Automation wallet ID
   */
  async unlinkWallet(walletId: string): Promise<void> {
    log.methodEntry(this.logger, 'unlinkWallet', { walletId });

    try {
      await this.prisma.automationWallet.update({
        where: { id: walletId },
        data: { strategyId: null },
      });

      this.logger.info({ walletId }, 'Wallet unlinked from strategy');
      log.methodExit(this.logger, 'unlinkWallet', { walletId });
    } catch (error) {
      log.methodError(this.logger, 'unlinkWallet', error as Error, {
        walletId,
      });
      throw error;
    }
  }

  /**
   * Gets all automation wallets linked to a strategy
   *
   * @param strategyId - Strategy ID
   * @returns Array of automation wallets
   */
  async getWallets(strategyId: string): Promise<StrategyAutomationWallet[]> {
    log.methodEntry(this.logger, 'getWallets', { strategyId });

    try {
      const wallets = await this.prisma.automationWallet.findMany({
        where: { strategyId },
      });

      const result: StrategyAutomationWallet[] = wallets.map((w) => ({
        id: w.id,
        walletType: w.walletType,
        label: w.label,
        walletHash: w.walletHash,
        isActive: w.isActive,
        lastUsedAt: w.lastUsedAt,
      }));

      log.methodExit(this.logger, 'getWallets', {
        strategyId,
        count: result.length,
      });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'getWallets', error as Error, { strategyId });
      throw error;
    }
  }

  // ============================================================================
  // DEPRECATED METHODS
  // ============================================================================

  /**
   * @deprecated Use StrategyMetricsService.getMetrics() instead.
   *
   * Metrics are computed on-demand from StrategyLedgerEvent records,
   * not stored on the Strategy model.
   *
   * @param id - Strategy ID
   * @returns The strategy (without metrics - use StrategyMetricsService for metrics)
   */
  async refreshMetrics(id: string): Promise<Strategy> {
    log.methodEntry(this.logger, 'refreshMetrics', { id });

    this.logger.warn(
      { id },
      'refreshMetrics is deprecated - use StrategyMetricsService.getMetrics() instead'
    );

    try {
      const result = await this.prisma.strategy.findUnique({
        where: { id },
        include: this.getIncludeOptions({}),
      });

      if (!result) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      log.methodExit(this.logger, 'refreshMetrics', { id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'refreshMetrics', error as Error, { id });
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Get Prisma include options based on FindStrategyOptions
   */
  private getIncludeOptions(options: FindStrategyOptions): Prisma.StrategyInclude {
    const include: Prisma.StrategyInclude = {};

    if (options.includeQuoteToken) {
      include.quoteToken = true;
    }

    if (options.includeWallets) {
      include.automationWallets = true;
    }

    return include;
  }

  /**
   * Map database result to Strategy type
   *
   * NOTE: Metrics are not included here - they are computed on-demand
   * by StrategyMetricsService from StrategyLedgerEvent records.
   */
  private mapToStrategy(dbResult: StrategyDbResult): Strategy {
    const strategy: Strategy = {
      id: dbResult.id,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      userId: dbResult.userId,
      name: dbResult.name,
      strategyType: dbResult.strategyType,
      status: dbResult.status as StrategyStatus,
      contractAddress: dbResult.contractAddress,
      chainId: dbResult.chainId,
      quoteTokenId: dbResult.quoteTokenId,
      config: dbResult.config as StrategyConfig,
      manifest: dbResult.manifest
        ? (dbResult.manifest as StrategyManifest)
        : null,
    };

    // Add optional relations if present
    if (dbResult.quoteToken) {
      strategy.quoteToken = this.mapDbTokenToAnyToken(dbResult.quoteToken);
    }

    if (dbResult.automationWallets) {
      strategy.automationWallets = dbResult.automationWallets.map((w: any) => ({
        id: w.id,
        walletType: w.walletType,
        label: w.label,
        walletHash: w.walletHash,
        isActive: w.isActive,
        lastUsedAt: w.lastUsedAt,
      }));
    }

    return strategy;
  }

  /**
   * Map database token to AnyToken type
   * Generic mapping that works for any token type (ERC-20, SPL, etc.)
   */
  private mapDbTokenToAnyToken(dbToken: any): AnyToken {
    return {
      id: dbToken.id,
      createdAt: dbToken.createdAt,
      updatedAt: dbToken.updatedAt,
      tokenType: dbToken.tokenType,
      name: dbToken.name,
      symbol: dbToken.symbol,
      decimals: dbToken.decimals,
      logoUrl: dbToken.logoUrl,
      coingeckoId: dbToken.coingeckoId,
      marketCap: dbToken.marketCap,
      config: dbToken.config,
    };
  }
}
