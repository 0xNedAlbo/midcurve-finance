/**
 * Staking Vault Position On-Chain Refresh Endpoint
 *
 * POST /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress/refresh
 *
 * Re-reads on-chain state and re-syncs the ledger. NO 15-second updatedAt
 * cache (per PR4 plan refinement #1) — UI calls this after user txs and
 * must see fresh state immediately. The 60s block-keyed RPC cache stays.
 *
 * Authentication: Required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
    createSuccessResponse,
    createErrorResponse,
    ApiErrorCode,
    ErrorCodeToHttpStatus,
    GetUniswapV3StakingPositionParamsSchema,
} from '@midcurve/api-shared';
import { serializeUniswapV3StakingPosition } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getUniswapV3StakingPositionService } from '@/lib/services';
import type { GetUniswapV3StakingPositionResponse } from '@midcurve/api-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function OPTIONS(request: NextRequest): Promise<Response> {
    return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ chainId: string; vaultAddress: string }> },
): Promise<Response> {
    return withAuth(request, async (user, requestId) => {
        const startTime = Date.now();

        try {
            const resolvedParams = await params;
            const validation = GetUniswapV3StakingPositionParamsSchema.safeParse(resolvedParams);

            if (!validation.success) {
                apiLog.validationError(apiLogger, requestId, validation.error.errors);
                const errorResponse = createErrorResponse(
                    ApiErrorCode.VALIDATION_ERROR,
                    'Invalid path parameters',
                    validation.error.errors,
                );
                apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                    status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
                });
            }

            const { chainId, vaultAddress } = validation.data;
            const positionHash = `uniswapv3-staking/${chainId}/${vaultAddress}`;

            const result = await prisma.$transaction(async (tx) => {
                const dbPosition = await getUniswapV3StakingPositionService().findByPositionHash(
                    user.id, positionHash, tx,
                );
                if (!dbPosition) return null;

                const refreshedPosition = await getUniswapV3StakingPositionService().refresh(
                    dbPosition.id, 'latest', tx,
                );
                return refreshedPosition;
            });

            if (!result) {
                const errorResponse = createErrorResponse(
                    ApiErrorCode.POSITION_NOT_FOUND,
                    'Staking-vault position not found',
                    `No staking-vault position found for chainId ${chainId} and vaultAddress ${vaultAddress}`,
                );
                apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                    status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
                });
            }

            const serializedPosition: GetUniswapV3StakingPositionResponse =
                serializeUniswapV3StakingPosition(result);

            const response = createSuccessResponse(serializedPosition);
            apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
            return NextResponse.json(response, { status: 200 });
        } catch (error) {
            apiLog.methodError(
                apiLogger,
                'POST /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress/refresh',
                error,
                { requestId },
            );

            if (error instanceof Error) {
                if (error.message.includes('not found') || error.message.includes('does not exist')) {
                    const errorResponse = createErrorResponse(
                        ApiErrorCode.POSITION_NOT_FOUND,
                        'Position not found',
                        error.message,
                    );
                    apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
                    return NextResponse.json(errorResponse, {
                        status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
                    });
                }
            }

            const errorResponse = createErrorResponse(
                ApiErrorCode.INTERNAL_SERVER_ERROR,
                'Failed to refresh staking-vault position',
                error instanceof Error ? error.message : String(error),
            );
            apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
                status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
            });
        }
    });
}
