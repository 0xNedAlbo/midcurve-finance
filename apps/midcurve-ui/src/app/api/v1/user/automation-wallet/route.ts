/**
 * Automation Wallet Management Endpoints
 *
 * GET  /api/v1/user/automation-wallet - Get user's automation wallet (or null)
 * POST /api/v1/user/automation-wallet - Create new automation wallet
 *
 * Authentication: Required (session only, not API key)
 *
 * Note: This endpoint proxies to midcurve-signer for wallet creation.
 * The signer manages KMS-backed keys that never leave the HSM.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  createAutomationWalletSchema,
  type AutomationWalletDisplay,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Get signer service URL from environment
 */
function getSignerConfig() {
  const signerUrl = process.env.SIGNER_API_URL;
  const signerApiKey = process.env.SIGNER_INTERNAL_API_KEY;

  if (!signerUrl || !signerApiKey) {
    throw new Error(
      'SIGNER_API_URL and SIGNER_INTERNAL_API_KEY must be configured'
    );
  }

  return { signerUrl, signerApiKey };
}

/**
 * GET /api/v1/user/automation-wallet
 *
 * Get the authenticated user's automation wallet.
 * Returns null if no wallet exists (not an error).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();

  apiLog.requestStart(apiLogger, requestId, request);

  // Session auth only (not API keys)
  const session = await auth();
  if (!session?.user?.id) {
    apiLog.authFailure(apiLogger, requestId, 'Session authentication required');

    const errorResponse = createErrorResponse(
      ApiErrorCode.UNAUTHORIZED,
      'Session authentication required'
    );

    apiLog.requestEnd(apiLogger, requestId, 401, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED],
    });
  }

  try {
    // Fetch user's automation wallet directly from database
    const wallet = await prisma.evmAutomationWallet.findFirst({
      where: {
        userId: session.user.id,
        isActive: true,
      },
    });

    // Return null if no wallet (not an error)
    if (!wallet) {
      const response = createSuccessResponse<AutomationWalletDisplay | null>(
        null
      );

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(response, {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-cache',
        },
      });
    }

    // Format wallet for response
    const walletDisplay: AutomationWalletDisplay = {
      id: wallet.id,
      walletAddress: wallet.walletAddress,
      label: wallet.label,
      keyProvider: wallet.keyProvider as 'aws-kms' | 'local-dev',
      isActive: wallet.isActive,
      createdAt: wallet.createdAt.toISOString(),
      lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null,
    };

    const response = createSuccessResponse(walletDisplay);

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    apiLog.methodError(
      apiLogger,
      'GET /api/v1/user/automation-wallet',
      error,
      {
        requestId,
        userId: session.user.id,
      }
    );

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to retrieve wallet',
      error instanceof Error ? error.message : String(error)
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}

/**
 * POST /api/v1/user/automation-wallet
 *
 * Create a new automation wallet for the authenticated user.
 * Proxies to midcurve-signer service which manages KMS-backed keys.
 *
 * Users can only have ONE automation wallet (enforced by signer).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();

  apiLog.requestStart(apiLogger, requestId, request);

  // Session auth only (not API keys)
  const session = await auth();
  if (!session?.user?.id) {
    apiLog.authFailure(apiLogger, requestId, 'Session authentication required');

    const errorResponse = createErrorResponse(
      ApiErrorCode.UNAUTHORIZED,
      'Session authentication required'
    );

    apiLog.requestEnd(apiLogger, requestId, 401, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED],
    });
  }

  try {
    // Check if user already has a wallet
    const existingWallet = await prisma.evmAutomationWallet.findFirst({
      where: {
        userId: session.user.id,
        isActive: true,
      },
    });

    if (existingWallet) {
      apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

      return NextResponse.json(
        createErrorResponse(
          ApiErrorCode.CONFLICT,
          'User already has an automation wallet'
        ),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.CONFLICT] }
      );
    }

    // Parse and validate request body
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is OK, label is optional
    }

    const validation = createAutomationWalletSchema.safeParse(body);

    if (!validation.success) {
      apiLog.validationError(apiLogger, requestId, validation.error.errors);

      const errorResponse = createErrorResponse(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid request data',
        validation.error.errors
      );

      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
      });
    }

    // Get signer config
    const { signerUrl, signerApiKey } = getSignerConfig();

    // Proxy to signer service
    const label = validation.data.label ?? 'Automation Wallet';

    let signerResponse: Response;
    try {
      signerResponse = await fetch(`${signerUrl}/api/wallets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signerApiKey}`,
        },
        body: JSON.stringify({
          userId: session.user.id,
          label,
        }),
      });
    } catch (fetchError) {
      // Network error - signer service unreachable
      apiLogger.error(
        {
          requestId,
          signerUrl,
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        },
        'Failed to connect to signer service'
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.SERVICE_UNAVAILABLE,
        'Wallet creation service is temporarily unavailable. Please ensure the signer service is running.',
        { signerUrl }
      );

      apiLog.requestEnd(apiLogger, requestId, 503, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.SERVICE_UNAVAILABLE],
      });
    }

    // Check if response is JSON before parsing
    const contentType = signerResponse.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      // Non-JSON response - likely HTML error page from unreachable/misconfigured service
      const responseText = await signerResponse.text();
      apiLogger.error(
        {
          requestId,
          signerUrl,
          status: signerResponse.status,
          contentType,
          responsePreview: responseText.substring(0, 200),
        },
        'Signer service returned non-JSON response'
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.SERVICE_UNAVAILABLE,
        'Wallet creation service returned an invalid response. Please check the signer service configuration.',
        {
          signerUrl,
          status: signerResponse.status,
          hint: 'Ensure SIGNER_API_URL points to a running midcurve-signer instance',
        }
      );

      apiLog.requestEnd(apiLogger, requestId, 503, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.SERVICE_UNAVAILABLE],
      });
    }

    const signerData = await signerResponse.json();

    if (!signerResponse.ok) {
      // Handle specific signer errors
      if (signerResponse.status === 409) {
        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);

        return NextResponse.json(
          createErrorResponse(
            ApiErrorCode.CONFLICT,
            signerData.message || 'User already has an automation wallet'
          ),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.CONFLICT] }
        );
      }

      throw new Error(signerData.message || 'Failed to create wallet');
    }

    apiLog.businessOperation(
      apiLogger,
      requestId,
      'created',
      'automation-wallet',
      signerData.wallet.id,
      {
        userId: session.user.id,
        walletAddress: signerData.wallet.walletAddress,
        keyProvider: signerData.wallet.keyProvider,
      }
    );

    const response = createSuccessResponse({
      id: signerData.wallet.id,
      walletAddress: signerData.wallet.walletAddress,
      label: signerData.wallet.label,
    });

    apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);

    return NextResponse.json(response, {
      status: 201,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    apiLog.methodError(
      apiLogger,
      'POST /api/v1/user/automation-wallet',
      error,
      {
        requestId,
        userId: session.user.id,
      }
    );

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to create wallet',
      errorMessage
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}
