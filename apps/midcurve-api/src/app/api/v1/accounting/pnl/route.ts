/**
 * P&L Breakdown Endpoint
 *
 * GET /api/v1/accounting/pnl?period=month
 *
 * Returns period P&L breakdown per instrument from journal entries.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  PeriodQuerySchema,
  type PnlResponse,
  type PnlInstrumentItem,
} from '@midcurve/api-shared';
import { prisma } from '@midcurve/database';
import { ACCOUNT_CODES } from '@midcurve/services';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Validate period query param
      const url = new URL(request.url);
      const periodParam = url.searchParams.get('period') ?? 'month';
      const periodResult = PeriodQuerySchema.safeParse(periodParam);

      if (!periodResult.success) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid period parameter',
          periodResult.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const period = periodResult.data;
      const { startDate, endDate } = getPeriodDateRange(period);

      // Query journal lines within date range for this user (only lines with reporting amounts)
      const journalLines = await prisma.journalLine.findMany({
        where: {
          journalEntry: {
            userId: user.id,
            entryDate: { gte: startDate, lte: endDate },
          },
          amountReporting: { not: null },
        },
        include: {
          journalEntry: { select: { entryDate: true } },
          account: { select: { code: true } },
        },
      });

      // Aggregate by instrumentRef and account code (using reporting currency amounts)
      const instrumentMap = new Map<string, {
        feeIncome: bigint;
        realizedGains: bigint;
        realizedLosses: bigint;
        unrealizedGains: bigint;
        unrealizedLosses: bigint;
      }>();

      for (const line of journalLines) {
        if (!line.instrumentRef) continue;
        const code = line.account.code;
        const amount = BigInt(line.amountReporting!);
        const signed = line.side === 'debit' ? amount : -amount;

        let agg = instrumentMap.get(line.instrumentRef);
        if (!agg) {
          agg = { feeIncome: 0n, realizedGains: 0n, realizedLosses: 0n, unrealizedGains: 0n, unrealizedLosses: 0n };
          instrumentMap.set(line.instrumentRef, agg);
        }

        // Revenue accounts: credits increase balance (negate signed)
        // Expense accounts: debits increase balance (use signed)
        switch (code) {
          case ACCOUNT_CODES.FEE_INCOME:
            agg.feeIncome += -signed; // credits increase revenue
            break;
          case ACCOUNT_CODES.REALIZED_GAINS:
            agg.realizedGains += -signed;
            break;
          case ACCOUNT_CODES.REALIZED_LOSSES:
            agg.realizedLosses += signed; // debits increase expense
            break;
          case ACCOUNT_CODES.UNREALIZED_GAINS:
            agg.unrealizedGains += -signed;
            break;
          case ACCOUNT_CODES.UNREALIZED_LOSSES:
            agg.unrealizedLosses += signed;
            break;
        }
      }

      // Look up pool symbols for each instrumentRef
      const instrumentRefs = [...instrumentMap.keys()];
      const positions = instrumentRefs.length > 0
        ? await prisma.position.findMany({
            where: { positionHash: { in: instrumentRefs } },
            select: {
              positionHash: true,
              isToken0Quote: true,
              pool: {
                select: {
                  token0: { select: { symbol: true } },
                  token1: { select: { symbol: true } },
                },
              },
            },
          })
        : [];

      const symbolMap = new Map<string, string>();
      for (const p of positions) {
        if (!p.positionHash) continue;
        const base = p.isToken0Quote ? p.pool.token1.symbol : p.pool.token0.symbol;
        const quote = p.isToken0Quote ? p.pool.token0.symbol : p.pool.token1.symbol;
        symbolMap.set(p.positionHash, `${base}/${quote}`);
      }

      // Build response
      let totalFeeIncome = 0n;
      let totalRealizedPnl = 0n;
      let totalUnrealizedPnl = 0n;
      const instruments: PnlInstrumentItem[] = [];

      for (const [ref, agg] of instrumentMap.entries()) {
        const feeIncome = agg.feeIncome;
        const realizedPnl = agg.realizedGains - agg.realizedLosses;
        const unrealizedPnl = agg.unrealizedGains - agg.unrealizedLosses;

        totalFeeIncome += feeIncome;
        totalRealizedPnl += realizedPnl;
        totalUnrealizedPnl += unrealizedPnl;

        instruments.push({
          instrumentRef: ref,
          poolSymbol: symbolMap.get(ref) ?? ref,
          feeIncome: feeIncome.toString(),
          realizedPnl: realizedPnl.toString(),
          unrealizedPnl: unrealizedPnl.toString(),
        });
      }

      const gasExpense = '0'; // Phase 1: no gas tracking
      const netPnl = (totalFeeIncome + totalRealizedPnl + totalUnrealizedPnl).toString();

      // Get reporting currency from user
      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { reportingCurrency: true },
      });

      const response: PnlResponse = {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        reportingCurrency: userData?.reportingCurrency ?? 'USD',
        feeIncome: totalFeeIncome.toString(),
        realizedPnl: totalRealizedPnl.toString(),
        unrealizedPnl: totalUnrealizedPnl.toString(),
        gasExpense,
        netPnl,
        instruments,
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(response), {
        status: 200,
        headers: { 'Cache-Control': 'private, no-cache' },
      });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/accounting/pnl', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve P&L data',
        error instanceof Error ? error.message : String(error)
      );

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}

// =============================================================================
// Helpers
// =============================================================================

function getPeriodDateRange(period: string): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const startDate = new Date(endDate);

  switch (period) {
    case 'day':
      startDate.setUTCDate(startDate.getUTCDate() - 1);
      break;
    case 'week':
      startDate.setUTCDate(startDate.getUTCDate() - 7);
      break;
    case 'month':
      startDate.setUTCDate(startDate.getUTCDate() - 30);
      break;
    case 'quarter':
      startDate.setUTCDate(startDate.getUTCDate() - 90);
      break;
    case 'year':
      startDate.setUTCDate(startDate.getUTCDate() - 365);
      break;
  }

  return { startDate, endDate };
}
