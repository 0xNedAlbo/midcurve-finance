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
  StrategyState,
  StrategyConfig,
  AnyPosition,
  AnyToken,
  StrategyAutomationWallet,
  PositionWithQuoteToken,
} from '@midcurve/shared';
import {
  aggregatePositionMetrics,
  aggregatePositionMetricsWithBasicCurrency,
  resolveBasicCurrencyId,
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
  serializeMetricsToDb,
  createEmptyMetrics,
  PositionNoBasicCurrencyError,
  StrategyBasicCurrencyMismatchError,
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
  state: string;
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
  skippedPositionIds: string[];
  config: unknown;
  quoteToken?: any;
  positions?: any[];
  automationWallets?: any[];
}

/**
 * Strategy Service
 *
 * Handles all strategy-related database operations including:
 * - CRUD operations
 * - State transitions (activate, pause, resume, shutdown)
 * - Position linking/unlinking
 * - Wallet linking/unlinking
 * - Metrics aggregation
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
          // State defaults to 'pending'
          // Metrics default to '0' in schema
        },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info(
        { id: strategy.id, name: strategy.name, state: strategy.state },
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
      if (options.state) {
        if (Array.isArray(options.state)) {
          whereClause.state = { in: options.state };
        } else {
          whereClause.state = options.state;
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
        select: { state: true },
      });

      if (!current) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const currentState = current.state as StrategyState;
      // activate() only works from pending state
      if (currentState !== 'pending') {
        throw new StrategyInvalidStateError(id, currentState, 'active');
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data: {
          state: 'active',
          chainId: input.chainId,
          contractAddress: input.contractAddress,
        },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info(
        {
          id: strategy.id,
          state: strategy.state,
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
        select: { state: true },
      });

      if (!current) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const currentState = current.state as StrategyState;
      if (!isValidTransition(currentState, 'paused')) {
        throw new StrategyInvalidStateError(id, currentState, 'paused');
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data: { state: 'paused' },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info({ id: strategy.id, state: strategy.state }, 'Strategy paused');
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
        select: { state: true },
      });

      if (!current) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const currentState = current.state as StrategyState;
      // resume() only works from paused state
      if (currentState !== 'paused') {
        throw new StrategyInvalidStateError(id, currentState, 'active');
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data: { state: 'active' },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info({ id: strategy.id, state: strategy.state }, 'Strategy resumed');
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
        select: { state: true },
      });

      if (!current) {
        throw new Error(`Strategy not found: ${id}`);
      }

      const currentState = current.state as StrategyState;
      if (!isValidTransition(currentState, 'shutdown')) {
        throw new StrategyInvalidStateError(id, currentState, 'shutdown');
      }

      const result = await this.prisma.strategy.update({
        where: { id },
        data: { state: 'shutdown' },
        include: this.getIncludeOptions({}),
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info({ id: strategy.id, state: strategy.state }, 'Strategy shutdown');
      log.methodExit(this.logger, 'shutdown', { id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'shutdown', error as Error, { id });
      throw error;
    }
  }

  // ============================================================================
  // POSITION MANAGEMENT
  // ============================================================================

  /**
   * Links a position to a strategy
   *
   * Validates that the position's quote token is linked to a basic currency,
   * and that it matches the strategy's basic currency. If the strategy doesn't
   * have a quoteTokenId yet (first position), it adopts the position's
   * quote token's basic currency.
   *
   * @param strategyId - Strategy ID
   * @param positionId - Position ID
   * @returns The updated strategy with refreshed metrics
   * @throws PositionNoBasicCurrencyError if quote token has no basic currency link
   * @throws StrategyBasicCurrencyMismatchError if basic currencies don't match
   */
  async linkPosition(strategyId: string, positionId: string): Promise<Strategy> {
    log.methodEntry(this.logger, 'linkPosition', { strategyId, positionId });

    try {
      // Fetch strategy (with quoteToken if set) and position with pool/tokens
      const [strategy, position] = await Promise.all([
        this.prisma.strategy.findUnique({
          where: { id: strategyId },
          include: {
            quoteToken: true,
          },
        }),
        this.prisma.position.findUnique({
          where: { id: positionId },
          include: {
            pool: {
              include: {
                token0: true,
                token1: true,
              },
            },
          },
        }),
      ]);

      if (!strategy) {
        throw new Error(`Strategy not found: ${strategyId}`);
      }
      if (!position) {
        throw new Error(`Position not found: ${positionId}`);
      }

      // Determine position's quote token
      const positionQuoteTokenDb = position.isToken0Quote
        ? position.pool.token0
        : position.pool.token1;
      const positionQuoteToken = this.mapDbTokenToAnyToken(positionQuoteTokenDb);

      // Resolve basic currency for position's quote token
      const positionBasicCurrencyId = resolveBasicCurrencyId(positionQuoteToken);

      if (!positionBasicCurrencyId) {
        throw new PositionNoBasicCurrencyError(
          positionId,
          positionQuoteToken.id,
          positionQuoteToken.symbol
        );
      }

      // If strategy has a quoteTokenId, validate basic currency match
      if (strategy.quoteTokenId && strategy.quoteToken) {
        const strategyQuoteToken = this.mapDbTokenToAnyToken(strategy.quoteToken);
        const strategyBasicCurrencyId = resolveBasicCurrencyId(strategyQuoteToken);

        // Strategy's quoteToken should always have a basic currency link
        // (it was validated when the first position was linked)
        if (strategyBasicCurrencyId && strategyBasicCurrencyId !== positionBasicCurrencyId) {
          throw new StrategyBasicCurrencyMismatchError(
            strategyId,
            strategyBasicCurrencyId,
            positionBasicCurrencyId
          );
        }
      }

      // Update position with strategy reference, and update strategy quote token if needed
      // Note: We now set the strategy's quoteTokenId to the BASIC CURRENCY, not the platform token
      await this.prisma.$transaction([
        this.prisma.position.update({
          where: { id: positionId },
          data: { strategyId },
        }),
        ...(strategy.quoteTokenId
          ? []
          : [
              this.prisma.strategy.update({
                where: { id: strategyId },
                data: { quoteTokenId: positionBasicCurrencyId },
              }),
            ]),
      ]);

      // Refresh metrics after linking
      const result = await this.refreshMetrics(strategyId);

      this.logger.info(
        { strategyId, positionId, basicCurrencyId: positionBasicCurrencyId },
        'Position linked to strategy'
      );
      log.methodExit(this.logger, 'linkPosition', { strategyId, positionId });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'linkPosition', error as Error, {
        strategyId,
        positionId,
      });
      throw error;
    }
  }

  /**
   * Unlinks a position from its strategy
   *
   * @param positionId - Position ID
   */
  async unlinkPosition(positionId: string): Promise<void> {
    log.methodEntry(this.logger, 'unlinkPosition', { positionId });

    try {
      // Get position to find the strategy it belongs to
      const position = await this.prisma.position.findUnique({
        where: { id: positionId },
        select: { strategyId: true },
      });

      if (!position) {
        throw new Error(`Position not found: ${positionId}`);
      }

      const strategyId = position.strategyId;

      // Unlink position
      await this.prisma.position.update({
        where: { id: positionId },
        data: { strategyId: null },
      });

      // Refresh strategy metrics if it was linked
      if (strategyId) {
        await this.refreshMetrics(strategyId);
      }

      this.logger.info({ positionId, strategyId }, 'Position unlinked from strategy');
      log.methodExit(this.logger, 'unlinkPosition', { positionId });
    } catch (error) {
      log.methodError(this.logger, 'unlinkPosition', error as Error, {
        positionId,
      });
      throw error;
    }
  }

  /**
   * Gets all positions linked to a strategy
   *
   * @param strategyId - Strategy ID
   * @returns Array of positions
   */
  async getPositions(strategyId: string): Promise<AnyPosition[]> {
    log.methodEntry(this.logger, 'getPositions', { strategyId });

    try {
      const positions = await this.prisma.position.findMany({
        where: { strategyId },
        include: {
          pool: {
            include: {
              token0: true,
              token1: true,
            },
          },
        },
      });

      // Map to AnyPosition type
      const result = positions.map((p) => this.mapDbPositionToAnyPosition(p));

      log.methodExit(this.logger, 'getPositions', {
        strategyId,
        count: result.length,
      });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'getPositions', error as Error, {
        strategyId,
      });
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
   * Refreshes strategy metrics by aggregating from all linked positions
   *
   * Uses basic currency normalization when the strategy has a quoteTokenId set
   * (which points to a basic currency). Positions whose quote tokens are not
   * linkable to the strategy's basic currency are skipped and their IDs stored.
   *
   * Note: This method does NOT trigger refresh on the individual positions.
   * Call position refresh separately if needed before calling this method.
   *
   * @param id - Strategy ID
   * @returns The strategy with updated metrics
   */
  async refreshMetrics(id: string): Promise<Strategy> {
    log.methodEntry(this.logger, 'refreshMetrics', { id });

    try {
      // Get strategy to check if it has a quoteTokenId (basic currency)
      const strategy = await this.prisma.strategy.findUnique({
        where: { id },
        select: { quoteTokenId: true },
      });

      if (!strategy) {
        throw new Error(`Strategy not found: ${id}`);
      }

      // Get all positions linked to this strategy with pool/tokens
      const positionsWithQuoteTokens = await this.getPositionsWithQuoteTokens(id);

      let metrics = createEmptyMetrics();
      let skippedPositionIds: string[] = [];

      if (positionsWithQuoteTokens.length > 0) {
        if (strategy.quoteTokenId) {
          // Use basic currency aggregation with decimal normalization
          const aggregationResult = aggregatePositionMetricsWithBasicCurrency(
            positionsWithQuoteTokens,
            strategy.quoteTokenId
          );
          metrics = aggregationResult.metrics;
          skippedPositionIds = aggregationResult.skippedPositionIds;

          // Log skip reasons for debugging
          if (aggregationResult.skippedPositionIds.length > 0) {
            this.logger.warn(
              {
                strategyId: id,
                skippedCount: aggregationResult.skippedPositionIds.length,
                skipReasons: Object.fromEntries(aggregationResult.skipReasons),
              },
              'Some positions skipped during metrics aggregation'
            );
          }
        } else {
          // No basic currency set - use simple aggregation (legacy behavior)
          // This shouldn't happen in normal flow since linkPosition sets quoteTokenId
          const positions = positionsWithQuoteTokens.map((p) => p.position);
          metrics = aggregatePositionMetrics(positions);
        }
      }

      // Update strategy with new metrics and skipped position IDs
      const metricsDb = serializeMetricsToDb(metrics);

      const result = await this.prisma.strategy.update({
        where: { id },
        data: {
          ...metricsDb,
          skippedPositionIds,
        },
        include: this.getIncludeOptions({}),
      });

      const updatedStrategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info(
        {
          id: updatedStrategy.id,
          positionCount: positionsWithQuoteTokens.length,
          includedCount: positionsWithQuoteTokens.length - skippedPositionIds.length,
          skippedCount: skippedPositionIds.length,
          currentValue: updatedStrategy.metrics.currentValue.toString(),
        },
        'Strategy metrics refreshed'
      );
      log.methodExit(this.logger, 'refreshMetrics', { id });
      return updatedStrategy;
    } catch (error) {
      log.methodError(this.logger, 'refreshMetrics', error as Error, { id });
      throw error;
    }
  }

  /**
   * Gets all positions linked to a strategy with their resolved quote tokens
   *
   * This is used internally for metrics aggregation with basic currency normalization.
   *
   * @param strategyId - Strategy ID
   * @returns Array of positions with their quote tokens
   */
  private async getPositionsWithQuoteTokens(
    strategyId: string
  ): Promise<PositionWithQuoteToken[]> {
    const positions = await this.prisma.position.findMany({
      where: { strategyId },
      include: {
        pool: {
          include: {
            token0: true,
            token1: true,
          },
        },
      },
    });

    return positions.map((p) => {
      const position = this.mapDbPositionToAnyPosition(p);
      const quoteTokenDb = p.isToken0Quote ? p.pool.token0 : p.pool.token1;
      const quoteToken = this.mapDbTokenToAnyToken(quoteTokenDb);

      return { position, quoteToken };
    });
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

    if (options.includePositions) {
      include.positions = {
        include: {
          pool: {
            include: {
              token0: true,
              token1: true,
            },
          },
        },
      };
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
      state: dbResult.state as StrategyState,
      contractAddress: dbResult.contractAddress,
      chainId: dbResult.chainId,
      quoteTokenId: dbResult.quoteTokenId,
      metrics,
      skippedPositionIds: dbResult.skippedPositionIds ?? [],
      config: dbResult.config as StrategyConfig,
    };

    // Add optional relations if present
    if (dbResult.quoteToken) {
      strategy.quoteToken = this.mapDbTokenToAnyToken(dbResult.quoteToken);
    }

    if (dbResult.positions) {
      strategy.positions = dbResult.positions.map((p) =>
        this.mapDbPositionToAnyPosition(p)
      );
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

  /**
   * Map database position to AnyPosition type
   */
  private mapDbPositionToAnyPosition(dbPosition: any): AnyPosition {
    return {
      id: dbPosition.id,
      positionHash: dbPosition.positionHash ?? '',
      createdAt: dbPosition.createdAt,
      updatedAt: dbPosition.updatedAt,
      protocol: dbPosition.protocol,
      positionType: dbPosition.positionType,
      userId: dbPosition.userId,
      strategyId: dbPosition.strategyId,
      currentValue: BigInt(dbPosition.currentValue),
      currentCostBasis: BigInt(dbPosition.currentCostBasis),
      realizedPnl: BigInt(dbPosition.realizedPnl),
      unrealizedPnl: BigInt(dbPosition.unrealizedPnl),
      realizedCashflow: BigInt(dbPosition.realizedCashflow),
      unrealizedCashflow: BigInt(dbPosition.unrealizedCashflow),
      collectedFees: BigInt(dbPosition.collectedFees),
      unClaimedFees: BigInt(dbPosition.unClaimedFees),
      lastFeesCollectedAt: dbPosition.lastFeesCollectedAt,
      totalApr: dbPosition.totalApr,
      priceRangeLower: BigInt(dbPosition.priceRangeLower),
      priceRangeUpper: BigInt(dbPosition.priceRangeUpper),
      pool: dbPosition.pool,
      isToken0Quote: dbPosition.isToken0Quote,
      positionOpenedAt: dbPosition.positionOpenedAt,
      positionClosedAt: dbPosition.positionClosedAt,
      isActive: dbPosition.isActive,
      config: dbPosition.config,
      state: dbPosition.state,
    };
  }
}
