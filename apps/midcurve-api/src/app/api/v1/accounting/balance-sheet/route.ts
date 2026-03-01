/**
 * Balance Sheet Endpoint
 *
 * GET /api/v1/accounting/balance-sheet?period=week
 *
 * Returns a structured balance sheet with period-over-period comparison.
 * Current column computed on-demand from journal balances.
 * Previous column read from closest NAV snapshot at period boundary.
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
import { ACCOUNT_CODES, getCalendarPeriodBoundaries } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getJournalService, getNavSnapshotService } from '@/lib/services';
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
      const { previousEnd } = getCalendarPeriodBoundaries(period);

      const journalService = getJournalService();
      const navSnapshotService = getNavSnapshotService();

      // Current column: compute from journal balances (always current)
      const [
        depositedLiquidity,
        markToMarket,
        unclaimedFees,
        contributedCapital,
        capitalReturned,
        feeIncome,
        accruedFeeIncome,
        realizedGains,
        realizedLosses,
        unrealizedGains,
        unrealizedLosses,
      ] = await Promise.all([
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.LP_POSITION_AT_COST, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.LP_POSITION_UNREALIZED_ADJUSTMENT, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.ACCRUED_FEE_INCOME, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.CONTRIBUTED_CAPITAL, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.CAPITAL_RETURNED, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.FEE_INCOME, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.ACCRUED_FEE_INCOME_REVENUE, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.REALIZED_GAINS, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.REALIZED_LOSSES, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.UNREALIZED_GAINS, user.id),
        journalService.getUserAccountBalanceReporting(ACCOUNT_CODES.UNREALIZED_LOSSES, user.id),
      ]);

      // Compute current values
      const curTotalAssets = depositedLiquidity + markToMarket + unclaimedFees;
      const curRealizedWithdrawals = realizedGains - realizedLosses;
      const curRealizedFees = feeIncome;
      const curUnrealizedPrice = unrealizedGains - unrealizedLosses;
      const curUnrealizedFees = accruedFeeIncome;
      const curTotalRetainedEarnings = curRealizedWithdrawals + curRealizedFees + curUnrealizedPrice + curUnrealizedFees;
      const curTotalEquity = contributedCapital - capitalReturned + curTotalRetainedEarnings;

      // Previous column: read from closest NAV snapshot
      const previousSnapshot = await navSnapshotService.getSnapshotAtBoundary(user.id, previousEnd);

      let previousDate: string | null = null;
      let prevDepositedLiquidity: bigint | null = null;
      let prevMarkToMarket: bigint | null = null;
      let prevUnclaimedFees: bigint | null = null;
      let prevTotalAssets: bigint | null = null;
      let prevContributedCapital: bigint | null = null;
      let prevCapitalReturned: bigint | null = null;
      let prevRealizedWithdrawals: bigint | null = null;
      let prevRealizedFees: bigint | null = null;
      let prevUnrealizedPrice: bigint | null = null;
      let prevUnrealizedFees: bigint | null = null;
      let prevTotalRetainedEarnings: bigint | null = null;
      let prevTotalEquity: bigint | null = null;

      if (previousSnapshot) {
        previousDate = previousSnapshot.snapshotDate.toISOString();
        prevDepositedLiquidity = BigInt(previousSnapshot.depositedLiquidityAtCost);
        prevMarkToMarket = BigInt(previousSnapshot.markToMarketAdjustment);
        prevUnclaimedFees = BigInt(previousSnapshot.unclaimedFees);
        prevTotalAssets = BigInt(previousSnapshot.totalAssets);
        prevContributedCapital = BigInt(previousSnapshot.contributedCapital);
        prevCapitalReturned = BigInt(previousSnapshot.capitalReturned);
        prevRealizedWithdrawals = BigInt(previousSnapshot.retainedRealizedWithdrawals);
        prevRealizedFees = BigInt(previousSnapshot.retainedRealizedFees);
        prevUnrealizedPrice = BigInt(previousSnapshot.retainedUnrealizedPrice);
        prevUnrealizedFees = BigInt(previousSnapshot.retainedUnrealizedFees);
        prevTotalRetainedEarnings = prevRealizedWithdrawals + prevRealizedFees + prevUnrealizedPrice + prevUnrealizedFees;
        prevTotalEquity = prevContributedCapital - prevCapitalReturned + prevTotalRetainedEarnings;
      }

      const response: BalanceSheetResponse = {
        period,
        currentDate: new Date().toISOString(),
        previousDate,
        reportingCurrency: 'USD',
        assets: {
          depositedLiquidityAtCost: buildLineItem(depositedLiquidity, prevDepositedLiquidity),
          markToMarketAdjustment: buildLineItem(markToMarket, prevMarkToMarket),
          unclaimedFees: buildLineItem(unclaimedFees, prevUnclaimedFees),
          totalAssets: buildLineItem(curTotalAssets, prevTotalAssets),
        },
        liabilities: {
          totalLiabilities: buildLineItem(0n, 0n),
        },
        equity: {
          contributedCapital: buildLineItem(contributedCapital, prevContributedCapital),
          capitalReturned: buildLineItem(capitalReturned, prevCapitalReturned),
          retainedEarnings: {
            realizedFromWithdrawals: buildLineItem(curRealizedWithdrawals, prevRealizedWithdrawals),
            realizedFromCollectedFees: buildLineItem(curRealizedFees, prevRealizedFees),
            unrealizedFromPriceChanges: buildLineItem(curUnrealizedPrice, prevUnrealizedPrice),
            unrealizedFromUnclaimedFees: buildLineItem(curUnrealizedFees, prevUnrealizedFees),
            totalRetainedEarnings: buildLineItem(curTotalRetainedEarnings, prevTotalRetainedEarnings),
          },
          totalEquity: buildLineItem(curTotalEquity, prevTotalEquity),
        },
        activePositionCount: 0, // Could count tracked positions, but not critical
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
