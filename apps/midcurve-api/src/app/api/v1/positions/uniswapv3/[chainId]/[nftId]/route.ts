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
  EvmConfig,
  UniswapV3LedgerService,
  getPositionManagerAddress,
} from '@midcurve/services';
import type {
  UniswapV3PositionConfigData,
  UniswapV3PositionState,
  UniswapV3LedgerEventState,
} from '@midcurve/shared';
import { normalizeAddress } from '@midcurve/shared';
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
  getUniswapV3PoolService,
  getCloseOrderService,
} from '@/lib/services';
import type {
  GetUniswapV3PositionResponse,
  DeleteUniswapV3PositionResponse,
  CreateUniswapV3PositionData,
} from '@midcurve/api-shared';

/** Zero address constant for default operator */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

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

        // 3b. Fetch active close orders for this position
        const activeCloseOrders = await getCloseOrderService().findByPositionId(
          position.id,
          { automationState: ['monitoring', 'executing', 'retrying'] },
          tx
        );

        return { position, activeCloseOrders };
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

      const { position, activeCloseOrders } = result;

      apiLog.businessOperation(apiLogger, requestId, 'fetched', 'position', position.id, {
        chainId,
        nftId,
        pool: `${position.pool.token0.symbol}/${position.pool.token1.symbol}`,
      });

      // 4. Serialize bigints to strings for JSON
      const serializedPosition: GetUniswapV3PositionResponse = {
        ...serializeUniswapV3Position(position),
        activeCloseOrders: activeCloseOrders.map(serializeCloseOrder),
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

      const {
        poolAddress,
        tickUpper,
        tickLower,
        ownerAddress,
        isToken0Quote,
        liquidity,
        mintTxHash,
      } = bodyValidation.data;

      apiLog.businessOperation(apiLogger, requestId, 'create', 'position', `${chainId}/${nftId}`, {
        chainId,
        nftId,
        poolAddress,
        userId: user.id,
      });

      // 3. Execute within a database transaction
      const position = await prisma.$transaction(async (tx) => {
        // 3a. Discover pool (should hit cache, lightweight)
        const pool = await getUniswapV3PoolService().discover(
          { poolAddress, chainId },
          tx
        );

        // 3b. Build config object
        const config: UniswapV3PositionConfigData = {
          chainId,
          nftId,
          poolAddress: normalizeAddress(poolAddress),
          tickUpper,
          tickLower,
        };

        // 3c. Build state with defaults for new position
        const state: UniswapV3PositionState = {
          ownerAddress: normalizeAddress(ownerAddress),
          operator: ZERO_ADDRESS,
          liquidity: BigInt(liquidity),
          feeGrowthInside0LastX128: 0n,
          feeGrowthInside1LastX128: 0n,
          tokensOwed0: 0n,
          tokensOwed1: 0n,
          unclaimedFees0: 0n,
          unclaimedFees1: 0n,
          tickLowerFeeGrowthOutside0X128: 0n,
          tickLowerFeeGrowthOutside1X128: 0n,
          tickUpperFeeGrowthOutside0X128: 0n,
          tickUpperFeeGrowthOutside1X128: 0n,
          isBurned: false,
          isClosed: false,
        };

        // 3d. Serialize config and state for database storage
        const configDB = {
          chainId: config.chainId,
          nftId: config.nftId,
          poolAddress: config.poolAddress,
          tickUpper: config.tickUpper,
          tickLower: config.tickLower,
        };

        const stateDB = {
          ownerAddress: state.ownerAddress,
          operator: state.operator,
          liquidity: state.liquidity.toString(),
          feeGrowthInside0LastX128: state.feeGrowthInside0LastX128.toString(),
          feeGrowthInside1LastX128: state.feeGrowthInside1LastX128.toString(),
          tokensOwed0: state.tokensOwed0.toString(),
          tokensOwed1: state.tokensOwed1.toString(),
          unclaimedFees0: state.unclaimedFees0.toString(),
          unclaimedFees1: state.unclaimedFees1.toString(),
          tickLowerFeeGrowthOutside0X128: state.tickLowerFeeGrowthOutside0X128.toString(),
          tickLowerFeeGrowthOutside1X128: state.tickLowerFeeGrowthOutside1X128.toString(),
          tickUpperFeeGrowthOutside0X128: state.tickUpperFeeGrowthOutside0X128.toString(),
          tickUpperFeeGrowthOutside1X128: state.tickUpperFeeGrowthOutside1X128.toString(),
          isBurned: state.isBurned,
          isClosed: state.isClosed,
        };

        // 3e. Create position via service
        const createdPosition = await getUniswapV3PositionService().create(
          {
            protocol: 'uniswapv3',
            userId: user.id,
            poolId: pool.id,
            isToken0Quote,
            config,
            state,
          },
          configDB,
          stateDB,
          tx
        );

        // 3f. Emit position.created event (INSIDE transaction via outbox pattern)
        const eventPublisher = getDomainEventPublisher();
        await eventPublisher.createAndPublish(
          {
            type: 'position.created',
            entityId: createdPosition.id,
            entityType: 'position',
            userId: user.id,
            payload: createdPosition.toJSON(),
            source: 'api',
            traceId: requestId,
          },
          tx
        );

        return createdPosition;
      });

      // 4. Create MINT lifecycle ledger event (fire-and-forget, non-fatal)
      if (mintTxHash) {
        try {
          const evmConfig = EvmConfig.getInstance();
          const client = evmConfig.getPublicClient(chainId);

          const receipt = await client.getTransactionReceipt({
            hash: mintTxHash as `0x${string}`,
          });

          // Find the ERC-721 Transfer event from NFPM (from=0x0 means mint)
          const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
          const nftIdHex = '0x' + BigInt(nftId).toString(16).padStart(64, '0');
          const nfpmAddress = getPositionManagerAddress(chainId);

          const transferLog = receipt.logs.find(l =>
            l.address.toLowerCase() === nfpmAddress.toLowerCase() &&
            l.topics[0] === TRANSFER_TOPIC &&
            l.topics[3]?.toLowerCase() === nftIdHex.toLowerCase()
          );

          if (transferLog) {
            const block = await client.getBlock({ blockNumber: receipt.blockNumber });

            const ledgerService = new UniswapV3LedgerService({ positionId: position.id });
            await ledgerService.createLifecycleEvent({
              chainId,
              nftId: BigInt(nftId),
              blockNumber: receipt.blockNumber,
              txIndex: transferLog.transactionIndex,
              logIndex: transferLog.logIndex,
              txHash: receipt.transactionHash,
              blockHash: receipt.blockHash,
              timestamp: new Date(Number(block.timestamp) * 1000),
              sqrtPriceX96: 0n,
              state: {
                eventType: 'MINT',
                tokenId: BigInt(nftId),
                to: normalizeAddress(ownerAddress),
              } as UniswapV3LedgerEventState,
            });

            apiLog.businessOperation(apiLogger, requestId, 'created', 'mint-lifecycle-event', position.id, {
              chainId,
              nftId,
              mintTxHash,
            });
          }
        } catch (error) {
          // Non-fatal: position was created, lifecycle event can be backfilled
          apiLogger.warn({
            requestId,
            mintTxHash,
            error: error instanceof Error ? error.message : String(error),
            msg: 'Failed to create MINT lifecycle event from receipt',
          });
        }
      }

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

