/**
 * Position Closed Order Canceller Consumer
 *
 * Listens for position.closed events and automatically cancels any active
 * close orders for that position. This decouples order cancellation from
 * the ledger sync process.
 */

import { PrismaClient } from '@midcurve/database';
import { DomainEventConsumer } from '../consumer.js';
import { DOMAIN_QUEUES, ROUTING_PATTERNS } from '../topology.js';
import type { DomainEvent, PositionClosedPayload } from '../types.js';
import { CloseOrderService } from '../../services/automation/close-order-service.js';
import { PoolSubscriptionService } from '../../services/automation/pool-subscription-service.js';

// ============================================================
// Consumer Implementation
// ============================================================

/**
 * Dependencies for PositionClosedOrderCanceller
 */
export interface PositionClosedOrderCancellerDependencies {
  prisma?: PrismaClient;
}

/**
 * Position Closed Order Canceller
 *
 * Subscribes to `position.*.closed` events and cancels any active close orders
 * for the position. This replaces the direct function call in ledger-sync.ts
 * with an event-driven approach.
 *
 * **Idempotency**: This handler is idempotent because:
 * 1. Cancelling an already-cancelled order is a no-op (CloseOrderService handles this)
 * 2. Multiple cancellation attempts for the same order don't cause issues
 *
 * **Error Handling**: If cancellation fails for one order, we continue
 * attempting to cancel the remaining orders. Partial success is acceptable.
 */
export class PositionClosedOrderCanceller extends DomainEventConsumer<PositionClosedPayload> {
  readonly eventPattern = ROUTING_PATTERNS.POSITION_CLOSED;
  readonly queueName = DOMAIN_QUEUES.POSITION_CLOSED_ORDER_CANCELLER;

  private readonly prisma: PrismaClient;
  private readonly closeOrderService: CloseOrderService;
  private readonly poolSubscriptionService: PoolSubscriptionService;

  constructor(deps: PositionClosedOrderCancellerDependencies = {}) {
    super();
    this.prisma = deps.prisma ?? new PrismaClient();
    this.closeOrderService = new CloseOrderService({ prisma: this.prisma });
    this.poolSubscriptionService = new PoolSubscriptionService({ prisma: this.prisma });
  }

  /**
   * Handle a position.closed event by cancelling all active close orders.
   */
  async handle(event: DomainEvent<PositionClosedPayload>): Promise<void> {
    const positionId = event.payload.id;

    this.logger.info(
      {
        eventId: event.id,
        positionId,
        eventType: event.type,
      },
      'Processing position.closed event'
    );

    // Find active orders for this position (non-terminal statuses)
    const activeOrders = await this.closeOrderService.findByPositionId(positionId, {
      status: ['pending', 'active', 'registering', 'triggering'],
    });

    if (activeOrders.length === 0) {
      this.logger.debug({ positionId }, 'No active close orders to cancel');
      return;
    }

    this.logger.info(
      { positionId, orderCount: activeOrders.length },
      'Cancelling active close orders for closed position'
    );

    // Get poolId for subscription management
    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
      select: { poolId: true },
    });

    // Track results
    let cancelledCount = 0;
    let failedCount = 0;

    // Cancel each order and decrement pool subscription counts
    for (const order of activeOrders) {
      try {
        await this.closeOrderService.cancel(order.id);

        // Decrement pool subscription order count
        if (position?.poolId) {
          await this.poolSubscriptionService.decrementOrderCount(position.poolId);
        }

        this.logger.info(
          { positionId, orderId: order.id },
          'Cancelled close order due to position closure'
        );

        cancelledCount++;
      } catch (error) {
        // Log but continue - order may already be cancelled
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          { positionId, orderId: order.id, error: errorMessage },
          'Failed to cancel close order (may already be in terminal state)'
        );
        failedCount++;
      }
    }

    this.logger.info(
      {
        eventId: event.id,
        positionId,
        totalOrders: activeOrders.length,
        cancelled: cancelledCount,
        failed: failedCount,
      },
      'Completed order cancellation for closed position'
    );
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a new PositionClosedOrderCanceller instance.
 *
 * @param deps - Optional dependencies
 * @returns Configured consumer instance
 */
export function createPositionClosedOrderCanceller(
  deps?: PositionClosedOrderCancellerDependencies
): PositionClosedOrderCanceller {
  return new PositionClosedOrderCanceller(deps);
}
