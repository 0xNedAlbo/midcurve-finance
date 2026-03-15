/**
 * Balance Sheet Endpoint
 *
 * GET /api/v1/accounting/balance-sheet?period=week
 *
 * Returns a structured balance sheet with period-over-period comparison.
 * Computes realized-only balances on-the-fly from journal entries.
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
  type BalanceSheetResponse,
  type BalanceSheetLineItem,
} from '@midcurve/api-shared';
import { prisma } from '@midcurve/database';
import { ACCOUNT_CODES, getCalendarPeriodBoundaries } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getJournalService } from '@/lib/services';
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
      const url = new URL(request.url);
      const periodParam = url.searchParams.get('period') ?? 'week';
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
      const offsetParam = parseInt(url.searchParams.get('offset') ?? '0', 10);
      const offset = isNaN(offsetParam) ? 0 : Math.min(0, offsetParam);
      const { currentEnd, previousEnd } = getCalendarPeriodBoundaries(period, new Date(), offset);

      const journalService = getJournalService();

      // Query realized account balances for current and previous period in parallel
      const [
        curDepositedLiquidity,
        curContributedCapital,
        curCapitalReturned,
        curRealizedGains,
        curRealizedLosses,
        curFeeIncome,
        prevDepositedLiquidity,
        prevContributedCapital,
        prevCapitalReturned,
        prevRealizedGains,
        prevRealizedLosses,
        prevFeeIncome,
        activePositionCount,
      ] = await Promise.all([
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.LP_POSITION_AT_COST, user.id, currentEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, user.id, currentEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.CAPITAL_RETURNED, user.id, currentEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.REALIZED_GAINS, user.id, currentEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.REALIZED_LOSSES, user.id, currentEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.FEE_INCOME, user.id, currentEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.LP_POSITION_AT_COST, user.id, previousEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, user.id, previousEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.CAPITAL_RETURNED, user.id, previousEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.REALIZED_GAINS, user.id, previousEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.REALIZED_LOSSES, user.id, previousEnd),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.FEE_INCOME, user.id, previousEnd),
        prisma.trackedPosition.count({ where: { userId: user.id } }),
      ]);

      // Current period
      const curTotalAssets = curDepositedLiquidity;
      const curRealizedWithdrawals = -curRealizedGains - curRealizedLosses;
      const curRealizedFees = -curFeeIncome;
      const curTotalRetainedEarnings = curRealizedWithdrawals + curRealizedFees;
      const curContCapDisplay = -curContributedCapital;
      const curCapRetDisplay = -curCapitalReturned;
      const curTotalEquity = curContCapDisplay + curCapRetDisplay + curTotalRetainedEarnings;

      // Previous period
      const prevTotalAssets = prevDepositedLiquidity;
      const prevRealizedWithdrawals = -prevRealizedGains - prevRealizedLosses;
      const prevRealizedFees = -prevFeeIncome;
      const prevTotalRetainedEarnings = prevRealizedWithdrawals + prevRealizedFees;
      const prevContCapDisplay = -prevContributedCapital;
      const prevCapRetDisplay = -prevCapitalReturned;
      const prevTotalEquity = prevContCapDisplay + prevCapRetDisplay + prevTotalRetainedEarnings;

      const response: BalanceSheetResponse = {
        period,
        currentDate: currentEnd.toISOString(),
        previousDate: previousEnd.toISOString(),
        reportingCurrency: 'USD',
        assets: {
          depositedLiquidityAtCost: buildLineItem(curTotalAssets, prevTotalAssets),
          totalAssets: buildLineItem(curTotalAssets, prevTotalAssets),
        },
        liabilities: {
          totalLiabilities: buildLineItem(0n, 0n),
        },
        equity: {
          contributedCapital: buildLineItem(curContCapDisplay, prevContCapDisplay),
          capitalReturned: buildLineItem(curCapRetDisplay, prevCapRetDisplay),
          retainedEarnings: {
            realizedFromWithdrawals: buildLineItem(curRealizedWithdrawals, prevRealizedWithdrawals),
            realizedFromCollectedFees: buildLineItem(curRealizedFees, prevRealizedFees),
            totalRetainedEarnings: buildLineItem(curTotalRetainedEarnings, prevTotalRetainedEarnings),
          },
          totalEquity: buildLineItem(curTotalEquity, prevTotalEquity),
        },
        activePositionCount,
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(response), {
        status: 200,
        headers: { 'Cache-Control': 'private, no-cache' },
      });
    } catch (error) {
      apiLog.methodError(apiLogger, 'GET /api/v1/accounting/balance-sheet', error, {
        requestId,
        userId: user.id,
      });

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve balance sheet',
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

function buildLineItem(current: bigint, previous: bigint | null): BalanceSheetLineItem {
  const currentStr = current.toString();

  if (previous === null) {
    return { current: currentStr, previous: null, deltaAbs: null, deltaPct: null };
  }

  const deltaAbs = current - previous;
  const absPrevious = previous < 0n ? -previous : previous;

  // Delta percentage in basis points (10^4 scale): (delta / |previous|) * 10000
  const deltaPct = absPrevious === 0n
    ? null
    : ((deltaAbs * 10000n) / absPrevious).toString();

  return {
    current: currentStr,
    previous: previous.toString(),
    deltaAbs: deltaAbs.toString(),
    deltaPct,
  };
}
