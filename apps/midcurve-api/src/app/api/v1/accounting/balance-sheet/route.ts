/**
 * Balance Sheet Endpoint
 *
 * GET /api/v1/accounting/balance-sheet?period=week
 *
 * Returns a structured balance sheet with period-over-period comparison.
 * Both current and previous columns read exclusively from NAV snapshots
 * (snapshot-only reporting — single calculation path).
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
import { getCalendarPeriodBoundaries } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getNavSnapshotService } from '@/lib/services';
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

      const navSnapshotService = getNavSnapshotService();

      // Current column: read from latest snapshot
      const currentSnapshot = await navSnapshotService.getLatestSnapshot(user.id);

      if (!currentSnapshot) {
        // Cold-start: no snapshot exists yet for this user
        const noDataResponse: BalanceSheetResponse = {
          noData: true,
          message: 'Reporting data will be available after the next daily snapshot at 01:00 UTC.',
        };
        apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
        return NextResponse.json(createSuccessResponse(noDataResponse), {
          status: 200,
          headers: { 'Cache-Control': 'private, no-cache' },
        });
      }

      // Extract current values from snapshot (same sign adjustments as before)
      const curDepositedLiquidity = BigInt(currentSnapshot.depositedLiquidityAtCost);
      const curMarkToMarket = BigInt(currentSnapshot.markToMarketAdjustment);
      const curUnclaimedFees = BigInt(currentSnapshot.unclaimedFees);
      const curTotalAssets = curDepositedLiquidity + curMarkToMarket + curUnclaimedFees;

      // Equity & retained earnings: negate raw journal values for display
      // (snapshot stores debits - credits; credit-normal accounts need negation)
      const curContributedCapital = -BigInt(currentSnapshot.contributedCapital);
      const curCapitalReturned = -BigInt(currentSnapshot.capitalReturned);
      const curRealizedWithdrawals = -BigInt(currentSnapshot.retainedRealizedWithdrawals);
      const curRealizedFees = -BigInt(currentSnapshot.retainedRealizedFees);
      const curUnrealizedPrice = -BigInt(currentSnapshot.retainedUnrealizedPrice);
      const curUnrealizedFees = -BigInt(currentSnapshot.retainedUnrealizedFees);
      const curTotalRetainedEarnings = curRealizedWithdrawals + curRealizedFees + curUnrealizedPrice + curUnrealizedFees;
      const curTotalEquity = curContributedCapital + curCapitalReturned + curTotalRetainedEarnings;

      // Previous column: read from closest NAV snapshot at period boundary
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
        prevTotalAssets = prevDepositedLiquidity + prevMarkToMarket + prevUnclaimedFees;
        prevContributedCapital = -BigInt(previousSnapshot.contributedCapital);
        prevCapitalReturned = -BigInt(previousSnapshot.capitalReturned);
        prevRealizedWithdrawals = -BigInt(previousSnapshot.retainedRealizedWithdrawals);
        prevRealizedFees = -BigInt(previousSnapshot.retainedRealizedFees);
        prevUnrealizedPrice = -BigInt(previousSnapshot.retainedUnrealizedPrice);
        prevUnrealizedFees = -BigInt(previousSnapshot.retainedUnrealizedFees);
        prevTotalRetainedEarnings = prevRealizedWithdrawals + prevRealizedFees + prevUnrealizedPrice + prevUnrealizedFees;
        prevTotalEquity = prevContributedCapital + prevCapitalReturned + prevTotalRetainedEarnings;
      }

      const response: BalanceSheetResponse = {
        period,
        currentDate: currentSnapshot.snapshotDate.toISOString(),
        previousDate,
        reportingCurrency: currentSnapshot.reportingCurrency,
        assets: {
          depositedLiquidityAtCost: buildLineItem(curDepositedLiquidity, prevDepositedLiquidity),
          markToMarketAdjustment: buildLineItem(curMarkToMarket, prevMarkToMarket),
          unclaimedFees: buildLineItem(curUnclaimedFees, prevUnclaimedFees),
          totalAssets: buildLineItem(curTotalAssets, prevTotalAssets),
        },
        liabilities: {
          totalLiabilities: buildLineItem(0n, 0n),
        },
        equity: {
          contributedCapital: buildLineItem(curContributedCapital, prevContributedCapital),
          capitalReturned: buildLineItem(curCapitalReturned, prevCapitalReturned),
          retainedEarnings: {
            realizedFromWithdrawals: buildLineItem(curRealizedWithdrawals, prevRealizedWithdrawals),
            realizedFromCollectedFees: buildLineItem(curRealizedFees, prevRealizedFees),
            unrealizedFromPriceChanges: buildLineItem(curUnrealizedPrice, prevUnrealizedPrice),
            unrealizedFromUnclaimedFees: buildLineItem(curUnrealizedFees, prevUnrealizedFees),
            totalRetainedEarnings: buildLineItem(curTotalRetainedEarnings, prevTotalRetainedEarnings),
          },
          totalEquity: buildLineItem(curTotalEquity, prevTotalEquity),
        },
        activePositionCount: currentSnapshot.activePositionCount,
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
