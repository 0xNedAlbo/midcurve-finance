/**
 * OHLC Subscription Sync Endpoint
 *
 * Manually syncs OHLC subscriptions with pools that have active orders.
 * This is useful for triggering an immediate sync without waiting for
 * the automatic periodic sync in OhlcTriggerConsumer.
 *
 * POST - Sync subscriptions with active order pools
 */

import { NextResponse } from 'next/server';
import { getWorkerManager } from '../../../../../../workers';
import { getCloseOrderService } from '../../../../../../lib/services';
import { automationLogger, autoLog } from '../../../../../../lib/logger';

const log = automationLogger.child({ component: 'OhlcSubscriptionSyncAPI' });

// =============================================================================
// Types
// =============================================================================

interface SyncResponse {
  success: true;
  data: {
    poolsWithActiveOrders: number;
    newSubscriptions: number;
    alreadySubscribed: number;
    failed: number;
    totalSubscribed: number;
  };
}

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * POST /api/ohlc/uniswapv3/subscriptions/sync
 *
 * Sync OHLC subscriptions with pools that have active orders
 */
export async function POST(): Promise<NextResponse<SyncResponse | ErrorResponse>> {
  autoLog.methodEntry(log, 'sync');

  // Get OHLC worker
  const workerManager = getWorkerManager();
  const ohlcWorker = workerManager.getUniswapV3OhlcWorker();

  if (!ohlcWorker) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'WORKER_NOT_RUNNING',
          message: 'OHLC worker is not running',
        },
      },
      { status: 503 }
    );
  }

  try {
    // Get pools with active orders
    const closeOrderService = getCloseOrderService();
    const pools = await closeOrderService.getPoolsWithActiveOrders();

    // Get currently subscribed pools
    const currentSubscriptions = ohlcWorker.getSubscribedPools();
    const subscribedSet = new Set(
      currentSubscriptions.map((p) => `${p.chainId}-${p.poolAddress.toLowerCase()}`)
    );

    // Subscribe to pools that have active orders but are not subscribed
    let newSubscriptions = 0;
    let alreadySubscribed = 0;
    let failed = 0;

    for (const pool of pools) {
      const key = `${pool.chainId}-${pool.poolAddress.toLowerCase()}`;

      if (subscribedSet.has(key)) {
        alreadySubscribed++;
        continue;
      }

      try {
        const success = await ohlcWorker.subscribePool(pool.chainId, pool.poolAddress);
        if (success) {
          newSubscriptions++;
          log.info({
            chainId: pool.chainId,
            poolAddress: pool.poolAddress,
            msg: 'Subscribed pool via sync API',
          });
        } else {
          failed++;
          log.warn({
            chainId: pool.chainId,
            poolAddress: pool.poolAddress,
            msg: 'Failed to subscribe pool',
          });
        }
      } catch (err) {
        failed++;
        log.error({
          chainId: pool.chainId,
          poolAddress: pool.poolAddress,
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error subscribing pool',
        });
      }
    }

    const totalSubscribed = ohlcWorker.getStatus().poolsSubscribed;

    log.info({
      poolsWithActiveOrders: pools.length,
      newSubscriptions,
      alreadySubscribed,
      failed,
      totalSubscribed,
      msg: 'OHLC subscription sync complete',
    });

    autoLog.methodExit(log, 'sync');

    return NextResponse.json({
      success: true,
      data: {
        poolsWithActiveOrders: pools.length,
        newSubscriptions,
        alreadySubscribed,
        failed,
        totalSubscribed,
      },
    });
  } catch (err) {
    autoLog.methodError(log, 'sync', err);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SYNC_FAILED',
          message: err instanceof Error ? err.message : 'Failed to sync subscriptions',
        },
      },
      { status: 500 }
    );
  }
}
