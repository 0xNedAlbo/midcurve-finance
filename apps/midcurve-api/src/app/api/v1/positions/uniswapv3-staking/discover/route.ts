/**
 * Staking Vault Position Discovery Endpoint
 *
 * POST /api/v1/positions/uniswapv3-staking/discover
 *
 * Imports a single UniswapV3StakingVault position by `(chainId, vaultAddress)`.
 * The vault is owner-bound 1:1 (per SPEC-0003b §2), so the owner is derived
 * from `vault.owner()` on chain — no separate `ownerAddress` parameter.
 *
 * Mirrors the Vault `/discover` semantics. After the service creates the
 * Position row + imports the ledger, this route emits `position.created`
 * (matches NFT/Vault convention).
 *
 * Authentication: Required (session or API key).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/middleware/with-auth';
import {
    createSuccessResponse,
    createErrorResponse,
    ApiErrorCode,
    ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import {
    getDomainEventPublisher,
    type PositionLifecyclePayload,
} from '@midcurve/services';
import { getUniswapV3StakingPositionService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DiscoverStakingRequestSchema = z.object({
    chainId: z.number().int().positive(),
    vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function OPTIONS(request: NextRequest): Promise<Response> {
    return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: NextRequest): Promise<Response> {
    return withAuth(request, async (user, requestId) => {
        const startTime = Date.now();

        const body = await request.json();
        const validation = DiscoverStakingRequestSchema.safeParse(body);

        if (!validation.success) {
            apiLog.validationError(apiLogger, requestId, validation.error.errors);
            const errorResponse = createErrorResponse(
                ApiErrorCode.VALIDATION_ERROR,
                'Invalid request data',
                validation.error.errors,
            );
            apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
                status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
            });
        }

        const { chainId, vaultAddress } = validation.data;

        try {
            const position = await getUniswapV3StakingPositionService().discover(user.id, {
                chainId,
                vaultAddress,
            });

            // Emit `position.created` so PR3's journal-posting rule + any other
            // downstream consumers can react. Mirrors the NFT `/import` route.
            const eventPublisher = getDomainEventPublisher();
            await eventPublisher.createAndPublish<PositionLifecyclePayload>({
                type: 'position.created',
                entityType: 'position',
                entityId: position.id,
                userId: position.userId,
                payload: {
                    positionId: position.id,
                    positionHash: position.positionHash,
                },
                source: 'api',
            });

            apiLog.businessOperation(
                apiLogger,
                requestId,
                'discovered',
                'staking-vault-position',
                user.id,
                { chainId, vaultAddress, positionId: position.id },
            );

            const responseData = {
                positionId: position.id,
                positionHash: position.positionHash,
            };
            const response = createSuccessResponse(responseData);
            apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
            return NextResponse.json(response, { status: 200 });
        } catch (error) {
            apiLog.methodError(
                apiLogger,
                'POST /api/v1/positions/uniswapv3-staking/discover',
                error,
                { requestId },
            );

            const message = error instanceof Error ? error.message : String(error);

            // Service throws this when the address isn't a valid staking-vault contract.
            if (message.startsWith('INVALID_VAULT_CONTRACT')) {
                const errorResponse = createErrorResponse(
                    ApiErrorCode.BAD_REQUEST,
                    'Not a valid staking-vault contract',
                    message,
                );
                apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                    status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
                });
            }

            if (message.includes('not configured') || message.includes('not supported')) {
                const errorResponse = createErrorResponse(
                    ApiErrorCode.CHAIN_NOT_SUPPORTED,
                    'Chain not supported',
                    message,
                );
                apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                    status: ErrorCodeToHttpStatus[ApiErrorCode.CHAIN_NOT_SUPPORTED],
                });
            }

            if (
                message.includes('contract') ||
                message.includes('RPC') ||
                message.includes('Failed to read')
            ) {
                const errorResponse = createErrorResponse(
                    ApiErrorCode.BAD_REQUEST,
                    'Failed to read staking-vault data from blockchain',
                    message,
                );
                apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
                return NextResponse.json(errorResponse, {
                    status: ErrorCodeToHttpStatus[ApiErrorCode.BAD_REQUEST],
                });
            }

            const errorResponse = createErrorResponse(
                ApiErrorCode.INTERNAL_SERVER_ERROR,
                'Failed to discover staking-vault position',
                message,
            );
            apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
                status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
            });
        }
    });
}
