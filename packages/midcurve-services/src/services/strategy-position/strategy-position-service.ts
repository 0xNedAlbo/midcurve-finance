/**
 * Strategy Position Service
 *
 * Provides CRUD operations for strategy-owned positions.
 * Handles the lifecycle of positions that belong to strategies
 * (not user positions).
 */

import { PrismaClient, Prisma } from '@midcurve/database';
import type {
  StrategyPositionInterface,
  StrategyPositionStatus,
  StrategyPositionType,
} from '@midcurve/shared';
import { StrategyPositionFactory } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for StrategyPositionService
 */
export interface StrategyPositionServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Input for creating a new strategy position
 */
export interface CreateStrategyPositionInput {
  /**
   * Parent strategy ID
   */
  strategyId: string;

  /**
   * Position type (treasury, uniswapv3, hyperliquid)
   */
  positionType: StrategyPositionType;

  /**
   * Initial status (defaults to 'pending')
   */
  status?: StrategyPositionStatus;

  /**
   * Position configuration (type-specific JSON)
   */
  config: Record<string, unknown>;

  /**
   * Initial position state (type-specific JSON)
   */
  state: Record<string, unknown>;
}

/**
 * Input for updating a strategy position
 */
export interface UpdateStrategyPositionInput {
  /**
   * New status (optional)
   */
  status?: StrategyPositionStatus;

  /**
   * Updated config (optional, merged with existing)
   */
  config?: Record<string, unknown>;

  /**
   * Updated state (optional, merged with existing)
   */
  state?: Record<string, unknown>;
}

/**
 * Options for finding strategy positions
 */
export interface FindStrategyPositionOptions {
  /**
   * Filter by strategy ID
   */
  strategyId?: string;

  /**
   * Filter by position type
   */
  positionType?: StrategyPositionType;

  /**
   * Filter by status
   */
  status?: StrategyPositionStatus;

  /**
   * Include ledger events in result
   */
  includeLedgerEvents?: boolean;
}

/**
 * Strategy Position Service
 *
 * Handles all strategy position database operations including:
 * - CRUD operations
 * - Status transitions
 * - State updates
 */
export class StrategyPositionService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new StrategyPositionService instance
   */
  constructor(dependencies: StrategyPositionServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('StrategyPositionService');
  }

  /**
   * Create a new strategy position
   */
  async create(input: CreateStrategyPositionInput): Promise<StrategyPositionInterface> {
    log.methodEntry(this.logger, 'create', { input });

    try {
      const result = await this.prisma.strategyPosition.create({
        data: {
          strategyId: input.strategyId,
          positionType: input.positionType,
          status: input.status ?? 'pending',
          config: input.config as Prisma.InputJsonValue,
          state: input.state as Prisma.InputJsonValue,
        },
      });

      const position = StrategyPositionFactory.fromDB({
        id: result.id,
        strategyId: result.strategyId,
        positionType: result.positionType,
        status: result.status as StrategyPositionStatus,
        openedAt: result.openedAt,
        closedAt: result.closedAt,
        config: result.config as Record<string, unknown>,
        state: result.state as Record<string, unknown>,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      });

      log.methodExit(this.logger, 'create', { id: position.id });
      return position;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, { input });
      throw error;
    }
  }

  /**
   * Find a strategy position by ID
   */
  async findById(id: string): Promise<StrategyPositionInterface | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      const result = await this.prisma.strategyPosition.findUnique({
        where: { id },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { found: false });
        return null;
      }

      const position = StrategyPositionFactory.fromDB({
        id: result.id,
        strategyId: result.strategyId,
        positionType: result.positionType,
        status: result.status as StrategyPositionStatus,
        openedAt: result.openedAt,
        closedAt: result.closedAt,
        config: result.config as Record<string, unknown>,
        state: result.state as Record<string, unknown>,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      });

      log.methodExit(this.logger, 'findById', { found: true });
      return position;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Find strategy positions with filters
   */
  async find(options: FindStrategyPositionOptions = {}): Promise<StrategyPositionInterface[]> {
    log.methodEntry(this.logger, 'find', { options });

    try {
      const where: Record<string, unknown> = {};

      if (options.strategyId) {
        where.strategyId = options.strategyId;
      }

      if (options.positionType) {
        where.positionType = options.positionType;
      }

      if (options.status) {
        where.status = options.status;
      }

      const results = await this.prisma.strategyPosition.findMany({
        where,
        include: {
          ledgerEvents: options.includeLedgerEvents ?? false,
        },
        orderBy: { createdAt: 'desc' },
      });

      const positions = results.map((result) =>
        StrategyPositionFactory.fromDB({
          id: result.id,
          strategyId: result.strategyId,
          positionType: result.positionType,
          status: result.status as StrategyPositionStatus,
          openedAt: result.openedAt,
          closedAt: result.closedAt,
          config: result.config as Record<string, unknown>,
          state: result.state as Record<string, unknown>,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        })
      );

      log.methodExit(this.logger, 'find', { count: positions.length });
      return positions;
    } catch (error) {
      log.methodError(this.logger, 'find', error as Error, { options });
      throw error;
    }
  }

  /**
   * Find all positions for a strategy
   */
  async findByStrategyId(strategyId: string): Promise<StrategyPositionInterface[]> {
    return this.find({ strategyId });
  }

  /**
   * Update a strategy position
   */
  async update(
    id: string,
    input: UpdateStrategyPositionInput
  ): Promise<StrategyPositionInterface> {
    log.methodEntry(this.logger, 'update', { id, input });

    try {
      const existing = await this.prisma.strategyPosition.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Strategy position not found: ${id}`);
      }

      const updateData: Record<string, unknown> = {};

      if (input.status !== undefined) {
        updateData.status = input.status;

        // Handle status transitions
        if (input.status === 'active' && !existing.openedAt) {
          updateData.openedAt = new Date();
        }

        if (input.status === 'closed' && !existing.closedAt) {
          updateData.closedAt = new Date();
        }
      }

      if (input.config !== undefined) {
        // Merge with existing config
        updateData.config = {
          ...(existing.config as Record<string, unknown>),
          ...input.config,
        };
      }

      if (input.state !== undefined) {
        // Merge with existing state
        updateData.state = {
          ...(existing.state as Record<string, unknown>),
          ...input.state,
        };
      }

      const result = await this.prisma.strategyPosition.update({
        where: { id },
        data: updateData,
      });

      const position = StrategyPositionFactory.fromDB({
        id: result.id,
        strategyId: result.strategyId,
        positionType: result.positionType,
        status: result.status as StrategyPositionStatus,
        openedAt: result.openedAt,
        closedAt: result.closedAt,
        config: result.config as Record<string, unknown>,
        state: result.state as Record<string, unknown>,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      });

      log.methodExit(this.logger, 'update', { id });
      return position;
    } catch (error) {
      log.methodError(this.logger, 'update', error as Error, { id, input });
      throw error;
    }
  }

  /**
   * Update position state (shorthand for updating only state)
   */
  async updateState(
    id: string,
    state: Record<string, unknown>
  ): Promise<StrategyPositionInterface> {
    return this.update(id, { state });
  }

  /**
   * Activate a position (status = active, openedAt = now)
   */
  async activate(id: string): Promise<StrategyPositionInterface> {
    return this.update(id, { status: 'active' });
  }

  /**
   * Pause a position
   */
  async pause(id: string): Promise<StrategyPositionInterface> {
    return this.update(id, { status: 'paused' });
  }

  /**
   * Close a position (status = closed, closedAt = now)
   */
  async close(id: string): Promise<StrategyPositionInterface> {
    return this.update(id, { status: 'closed' });
  }

  /**
   * Delete a strategy position
   *
   * Note: This will cascade delete all associated ledger events.
   */
  async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      await this.prisma.strategyPosition.delete({
        where: { id },
      });

      log.methodExit(this.logger, 'delete', { id });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }
}
