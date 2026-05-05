/**
 * UniswapV3 Staking Vault Position Endpoint
 *
 * GET    /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress
 * DELETE /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress
 *
 * Vaults are owner-bound 1:1 (per SPEC-0003b §2), so the vault address alone
 * disambiguates — no separate `ownerAddress` segment.
 *
 * Authentication: Required (session or API key).
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

export async function OPTIONS(request: NextRequest): Promise<Response> {
    return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(
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

            apiLog.businessOperation(
                apiLogger, requestId, 'lookup', 'staking-vault-position',
                positionHash, { chainId, vaultAddress, userId: user.id },
            );

            const result = await prisma.$transaction(async (tx) => {
                const position = await getUniswapV3StakingPositionService().findByPositionHash(
                    user.id, positionHash, tx,
                );
                if (!position) return null;

                const ownerWalletRow = await tx.position.findUnique({
                    where: { id: position.id },
                    select: { ownerWallet: true },
                });

                return { position, ownerWallet: ownerWalletRow?.ownerWallet ?? null };
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

            const serializedPosition: GetUniswapV3StakingPositionResponse = {
                ...serializeUniswapV3StakingPosition(result.position),
                ownerWallet: result.ownerWallet,
            };

            const response = createSuccessResponse(serializedPosition);
            apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
            return NextResponse.json(response, { status: 200 });
        } catch (error) {
            apiLog.methodError(
                apiLogger,
                'GET /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress',
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
                'Failed to fetch staking-vault position',
                error instanceof Error ? error.message : String(error),
            );
            apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
                status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
            });
        }
    });
}

export async function DELETE(
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

            const dbPosition = await getUniswapV3StakingPositionService().findByPositionHash(
                user.id, positionHash,
            );

            if (!dbPosition) {
                // Idempotent — 200 with empty body on missing.
                const response = createSuccessResponse({});
                apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
                return NextResponse.json(response, { status: 200 });
            }

            await getUniswapV3StakingPositionService().delete(dbPosition.id);

            const response = createSuccessResponse({});
            apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
            return NextResponse.json(response, { status: 200 });
        } catch (error) {
            apiLog.methodError(
                apiLogger,
                'DELETE /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress',
                error,
                { requestId },
            );

            const errorResponse = createErrorResponse(
                ApiErrorCode.INTERNAL_SERVER_ERROR,
                'Failed to delete staking-vault position',
                error instanceof Error ? error.message : String(error),
            );
            apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
                status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
            });
        }
    });
}
