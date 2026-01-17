/**
 * Hyperliquid Wallet API Endpoint
 *
 * GET /api/v1/hyperliquid/wallet - Get user's Hyperliquid wallet info
 * POST /api/v1/hyperliquid/wallet - Import user's Hyperliquid wallet
 * DELETE /api/v1/hyperliquid/wallet - Delete user's Hyperliquid wallet
 *
 * Unlike automation wallets (generated), Hyperliquid wallets are imported
 * from user-provided private keys created on hyperliquid.xyz.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ImportHyperliquidWalletRequestSchema,
  type GetHyperliquidWalletResponse,
  type ImportHyperliquidWalletResponse,
  type DeleteHyperliquidWalletResponse,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Signer service URL
const SIGNER_URL = process.env.SIGNER_URL || 'http://localhost:3003';
const SIGNER_INTERNAL_API_KEY = process.env.SIGNER_INTERNAL_API_KEY || '';

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/hyperliquid/wallet
 *
 * Get user's Hyperliquid wallet address.
 * Returns null data if no wallet exists yet.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'get',
        'hyperliquid-wallet',
        user.id,
        {}
      );

      // Call signer service to get wallet info
      const signerResponse = await fetch(
        `${SIGNER_URL}/api/wallets/hyperliquid?userId=${encodeURIComponent(user.id)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${SIGNER_INTERNAL_API_KEY}`,
          },
        }
      );

      if (!signerResponse.ok) {
        const errorText = await signerResponse.text();
        apiLogger.error({
          requestId,
          status: signerResponse.status,
          error: errorText,
        }, 'Failed to get Hyperliquid wallet from signer');

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to get Hyperliquid wallet info'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const signerData = await signerResponse.json();

      // If wallet is null, user hasn't imported one yet
      if (!signerData.wallet) {
        const response: GetHyperliquidWalletResponse = createSuccessResponse(null);
        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
        return NextResponse.json(response, { status: 200 });
      }

      // Build response with wallet info
      const response: GetHyperliquidWalletResponse = createSuccessResponse({
        address: signerData.wallet.walletAddress || '',
        label: signerData.wallet.label || '',
        createdAt: signerData.wallet.createdAt || '',
        lastUsedAt: signerData.wallet.lastUsedAt || null,
        validUntil: signerData.wallet.validUntil || null,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/hyperliquid/wallet',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve Hyperliquid wallet'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}

/**
 * POST /api/v1/hyperliquid/wallet
 *
 * Import user's Hyperliquid wallet from a private key.
 * Returns 409 if wallet already exists.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse and validate request body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const validation = ImportHyperliquidWalletRequestSchema.safeParse(body);
      if (!validation.success) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          validation.error.issues.map((i) => i.message).join(', ')
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'import',
        'hyperliquid-wallet',
        user.id,
        { hasLabel: !!validation.data.label, validityDays: validation.data.validityDays }
      );

      // Call signer service to import wallet
      // Note: We do NOT log the private key
      const signerResponse = await fetch(
        `${SIGNER_URL}/api/wallets/hyperliquid`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SIGNER_INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({
            userId: user.id,
            privateKey: validation.data.privateKey,
            label: validation.data.label || 'Hyperliquid API Wallet',
            validityDays: validation.data.validityDays,
          }),
        }
      );

      // Handle conflict (wallet already exists)
      if (signerResponse.status === 409) {
        const signerError = await signerResponse.json();
        const errorResponse = createErrorResponse(
          ApiErrorCode.CONFLICT,
          signerError.message || 'Hyperliquid wallet already exists'
        );
        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 409 });
      }

      if (!signerResponse.ok) {
        const errorText = await signerResponse.text();
        apiLogger.error({
          requestId,
          status: signerResponse.status,
          error: errorText,
        }, 'Failed to import Hyperliquid wallet via signer');

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to import Hyperliquid wallet'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const signerData = await signerResponse.json();

      // Build response
      const response: ImportHyperliquidWalletResponse = createSuccessResponse({
        address: signerData.wallet.walletAddress,
        label: signerData.wallet.label,
        createdAt: signerData.wallet.createdAt,
        validUntil: signerData.wallet.validUntil || null,
      });

      apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);
      return NextResponse.json(response, { status: 201 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/hyperliquid/wallet',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to import Hyperliquid wallet'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}

/**
 * DELETE /api/v1/hyperliquid/wallet
 *
 * Delete user's Hyperliquid wallet.
 * Returns 404 if wallet doesn't exist.
 */
export async function DELETE(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'delete',
        'hyperliquid-wallet',
        user.id,
        {}
      );

      // Call signer service to delete wallet
      const signerResponse = await fetch(
        `${SIGNER_URL}/api/wallets/hyperliquid/${encodeURIComponent(user.id)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${SIGNER_INTERNAL_API_KEY}`,
          },
        }
      );

      // Handle not found
      if (signerResponse.status === 404) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'Hyperliquid wallet not found'
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 404 });
      }

      if (!signerResponse.ok) {
        const errorText = await signerResponse.text();
        apiLogger.error({
          requestId,
          status: signerResponse.status,
          error: errorText,
        }, 'Failed to delete Hyperliquid wallet via signer');

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to delete Hyperliquid wallet'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // Build response
      const response: DeleteHyperliquidWalletResponse = createSuccessResponse({
        success: true,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'DELETE /api/v1/hyperliquid/wallet',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to delete Hyperliquid wallet'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
