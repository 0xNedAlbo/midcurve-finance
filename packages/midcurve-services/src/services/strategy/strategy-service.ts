/**
 * Strategy Service
 *
 * Core service for managing automated strategies.
 * Handles CRUD operations, status transitions, and strategy-position relationships.
 */

import { PrismaClient } from '@midcurve/database';
import type {
  Strategy,
  StrategyType,
  StrategyConfigMap,
  StrategyStatus,
} from '@midcurve/shared';
import { createInitialBasicUniswapV3State } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for StrategyService
 */
export interface StrategyServiceDependencies {
  prisma?: PrismaClient;
}

/**
 * Input for creating a new strategy
 */
export interface CreateStrategyInput<S extends StrategyType> {
  userId: string;
  strategyType: S;
  name: string;
  description?: string;
  automationWalletId: string;
  intentSignature: string;
  intentPayload: string;
  config: StrategyConfigMap[S]['config'];
}

/**
 * Input for updating a strategy
 */
export interface UpdateStrategyInput<S extends StrategyType> {
  name?: string;
  description?: string | null;
  status?: StrategyStatus;
  lastRunAt?: Date;
  lastError?: string | null;
  state?: StrategyConfigMap[S]['state'];
}

/**
 * Raw database result for Strategy
 */
interface StrategyDbResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  strategyType: string;
  name: string;
  description: string | null;
  automationWalletId: string;
  intentSignature: string;
  intentPayload: string;
  status: string;
  activatedAt: Date | null;
  stoppedAt: Date | null;
  lastRunAt: Date | null;
  lastError: string | null;
  config: unknown;
  state: unknown;
}

/**
 * Strategy Service
 *
 * Manages automated strategies with support for:
 * - CRUD operations
 * - Status transitions
 * - Strategy-position relationships via join table
 */
export class StrategyService<S extends StrategyType = StrategyType> {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;
  protected readonly strategyType?: S;

  constructor(
    dependencies: StrategyServiceDependencies = {},
    strategyType?: S
  ) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('StrategyService');
    this.strategyType = strategyType;
  }

  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new strategy
   */
  async create(input: CreateStrategyInput<S>): Promise<Strategy<S>> {
    log.methodEntry(this.logger, 'create', {
      userId: input.userId,
      strategyType: input.strategyType,
      name: input.name,
    });

    try {
      // Get initial state based on strategy type
      const initialState = this.getInitialState(input.strategyType);

      log.dbOperation(this.logger, 'create', 'Strategy', {
        userId: input.userId,
        strategyType: input.strategyType,
      });

      const result = await this.prisma.strategy.create({
        data: {
          userId: input.userId,
          strategyType: input.strategyType,
          name: input.name,
          description: input.description ?? null,
          automationWalletId: input.automationWalletId,
          intentSignature: input.intentSignature,
          intentPayload: input.intentPayload,
          status: 'pending',
          config: input.config as object,
          state: initialState as object,
        },
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      this.logger.info(
        { id: strategy.id, strategyType: strategy.strategyType },
        'Strategy created'
      );
      log.methodExit(this.logger, 'create', { id: strategy.id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, {
        userId: input.userId,
        strategyType: input.strategyType,
      });
      throw error;
    }
  }

  /**
   * Find strategy by ID
   */
  async findById(id: string): Promise<Strategy<S> | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      log.dbOperation(this.logger, 'findUnique', 'Strategy', { id });

      const result = await this.prisma.strategy.findUnique({
        where: { id },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      // Filter by strategy type if specified
      if (this.strategyType && result.strategyType !== this.strategyType) {
        log.methodExit(this.logger, 'findById', {
          id,
          found: false,
          reason: 'wrong_strategy_type',
        });
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
   * Find all strategies for a user
   */
  async findByUserId(userId: string): Promise<Strategy<S>[]> {
    log.methodEntry(this.logger, 'findByUserId', { userId });

    try {
      log.dbOperation(this.logger, 'findMany', 'Strategy', { userId });

      const where: any = { userId };
      if (this.strategyType) {
        where.strategyType = this.strategyType;
      }

      const results = await this.prisma.strategy.findMany({
        where,
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
      log.methodError(this.logger, 'findByUserId', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Find all active strategies (for worker to process)
   */
  async findActive(): Promise<Strategy<S>[]> {
    log.methodEntry(this.logger, 'findActive', {});

    try {
      log.dbOperation(this.logger, 'findMany', 'Strategy', { status: 'active' });

      const where: any = { status: 'active' };
      if (this.strategyType) {
        where.strategyType = this.strategyType;
      }

      const results = await this.prisma.strategy.findMany({
        where,
        orderBy: { lastRunAt: 'asc' }, // Process oldest first
      });

      const strategies = results.map((r) =>
        this.mapToStrategy(r as StrategyDbResult)
      );

      log.methodExit(this.logger, 'findActive', { count: strategies.length });
      return strategies;
    } catch (error) {
      log.methodError(this.logger, 'findActive', error as Error, {});
      throw error;
    }
  }

  /**
   * Update a strategy
   */
  async update(id: string, input: UpdateStrategyInput<S>): Promise<Strategy<S>> {
    log.methodEntry(this.logger, 'update', { id, input });

    try {
      const data: any = {};

      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.lastRunAt !== undefined) data.lastRunAt = input.lastRunAt;
      if (input.lastError !== undefined) data.lastError = input.lastError;
      if (input.state !== undefined) data.state = input.state as object;

      // Handle status transitions
      if (input.status !== undefined) {
        data.status = input.status;
        if (input.status === 'active' && !data.activatedAt) {
          data.activatedAt = new Date();
        }
        if (
          input.status === 'stopped' ||
          input.status === 'completed' ||
          input.status === 'error'
        ) {
          data.stoppedAt = new Date();
        }
      }

      log.dbOperation(this.logger, 'update', 'Strategy', {
        id,
        fields: Object.keys(data),
      });

      const result = await this.prisma.strategy.update({
        where: { id },
        data,
      });

      const strategy = this.mapToStrategy(result as StrategyDbResult);

      log.methodExit(this.logger, 'update', { id });
      return strategy;
    } catch (error) {
      log.methodError(this.logger, 'update', error as Error, { id });
      throw error;
    }
  }

  /**
   * Delete a strategy
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      log.dbOperation(this.logger, 'delete', 'Strategy', { id });

      await this.prisma.strategy.delete({
        where: { id },
      });

      log.methodExit(this.logger, 'delete', { id, deleted: true });
    } catch (error: any) {
      if (error.code === 'P2025') {
        this.logger.debug({ id }, 'Strategy not found, delete is no-op');
        log.methodExit(this.logger, 'delete', { id, deleted: false });
        return;
      }
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }

  // ============================================================================
  // STATUS TRANSITIONS
  // ============================================================================

  /**
   * Activate a strategy
   */
  async activate(id: string): Promise<Strategy<S>> {
    return this.update(id, { status: 'active' });
  }

  /**
   * Pause a strategy
   */
  async pause(id: string): Promise<Strategy<S>> {
    return this.update(id, { status: 'paused' });
  }

  /**
   * Stop a strategy
   */
  async stop(id: string): Promise<Strategy<S>> {
    return this.update(id, { status: 'stopped' });
  }

  /**
   * Mark strategy as completed
   */
  async complete(id: string): Promise<Strategy<S>> {
    return this.update(id, { status: 'completed' });
  }

  /**
   * Mark strategy as errored
   */
  async markError(id: string, error: string): Promise<Strategy<S>> {
    return this.update(id, { status: 'error', lastError: error });
  }

  // ============================================================================
  // POSITION MANAGEMENT
  // ============================================================================

  /**
   * Link a position to a strategy
   */
  async addPosition(
    strategyId: string,
    positionId: string,
    role: 'primary' | 'secondary' | 'hedge' = 'primary'
  ): Promise<void> {
    log.methodEntry(this.logger, 'addPosition', {
      strategyId,
      positionId,
      role,
    });

    try {
      log.dbOperation(this.logger, 'create', 'StrategyPosition', {
        strategyId,
        positionId,
      });

      await this.prisma.strategyPosition.create({
        data: {
          strategyId,
          positionId,
          role,
        },
      });

      log.methodExit(this.logger, 'addPosition', { strategyId, positionId });
    } catch (error) {
      log.methodError(this.logger, 'addPosition', error as Error, {
        strategyId,
        positionId,
      });
      throw error;
    }
  }

  /**
   * Unlink a position from a strategy (soft delete)
   */
  async removePosition(strategyId: string, positionId: string): Promise<void> {
    log.methodEntry(this.logger, 'removePosition', { strategyId, positionId });

    try {
      log.dbOperation(this.logger, 'update', 'StrategyPosition', {
        strategyId,
        positionId,
      });

      await this.prisma.strategyPosition.updateMany({
        where: {
          strategyId,
          positionId,
          removedAt: null,
        },
        data: {
          removedAt: new Date(),
        },
      });

      log.methodExit(this.logger, 'removePosition', { strategyId, positionId });
    } catch (error) {
      log.methodError(this.logger, 'removePosition', error as Error, {
        strategyId,
        positionId,
      });
      throw error;
    }
  }

  /**
   * Get all active positions for a strategy
   */
  async getPositionIds(strategyId: string): Promise<string[]> {
    log.methodEntry(this.logger, 'getPositionIds', { strategyId });

    try {
      log.dbOperation(this.logger, 'findMany', 'StrategyPosition', {
        strategyId,
      });

      const results = await this.prisma.strategyPosition.findMany({
        where: {
          strategyId,
          removedAt: null,
        },
        select: { positionId: true },
      });

      const positionIds = results.map((r) => r.positionId);

      log.methodExit(this.logger, 'getPositionIds', {
        strategyId,
        count: positionIds.length,
      });
      return positionIds;
    } catch (error) {
      log.methodError(this.logger, 'getPositionIds', error as Error, {
        strategyId,
      });
      throw error;
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Get initial state based on strategy type
   */
  protected getInitialState(
    strategyType: StrategyType
  ): StrategyConfigMap[StrategyType]['state'] {
    switch (strategyType) {
      case 'basicUniswapV3':
        return createInitialBasicUniswapV3State();
      default:
        throw new Error(`Unknown strategy type: ${strategyType}`);
    }
  }

  /**
   * Map database result to Strategy type
   */
  protected mapToStrategy(dbResult: StrategyDbResult): Strategy<S> {
    return {
      id: dbResult.id,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      userId: dbResult.userId,
      strategyType: dbResult.strategyType as S,
      name: dbResult.name,
      description: dbResult.description,
      automationWalletId: dbResult.automationWalletId,
      intentSignature: dbResult.intentSignature,
      intentPayload: dbResult.intentPayload,
      status: dbResult.status as StrategyStatus,
      activatedAt: dbResult.activatedAt,
      stoppedAt: dbResult.stoppedAt,
      lastRunAt: dbResult.lastRunAt,
      lastError: dbResult.lastError,
      config: dbResult.config as StrategyConfigMap[S]['config'],
      state: dbResult.state as StrategyConfigMap[S]['state'],
    };
  }
}

/**
 * BasicUniswapV3 Strategy Service
 *
 * Type-safe service for basicUniswapV3 strategies.
 */
export class BasicUniswapV3StrategyService extends StrategyService<'basicUniswapV3'> {
  constructor(dependencies: StrategyServiceDependencies = {}) {
    super(dependencies, 'basicUniswapV3');
  }
}
