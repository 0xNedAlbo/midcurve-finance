/**
 * Strategy Action Service
 *
 * Manages user-initiated actions submitted to strategies.
 * Actions are validated, stored, and then converted to events for processing.
 */

import { PrismaClient } from '@midcurve/database';
import type {
  StrategyAction,
  StrategyActionType,
  StrategyActionStatus,
} from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for StrategyActionService
 */
export interface StrategyActionServiceDependencies {
  prisma?: PrismaClient;
}

/**
 * Input for creating a new strategy action
 */
export interface CreateStrategyActionInput {
  strategyId: string;
  userId: string;
  actionType: StrategyActionType;
  payload: unknown;
  intentSignature: string;
  intentPayload: string;
}

/**
 * Input for updating a strategy action
 */
export interface UpdateStrategyActionInput {
  status?: StrategyActionStatus;
  errorMessage?: string | null;
  result?: unknown;
  processedAt?: Date;
  completedAt?: Date;
}

/**
 * Raw database result for StrategyAction
 */
interface StrategyActionDbResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  strategyId: string;
  userId: string;
  actionType: string;
  payload: unknown;
  intentSignature: string;
  intentPayload: string;
  status: string;
  errorMessage: string | null;
  result: unknown | null;
  processedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Strategy Action Service
 *
 * Manages the lifecycle of user-initiated actions:
 * 1. User submits action via API
 * 2. Action is validated and stored with 'pending' status
 * 3. Worker picks up pending actions and converts to events
 * 4. Strategy processes action and updates status
 */
export class StrategyActionService {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;

  constructor(dependencies: StrategyActionServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('StrategyActionService');
  }

  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new strategy action
   */
  async create(input: CreateStrategyActionInput): Promise<StrategyAction> {
    log.methodEntry(this.logger, 'create', {
      strategyId: input.strategyId,
      userId: input.userId,
      actionType: input.actionType,
    });

    try {
      log.dbOperation(this.logger, 'create', 'StrategyAction', {
        strategyId: input.strategyId,
        actionType: input.actionType,
      });

      const result = await this.prisma.strategyAction.create({
        data: {
          strategyId: input.strategyId,
          userId: input.userId,
          actionType: input.actionType,
          payload: input.payload as object,
          intentSignature: input.intentSignature,
          intentPayload: input.intentPayload,
          status: 'pending',
        },
      });

      const action = this.mapToStrategyAction(result as StrategyActionDbResult);

      this.logger.info(
        {
          id: action.actionId,
          strategyId: action.strategyId,
          actionType: action.actionType,
        },
        'Strategy action created'
      );
      log.methodExit(this.logger, 'create', { id: action.actionId });
      return action;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, {
        strategyId: input.strategyId,
        actionType: input.actionType,
      });
      throw error;
    }
  }

  /**
   * Find action by ID
   */
  async findById(id: string): Promise<StrategyAction | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      log.dbOperation(this.logger, 'findUnique', 'StrategyAction', { id });

      const result = await this.prisma.strategyAction.findUnique({
        where: { id },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      const action = this.mapToStrategyAction(result as StrategyActionDbResult);
      log.methodExit(this.logger, 'findById', { id, found: true });
      return action;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Find all pending actions for a strategy
   */
  async findPendingByStrategyId(strategyId: string): Promise<StrategyAction[]> {
    log.methodEntry(this.logger, 'findPendingByStrategyId', { strategyId });

    try {
      log.dbOperation(this.logger, 'findMany', 'StrategyAction', {
        strategyId,
        status: 'pending',
      });

      const results = await this.prisma.strategyAction.findMany({
        where: {
          strategyId,
          status: 'pending',
        },
        orderBy: { createdAt: 'asc' }, // FIFO order
      });

      const actions = results.map((r) =>
        this.mapToStrategyAction(r as StrategyActionDbResult)
      );

      log.methodExit(this.logger, 'findPendingByStrategyId', {
        strategyId,
        count: actions.length,
      });
      return actions;
    } catch (error) {
      log.methodError(this.logger, 'findPendingByStrategyId', error as Error, {
        strategyId,
      });
      throw error;
    }
  }

  /**
   * Find all actions for a strategy
   */
  async findByStrategyId(strategyId: string): Promise<StrategyAction[]> {
    log.methodEntry(this.logger, 'findByStrategyId', { strategyId });

    try {
      log.dbOperation(this.logger, 'findMany', 'StrategyAction', { strategyId });

      const results = await this.prisma.strategyAction.findMany({
        where: { strategyId },
        orderBy: { createdAt: 'desc' },
      });

      const actions = results.map((r) =>
        this.mapToStrategyAction(r as StrategyActionDbResult)
      );

      log.methodExit(this.logger, 'findByStrategyId', {
        strategyId,
        count: actions.length,
      });
      return actions;
    } catch (error) {
      log.methodError(this.logger, 'findByStrategyId', error as Error, {
        strategyId,
      });
      throw error;
    }
  }

  /**
   * Update an action
   */
  async update(
    id: string,
    input: UpdateStrategyActionInput
  ): Promise<StrategyAction> {
    log.methodEntry(this.logger, 'update', { id, input });

    try {
      const data: any = {};

      if (input.status !== undefined) data.status = input.status;
      if (input.errorMessage !== undefined) data.errorMessage = input.errorMessage;
      if (input.result !== undefined) data.result = input.result as object;
      if (input.processedAt !== undefined) data.processedAt = input.processedAt;
      if (input.completedAt !== undefined) data.completedAt = input.completedAt;

      log.dbOperation(this.logger, 'update', 'StrategyAction', {
        id,
        fields: Object.keys(data),
      });

      const result = await this.prisma.strategyAction.update({
        where: { id },
        data,
      });

      const action = this.mapToStrategyAction(result as StrategyActionDbResult);

      log.methodExit(this.logger, 'update', { id });
      return action;
    } catch (error) {
      log.methodError(this.logger, 'update', error as Error, { id });
      throw error;
    }
  }

  // ============================================================================
  // STATUS TRANSITIONS
  // ============================================================================

  /**
   * Mark action as accepted (strategy will process it)
   */
  async accept(id: string): Promise<StrategyAction> {
    return this.update(id, {
      status: 'accepted',
      processedAt: new Date(),
    });
  }

  /**
   * Mark action as rejected (invalid state/params)
   */
  async reject(id: string, reason: string): Promise<StrategyAction> {
    return this.update(id, {
      status: 'rejected',
      errorMessage: reason,
      processedAt: new Date(),
      completedAt: new Date(),
    });
  }

  /**
   * Mark action as executing (effects in flight)
   */
  async markExecuting(id: string): Promise<StrategyAction> {
    return this.update(id, { status: 'executing' });
  }

  /**
   * Mark action as finished (success)
   */
  async markFinished(id: string, result: unknown): Promise<StrategyAction> {
    return this.update(id, {
      status: 'finished',
      result,
      completedAt: new Date(),
    });
  }

  /**
   * Mark action as errored (failure during execution)
   */
  async markErrored(id: string, error: string): Promise<StrategyAction> {
    return this.update(id, {
      status: 'errored',
      errorMessage: error,
      completedAt: new Date(),
    });
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Map database result to StrategyAction type
   */
  protected mapToStrategyAction(
    dbResult: StrategyActionDbResult
  ): StrategyAction {
    return {
      actionId: dbResult.id,
      strategyId: dbResult.strategyId,
      userId: dbResult.userId,
      actionType: dbResult.actionType as StrategyActionType,
      payload: dbResult.payload,
      intentSignature: dbResult.intentSignature,
      intentPayload: dbResult.intentPayload,
      status: dbResult.status as StrategyActionStatus,
      errorMessage: dbResult.errorMessage,
      result: dbResult.result,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
    };
  }
}
