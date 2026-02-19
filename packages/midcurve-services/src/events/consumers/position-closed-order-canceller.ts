/**
 * Position Closed Order Canceller Consumer
 *
 * Listens for position.closed events and automatically cancels any active
 * close orders for that position. This decouples order cancellation from
 * the ledger sync process.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import { OnChainOrderStatus } from '@midcurve/shared';
import { DomainEventConsumer } from '../consumer.js';
import { DOMAIN_QUEUES, ROUTING_PATTERNS } from '../topology.js';
import type { DomainEvent, PositionClosedPayload } from '../types.js';
import { CloseOrderService } from '../../services/automation/close-order-service.js';
import { AutomationSubscriptionService } from '../../services/automation/automation-subscription-service.js';

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
 * 1. Cancelling an already-cancelled order is a no-op
 * 2. Multiple cancellation attempts for the same order don't cause issues
 *
 * **Error Handling**: If cancellation fails for one order, we continue
 * attempting to cancel the remaining orders. Partial success is acceptable.
 */
export class PositionClosedOrderCanceller extends DomainEventConsumer<PositionClosedPayload> {
  readonly eventPattern = ROUTING_PATTERNS.POSITION_CLOSED;
  readonly queueName = DOMAIN_QUEUES.POSITION_CLOSED_ORDER_CANCELLER;

  private readonly prisma: PrismaClient;
  private readonly orderService: CloseOrderService;
  private readonly automationSubscriptionService: AutomationSubscriptionService;

  constructor(deps: PositionClosedOrderCancellerDependencies = {}) {
    super();
    this.prisma = deps.prisma ?? prismaClient;
    this.orderService = new CloseOrderService({ prisma: this.prisma });
    this.automationSubscriptionService = new AutomationSubscriptionService({ prisma: this.prisma });
  }

  /**
   * Handle a position.closed event by cancelling all active close orders.
   */
  async handle(event: DomainEvent<PositionClosedPayload>, _routingKey: string): Promise<void> {
    const positionId = event.payload.id;

    this.logger.info(
      {
        eventId: event.id,
        positionId,
        eventType: event.type,
      },
      'Processing position.closed event'
    );

    // Find active orders for this position (ACTIVE on-chain + not idle monitoring)
    const activeOrders = await this.orderService.findByPositionId(positionId, {
      onChainStatus: OnChainOrderStatus.ACTIVE,
      monitoringState: ['monitoring', 'triggered', 'suspended'],
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

    // Cancel each order
    for (const order of activeOrders) {
      try {
        await this.orderService.markOnChainCancelled(order.id);

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

    // Remove pool subscription if no more monitoring orders (single check after all cancellations)
    if (position?.poolId) {
      try {
        await this.automationSubscriptionService.removePoolSubscriptionIfUnused(position.poolId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          { positionId, poolId: position.poolId, error: errorMessage },
          'Failed to check pool subscription usage after cancellations'
        );
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
