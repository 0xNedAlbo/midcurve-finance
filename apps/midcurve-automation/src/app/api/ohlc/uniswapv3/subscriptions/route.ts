/**
 * Uniswap V3 OHLC Subscription Management Endpoints
 *
 * Manages WebSocket subscriptions to Uniswap V3 pool Swap events
 * for OHLC data collection.
 *
 * GET  - List active subscriptions
 * POST - Subscribe to a pool
 * DELETE - Unsubscribe from a pool
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkerManager } from '../../../../../workers';
import { isSupportedChain } from '../../../../../lib/config';
import { isWebSocketAvailable } from '../../../../../lib/evm-websocket';
import { getCloseOrderService } from '../../../../../lib/services';
import { automationLogger } from '../../../../../lib/logger';

const log = automationLogger.child({ component: 'OhlcSubscriptionsAPI' });

// =============================================================================
// Types
// =============================================================================

interface PoolSubscription {
  chainId: number;
  poolAddress: string;
}

interface ListSubscriptionsResponse {
  success: true;
  data: {
    subscriptions: PoolSubscription[];
    count: number;
    countByChain: Record<number, number>;
  };
}

interface SubscribeRequest {
  chainId: number;
  poolAddress: string;
}

interface SubscribeResponse {
  success: true;
  data: {
    chainId: number;
    poolAddress: string;
    subscribed: boolean;
  };
}

interface UnsubscribeRequest {
  chainId: number;
  poolAddress: string;
}

interface UnsubscribeResponse {
  success: true;
  data: {
    chainId: number;
    poolAddress: string;
    unsubscribed: boolean;
    reason?: 'ACTIVE_ORDERS_EXIST';
    activeOrderCount?: number;
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
 * GET /api/ohlc/uniswapv3/subscriptions
 *
 * List all active OHLC subscriptions
 */
export async function GET(): Promise<NextResponse<ListSubscriptionsResponse>> {
  const workerManager = getWorkerManager();
  const ohlcWorker = workerManager.getUniswapV3OhlcWorker();

  if (!ohlcWorker) {
    return NextResponse.json({
      success: true,
      data: {
        subscriptions: [],
        count: 0,
        countByChain: {},
      },
    });
  }

  const subscriptions = ohlcWorker.getSubscribedPools();
  const countByChain = ohlcWorker.getSubscriptionCounts();

  return NextResponse.json({
    success: true,
    data: {
      subscriptions,
      count: subscriptions.length,
      countByChain,
    },
  });
}

/**
 * POST /api/ohlc/uniswapv3/subscriptions
 *
 * Subscribe to a pool's Swap events for OHLC data collection
 *
 * Body: { chainId: number, poolAddress: string }
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<SubscribeResponse | ErrorResponse>> {
  let body: SubscribeRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        },
      },
      { status: 400 }
    );
  }

  // Validate request body
  const { chainId, poolAddress } = body;

  if (typeof chainId !== 'number' || !Number.isInteger(chainId)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_CHAIN_ID',
          message: 'chainId must be an integer',
        },
      },
      { status: 400 }
    );
  }

  if (typeof poolAddress !== 'string' || !poolAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_POOL_ADDRESS',
          message: 'poolAddress must be a valid Ethereum address',
        },
      },
      { status: 400 }
    );
  }

  // Check if chain is supported
  if (!isSupportedChain(chainId)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'UNSUPPORTED_CHAIN',
          message: `Chain ${chainId} is not supported`,
        },
      },
      { status: 400 }
    );
  }

  // Check if WebSocket is available for chain
  if (!isWebSocketAvailable(chainId)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'WEBSOCKET_UNAVAILABLE',
          message: `WebSocket RPC not configured for chain ${chainId}`,
        },
      },
      { status: 400 }
    );
  }

  // Get worker
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

  // Subscribe to pool
  const subscribed = await ohlcWorker.subscribePool(chainId, poolAddress.toLowerCase());

  return NextResponse.json({
    success: true,
    data: {
      chainId,
      poolAddress: poolAddress.toLowerCase(),
      subscribed,
    },
  });
}

/**
 * DELETE /api/ohlc/uniswapv3/subscriptions
 *
 * Unsubscribe from a pool's Swap events
 *
 * Body: { chainId: number, poolAddress: string }
 */
export async function DELETE(
  request: NextRequest
): Promise<NextResponse<UnsubscribeResponse | ErrorResponse>> {
  let body: UnsubscribeRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        },
      },
      { status: 400 }
    );
  }

  // Validate request body
  const { chainId, poolAddress } = body;

  if (typeof chainId !== 'number' || !Number.isInteger(chainId)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_CHAIN_ID',
          message: 'chainId must be an integer',
        },
      },
      { status: 400 }
    );
  }

  if (typeof poolAddress !== 'string' || !poolAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_POOL_ADDRESS',
          message: 'poolAddress must be a valid Ethereum address',
        },
      },
      { status: 400 }
    );
  }

  // Get worker
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

  // Check if there are remaining active orders for this pool
  // If so, keep the subscription active
  const closeOrderService = getCloseOrderService();
  const remainingOrders = await closeOrderService.findActiveOrdersForPool(
    poolAddress.toLowerCase()
  );

  if (remainingOrders.length > 0) {
    log.info({
      chainId,
      poolAddress: poolAddress.toLowerCase(),
      activeOrderCount: remainingOrders.length,
      msg: 'Keeping OHLC subscription - active orders still exist for pool',
    });

    return NextResponse.json({
      success: true,
      data: {
        chainId,
        poolAddress: poolAddress.toLowerCase(),
        unsubscribed: false,
        reason: 'ACTIVE_ORDERS_EXIST',
        activeOrderCount: remainingOrders.length,
      },
    });
  }

  // No remaining orders - safe to unsubscribe
  await ohlcWorker.unsubscribePool(chainId, poolAddress.toLowerCase());

  log.info({
    chainId,
    poolAddress: poolAddress.toLowerCase(),
    msg: 'Unsubscribed from OHLC - no more active orders for pool',
  });

  return NextResponse.json({
    success: true,
    data: {
      chainId,
      poolAddress: poolAddress.toLowerCase(),
      unsubscribed: true,
    },
  });
}
