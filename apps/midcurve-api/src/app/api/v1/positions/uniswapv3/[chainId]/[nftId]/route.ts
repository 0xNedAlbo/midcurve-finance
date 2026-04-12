/**
 * Specific Uniswap V3 Position Endpoint
 *
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId
 * PUT /api/v1/positions/uniswapv3/:chainId/:nftId
 * DELETE /api/v1/positions/uniswapv3/:chainId/:nftId
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  getDomainEventPublisher,
  type PositionLifecyclePayload,
} from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import {
  GetUniswapV3PositionParamsSchema,
  DeleteUniswapV3PositionParamsSchema,
  CreateUniswapV3PositionParamsSchema,
  CreateUniswapV3PositionRequestSchema,
} from '@midcurve/api-shared';
import { serializeUniswapV3Position, serializeCloseOrder } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  getUniswapV3PositionService,
  getUniswapV3CloseOrderService,
} from '@/lib/services';
import type {
  GetUniswapV3PositionResponse,
  DeleteUniswapV3PositionResponse,
  CreateUniswapV3PositionData,
} from '@midcurve/api-shared';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId
 *
 * Fetch a specific Uniswap V3 position owned by the authenticated user
 * from the database. Does NOT refresh on-chain data — use
 * POST /api/v1/positions/uniswapv3/:chainId/:nftId/refresh for that.
 *
 * Features:
 * - Looks up position by user ID + chain ID + NFT ID
 * - Returns complete position data with nested pool and token details
 * - Ensures users can only access their own positions
 * - Uses a database transaction for consistent reads
 *
 * Path parameters:
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID
 *
 * Returns: Full position object with last-known state from database
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const validation = GetUniswapV3PositionParamsSchema.safeParse(resolvedParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId } = validation.data;

      // 2. Generate position hash for lookup
      // Format: "uniswapv3/{chainId}/{nftId}"
      const positionHash = `uniswapv3/${chainId}/${nftId}`;

      apiLog.businessOperation(apiLogger, requestId, 'lookup', 'position', positionHash, {
        chainId,
        nftId,
        userId: user.id,
      });

      // 3. Execute lookup within a transaction for consistent reads
      const result = await prisma.$transaction(async (tx) => {
        // 3a. Fast indexed lookup by positionHash
        const position = await getUniswapV3PositionService().findByPositionHash(
          user.id,
          positionHash,
          tx
        );

        if (!position) {
          return null;
        }

        apiLog.businessOperation(apiLogger, requestId, 'fetch', 'position', position.id, {
          chainId,
          nftId,
          positionHash,
        });

        // 3b. Fetch all close orders for this position
        const closeOrders = await getUniswapV3CloseOrderService().findByPositionId(
          position.id,
          {},
          tx
        );

        // 3c. Fetch ownerWallet from DB (not on domain object)
        const ownerWalletRow = await tx.position.findUnique({
          where: { id: position.id },
          select: { ownerWallet: true },
        });

        return { position, closeOrders, ownerWallet: ownerWalletRow?.ownerWallet ?? null };
      });

      // Handle position not found (outside transaction)
      if (!result) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Position not found',
          `No Uniswap V3 position found for chainId ${chainId} and nftId ${nftId}`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      const { position, closeOrders, ownerWallet } = result;

      apiLog.businessOperation(apiLogger, requestId, 'fetched', 'position', position.id, {
        chainId,
        nftId,
        pool: `${position.pool.token0.symbol}/${position.pool.token1.symbol}`,
      });

      // 4. Serialize bigints to strings for JSON
      const serializedPosition: GetUniswapV3PositionResponse = {
        ...serializeUniswapV3Position(position),
        ownerWallet,
        closeOrders: closeOrders.map(serializeCloseOrder),
      };

      const response = createSuccessResponse(serializedPosition);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3/:chainId/:nftId',
        error,
        { requestId }
      );

      // Map service errors to API error codes
      if (error instanceof Error) {
        // Position not found
        if (
          error.message.includes('not found') ||
          error.message.includes('does not exist')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.POSITION_NOT_FOUND,
            'Position not found',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
          });
        }
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to fetch position',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

/**
 * DELETE /api/v1/positions/uniswapv3/:chainId/:nftId
 *
 * Delete a specific Uniswap V3 position owned by the authenticated user.
 *
 * Features:
 * - Idempotent: Returns success even if position doesn't exist
 * - Uses positionHash for fast indexed lookup
 * - Verifies user ownership before deletion
 * - Only deletes positions belonging to the authenticated user
 *
 * Path parameters:
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID (positive integer)
 *
 * Returns: Empty success response
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": {},
 *   "meta": { "requestId": "...", "timestamp": "..." }
 * }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const validation = DeleteUniswapV3PositionParamsSchema.safeParse(resolvedParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId } = validation.data;

      // 2. Generate position hash and look up position
      // Format: "uniswapv3/{chainId}/{nftId}"
      const positionHash = `uniswapv3/${chainId}/${nftId}`;

      apiLog.businessOperation(apiLogger, requestId, 'lookup', 'position', positionHash, {
        chainId,
        nftId,
        userId: user.id,
      });

      // Fast indexed lookup by positionHash
      const dbPosition = await getUniswapV3PositionService().findByPositionHash(user.id, positionHash);

      // Idempotent: If position doesn't exist, consider it already deleted
      if (!dbPosition) {
        apiLog.businessOperation(
          apiLogger,
          requestId,
          'delete-idempotent',
          'position',
          positionHash,
          {
            chainId,
            nftId,
            userId: user.id,
            reason: 'Position not found (already deleted or never existed)',
          }
        );

        const response = createSuccessResponse<DeleteUniswapV3PositionResponse>({});

        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

        return NextResponse.json(response, { status: 200 });
      }

      apiLog.businessOperation(apiLogger, requestId, 'delete', 'position', dbPosition.id, {
        chainId,
        nftId,
        positionHash,
      });

      // 3. Delete the position
      // Service handles protocol verification and deletion
      await getUniswapV3PositionService().delete(dbPosition.id);

      apiLog.businessOperation(apiLogger, requestId, 'deleted', 'position', dbPosition.id, {
        chainId,
        nftId,
        positionHash,
      });

      const response = createSuccessResponse<DeleteUniswapV3PositionResponse>({});

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'DELETE /api/v1/positions/uniswapv3/:chainId/:nftId',
        error,
        { requestId }
      );

      // Map service errors to API error codes
      if (error instanceof Error) {
        // Protocol mismatch (shouldn't happen with positionHash lookup, but defensive)
        if (error.message.includes('expected protocol')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.INTERNAL_SERVER_ERROR,
            'Position protocol mismatch',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
          });
        }
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to delete position',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

/**
 * PUT /api/v1/positions/uniswapv3/:chainId/:nftId
 *
 * Create a Uniswap V3 position record after the user mints a position on-chain.
 *
 * **Flow:**
 * 1. Validate request (path params + body)
 * 2. Discover pool (should be cached from UI's earlier discovery)
 * 3. Build position config and state with defaults
 * 4. Create position in database within a transaction
 * 5. Emit position.created domain event (via outbox pattern)
 * 6. Return created position
 *
 * **Features:**
 * - Idempotent: Returns existing position if already created
 * - Transactional: Pool discovery + position creation + event emission are atomic
 * - Event-driven: position.created triggers business rules for ledger sync
 *
 * **Path Parameters:**
 * - chainId: EVM chain ID (e.g., 1 = Ethereum, 42161 = Arbitrum, etc.)
 * - nftId: Uniswap V3 NFT token ID (positive integer)
 *
 * **Request Body:**
 * ```json
 * {
 *   "poolAddress": "0x...",
 *   "tickUpper": 201120,
 *   "tickLower": 199120,
 *   "ownerAddress": "0x...",
 *   "isToken0Quote": true,
 *   "liquidity": "1000000000000000000"
 * }
 * ```
 *
 * **Returns:** Full position object with default values
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; nftId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate path parameters
      const resolvedParams = await params;
      const paramsValidation = CreateUniswapV3PositionParamsSchema.safeParse(resolvedParams);

      if (!paramsValidation.success) {
        apiLog.validationError(apiLogger, requestId, paramsValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          paramsValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, nftId } = paramsValidation.data;

      // 2. Parse and validate request body
      const body = await request.json();
      const bodyValidation = CreateUniswapV3PositionRequestSchema.safeParse(body);

      if (!bodyValidation.success) {
        apiLog.validationError(apiLogger, requestId, bodyValidation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          bodyValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { quoteTokenAddress } = bodyValidation.data;

      apiLog.businessOperation(apiLogger, requestId, 'create', 'position', `${chainId}/${nftId}`, {
        chainId,
        nftId,
        userId: user.id,
      });

      // 3. Discover position from chain (creates if new, refreshes if existing).
      // Handles full ledger import + on-chain state read internally.
      const position = await getUniswapV3PositionService().discover(user.id, {
        chainId,
        nftId,
        quoteTokenAddress,
      });

      // 4. Emit position.created domain event
      const eventPublisher = getDomainEventPublisher();
      await eventPublisher.createAndPublish<PositionLifecyclePayload>({
        type: 'position.created',
        entityId: position.id,
        entityType: 'position',
        userId: user.id,
        payload: {
          positionId: position.id,
          positionHash: position.positionHash,
        },
        source: 'api',
        traceId: requestId,
      });

      // 5. Log position creation
      apiLog.businessOperation(apiLogger, requestId, 'created', 'position', position.id, {
        chainId,
        nftId,
        pool: `${position.pool.token0.symbol}/${position.pool.token1.symbol}`,
        quoteToken: position.isToken0Quote
          ? position.pool.token0.symbol
          : position.pool.token1.symbol,
        currentValue: position.currentValue.toString(),
      });

      // 6. Serialize bigints to strings for JSON
      const serializedPosition = serializeUniswapV3Position(position) as CreateUniswapV3PositionData;

      const response = createSuccessResponse(serializedPosition);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'PUT /api/v1/positions/uniswapv3/:chainId/:nftId',
        error,
        { requestId }
      );

      // Map service errors to API error codes
      if (error instanceof Error) {
        // Invalid address format
        if (error.message.includes('Invalid') && error.message.includes('address')) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.INVALID_ADDRESS,
            'Invalid address format',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.INVALID_ADDRESS],
          });
        }

        // Chain not supported
        if (
          error.message.includes('not configured') ||
          error.message.includes('not supported')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.CHAIN_NOT_SUPPORTED,
            'Chain not supported',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
          });
        }

        // Pool not found
        if (
          error.message.includes('Pool not found') ||
          error.message.includes('pool')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.POOL_NOT_FOUND,
            'Pool not found',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.POOL_NOT_FOUND],
          });
        }

        // On-chain read failures (RPC errors, contract errors)
        if (
          error.message.includes('Failed to read') ||
          error.message.includes('contract') ||
          error.message.includes('RPC')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.BAD_REQUEST,
            'Failed to fetch data from blockchain',
            error.message
          );
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
          });
        }
      }

      // Generic error
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to create position',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

