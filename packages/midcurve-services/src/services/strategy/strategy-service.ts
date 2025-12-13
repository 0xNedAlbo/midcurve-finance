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
  parseMetricsFromDb,
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
  quoteTokenId: string | null;
  currentValue: string;
  currentCostBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  collectedFees: string;
  unClaimedFees: string;
  realizedCashflow: string;
  unrealizedCashflow: string;
  config: unknown;
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
          manifestId: input.manifestId,
          // State defaults to 'pending'
          // Metrics default to '0' in schema
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
   * Activates a strategy (pending -> active)
   *
   * Requires on-chain deployment information (chainId and contractAddress).
   *
   * @param id - Strategy ID
   * @param input - Activation input with chainId and contractAddress
   * @returns The activated strategy
   * @throws StrategyInvalidStateError if not in pending state
   */
  async activate(id: string, input: ActivateStrategyInput): Promise<Strategy> {
    log.methodEntry(this.logger, 'activate', { id, input });

    try {
      const current = await this.prisma.strategy.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!current) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const currentStatus = current.status as StrategyStatus;
      // activate() only works from pending state
      if (currentStatus !== 'pending') {
        throw new StrategyInvalidStateError(id, currentStatus, 'active');
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data: {
          status: 'active',
          chainId: input.chainId,
          contractAddress: input.contractAddress,
        },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info(
        {
          id: strategy.id,
          state: strategy.status,
          contractAddress: strategy.contractAddress,
        },
        'Strategy activated'
      );
      log.methodExit(this.logger, 'activate', { id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'activate', error as Error, { id, input });
      throw error;
    }
  }

  /**
   * Pauses a strategy (active -> paused)
   *
   * @param id - Strategy ID
   * @returns The paused strategy
   * @throws StrategyInvalidStateError if not in active state
   */
  async pause(id: string): Promise<Strategy> {
    log.methodEntry(this.logger, 'pause', { id });

    try {
      const current = await this.prisma.strategy.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!current) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const currentStatus = current.status as StrategyStatus;
      if (!isValidTransition(currentStatus, 'paused')) {
        throw new StrategyInvalidStateError(id, currentStatus, 'paused');
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data: { status: 'paused' },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info({ id: strategy.id, state: strategy.status }, 'Strategy paused');
      log.methodExit(this.logger, 'pause', { id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'pause', error as Error, { id });
      throw error;
    }
  }

  /**
   * Resumes a strategy (paused -> active)
   *
   * @param id - Strategy ID
   * @returns The resumed strategy
   * @throws StrategyInvalidStateError if not in paused state
   */
  async resume(id: string): Promise<Strategy> {
    log.methodEntry(this.logger, 'resume', { id });

    try {
      const current = await this.prisma.strategy.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!current) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const currentStatus = current.status as StrategyStatus;
      // resume() only works from paused state
      if (currentStatus !== 'paused') {
        throw new StrategyInvalidStateError(id, currentStatus, 'active');
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data: { status: 'active' },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info({ id: strategy.id, state: strategy.status }, 'Strategy resumed');
      log.methodExit(this.logger, 'resume', { id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'resume', error as Error, { id });
      throw error;
    }
  }

  /**
   * Shuts down a strategy (active/paused -> shutdown)
   *
   * This is a terminal state - the strategy cannot be restarted.
   *
   * @param id - Strategy ID
   * @returns The shutdown strategy
   * @throws StrategyInvalidStateError if in pending or already shutdown state
   */
  async shutdown(id: string): Promise<Strategy> {
    log.methodEntry(this.logger, 'shutdown', { id });

    try {
      const current = await this.prisma.strategy.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!current) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const currentStatus = current.status as StrategyStatus;
      if (!isValidTransition(currentStatus, 'shutdown')) {
        throw new StrategyInvalidStateError(id, currentStatus, 'shutdown');
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data: { status: 'shutdown' },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info({ id: strategy.id, state: strategy.status }, 'Strategy shutdown');
      log.methodExit(this.logger, 'shutdown', { id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'shutdown', error as Error, { id });
      throw error;
    }
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
  // METRICS
  // ============================================================================

  /**
   * Refreshes the strategy's aggregated metrics from strategy positions
   *
   * Note: This is a placeholder implementation. In the new architecture,
   * metrics are aggregated from StrategyLedgerEvent records via
   * StrategyLedgerService.getStrategyTotals().
   *
   * @param id - Strategy ID
   * @returns The strategy with current metrics
   */
  async refreshMetrics(id: string): Promise<Strategy> {
    log.methodEntry(this.logger, 'refreshMetrics', { id });

    try {
      // For now, just return the strategy with its current stored metrics
      // In the future, this will aggregate from StrategyLedgerEvent records
      const result = await this.prisma.strategy.findUnique({
        where: { id },
        include: this.getIncludeOptions({}),
      });

      if (!result) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info(
        {
          id: strategy.id,
          currentValue: strategy.metrics.currentValue.toString(),
        },
        'Strategy metrics retrieved'
      );
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
   */
  private mapToStrategy(dbResult: StrategyDbResult): Strategy {
    const metrics = parseMetricsFromDb(dbResult);

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
      metrics,
      config: dbResult.config as StrategyConfig,
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
