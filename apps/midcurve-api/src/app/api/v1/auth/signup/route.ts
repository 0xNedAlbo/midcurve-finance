/**
 * Signup Endpoint
 *
 * POST /api/v1/auth/signup
 *
 * Register a new user with their wallet address.
 * Creates a User record and links the wallet address as primary.
 * No authentication required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@midcurve/database';
import { nanoid } from 'nanoid';
import {
  SignupRequestSchema,
  type SignupResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { getAddress } from 'viem';
import { apiLogger, apiLog } from '@/lib/logger';
import { getCorsHeaders, createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: NextRequest): Promise<NextResponse<SignupResponse>> {
  const requestId = nanoid();
  const startTime = Date.now();
  const origin = request.headers.get('origin');

  apiLog.requestStart(apiLogger, requestId, request);

  try {
    // Parse and validate request body
    const body = await request.json();
    const validationResult = SignupRequestSchema.safeParse(body);

    if (!validationResult.success) {
      apiLog.validationError(apiLogger, requestId, validationResult.error.errors);

      const errorResponse = createErrorResponse(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid request data',
        validationResult.error.errors
      );

      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

      return NextResponse.json(errorResponse as unknown as SignupResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        headers: getCorsHeaders(origin),
      });
    }

    const { address, name } = validationResult.data;

    // Normalize address to EIP-55 checksum format
    const normalizedAddress = getAddress(address);

    // Check if address already exists (chain-agnostic)
    const existingUser = await prisma.user.findUnique({
      where: { address: normalizedAddress },
    });

    if (existingUser) {
      apiLog.businessOperation(apiLogger, requestId, 'rejected', 'signup', 'wallet_exists', {
        reason: 'wallet_already_registered',
        address: normalizedAddress.slice(0, 10) + '...',
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.WALLET_ALREADY_REGISTERED,
        'This wallet address is already registered'
      );

      apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

      return NextResponse.json(errorResponse as unknown as SignupResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.WALLET_ALREADY_REGISTERED],
        headers: getCorsHeaders(origin),
      });
    }

    // Create user with address
    const user = await prisma.user.create({
      data: {
        name: name || `${normalizedAddress.slice(0, 6)}...${normalizedAddress.slice(-4)}`,
        address: normalizedAddress,
      },
    });

    apiLog.businessOperation(apiLogger, requestId, 'created', 'user', user.id, {
      address: normalizedAddress.slice(0, 10) + '...',
    });

    // Format response
    const response: SignupResponse = {
      user: {
        id: user.id,
        address: user.address,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    };

    apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);

    return NextResponse.json(response, {
      status: 201,
      headers: getCorsHeaders(origin),
    });
  } catch (error) {
    apiLog.methodError(apiLogger, 'POST /api/v1/auth/signup', error, { requestId });

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to create user account',
      error instanceof Error ? error.message : String(error)
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    return NextResponse.json(errorResponse as unknown as SignupResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      headers: getCorsHeaders(origin),
    });
  }
}
