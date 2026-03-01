/**
 * P&L Statement Endpoint
 *
 * GET /api/v1/accounting/pnl?period=week
 *
 * Returns hierarchical P&L: Portfolio → Instrument → Position
 * with 4 sub-categories.
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
  OffsetQuerySchema,
  type PnlResponse,
  type PnlInstrumentItem,
  type PnlPositionItem,
} from '@midcurve/api-shared';
import { prisma } from '@midcurve/database';
import { ACCOUNT_CODES, getCalendarPeriodBoundaries } from '@midcurve/shared';
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
      const offsetParam = url.searchParams.get('offset') ?? '0';
      const offsetResult = OffsetQuerySchema.safeParse(offsetParam);
      const offset = offsetResult.success ? offsetResult.data : 0;
      const { currentStart: startDate, currentEnd: endDate } = getCalendarPeriodBoundaries(period, new Date(), offset);

      // Query journal lines within date range for this user
      const journalLines = await prisma.journalLine.findMany({
        where: {
          journalEntry: {
            userId: user.id,
            entryDate: { gte: startDate, lte: endDate },
          },
          amountReporting: { not: null },
        },
        include: {
          account: { select: { code: true } },
        },
      });

      // Aggregate by instrumentRef → positionRef → account code
      interface PnlBuckets {
        realizedFromWithdrawals: bigint;
        realizedFromCollectedFees: bigint;
        unrealizedFromPriceChanges: bigint;
        unrealizedFromUnclaimedFees: bigint;
      }

      const instrumentMap = new Map<string, {
        positions: Map<string, PnlBuckets>;
        totals: PnlBuckets;
      }>();

      for (const line of journalLines) {
        const instrRef = line.instrumentRef ?? 'unknown';
        const posRef = line.positionRef ?? 'unknown';
        const code = line.account.code;
        const amount = BigInt(line.amountReporting!);
        const signed = line.side === 'debit' ? amount : -amount;

        let instrument = instrumentMap.get(instrRef);
        if (!instrument) {
          instrument = {
            positions: new Map(),
            totals: { realizedFromWithdrawals: 0n, realizedFromCollectedFees: 0n, unrealizedFromPriceChanges: 0n, unrealizedFromUnclaimedFees: 0n },
          };
          instrumentMap.set(instrRef, instrument);
        }

        let position = instrument.positions.get(posRef);
        if (!position) {
          position = { realizedFromWithdrawals: 0n, realizedFromCollectedFees: 0n, unrealizedFromPriceChanges: 0n, unrealizedFromUnclaimedFees: 0n };
          instrument.positions.set(posRef, position);
        }

        // Revenue (credit-normal): negate signed to get positive for credits
        // Expense (debit-normal): use signed directly for debits
        switch (code) {
          case ACCOUNT_CODES.REALIZED_GAINS:
            position.realizedFromWithdrawals += -signed;
            instrument.totals.realizedFromWithdrawals += -signed;
            break;
          case ACCOUNT_CODES.REALIZED_LOSSES:
            position.realizedFromWithdrawals -= signed;
            instrument.totals.realizedFromWithdrawals -= signed;
            break;
          case ACCOUNT_CODES.FEE_INCOME:
            position.realizedFromCollectedFees += -signed;
            instrument.totals.realizedFromCollectedFees += -signed;
            break;
          case ACCOUNT_CODES.UNREALIZED_GAINS:
            position.unrealizedFromPriceChanges += -signed;
            instrument.totals.unrealizedFromPriceChanges += -signed;
            break;
          case ACCOUNT_CODES.UNREALIZED_LOSSES:
            position.unrealizedFromPriceChanges -= signed;
            instrument.totals.unrealizedFromPriceChanges -= signed;
            break;
          case ACCOUNT_CODES.ACCRUED_FEE_INCOME_REVENUE:
            position.unrealizedFromUnclaimedFees += -signed;
            instrument.totals.unrealizedFromUnclaimedFees += -signed;
            break;
        }
      }

      // Look up pool metadata for each instrumentRef (pool hash)
      const instrumentRefs = [...instrumentMap.keys()].filter((r) => r !== 'unknown');
      const pools = instrumentRefs.length > 0
        ? await prisma.pool.findMany({
            where: { poolHash: { in: instrumentRefs } },
            select: {
              poolHash: true,
              protocol: true,
              config: true,
              token0: { select: { symbol: true } },
              token1: { select: { symbol: true } },
            },
          })
        : [];

      const poolMetaMap = new Map<string, { symbol: string; protocol: string; chainId: number; feeTier: string }>();
      for (const p of pools) {
        if (!p.poolHash) continue;
        const config = p.config as Record<string, unknown>;
        poolMetaMap.set(p.poolHash, {
          symbol: `${p.token0.symbol}/${p.token1.symbol}`,
          protocol: p.protocol,
          chainId: (config.chainId as number) ?? 0,
          feeTier: String((config.feeBps as number) ?? 0),
        });
      }

      // Build response
      let totalRealizedWithdrawals = 0n;
      let totalRealizedFees = 0n;
      let totalUnrealizedPrice = 0n;
      let totalUnrealizedFees = 0n;
      const instruments: PnlInstrumentItem[] = [];

      for (const [instrRef, instrument] of instrumentMap.entries()) {
        totalRealizedWithdrawals += instrument.totals.realizedFromWithdrawals;
        totalRealizedFees += instrument.totals.realizedFromCollectedFees;
        totalUnrealizedPrice += instrument.totals.unrealizedFromPriceChanges;
        totalUnrealizedFees += instrument.totals.unrealizedFromUnclaimedFees;

        const meta = poolMetaMap.get(instrRef);
        const instrNetPnl = instrument.totals.realizedFromWithdrawals
          + instrument.totals.realizedFromCollectedFees
          + instrument.totals.unrealizedFromPriceChanges
          + instrument.totals.unrealizedFromUnclaimedFees;

        const positions: PnlPositionItem[] = [];
        for (const [posRef, buckets] of instrument.positions.entries()) {
          const posNetPnl = buckets.realizedFromWithdrawals
            + buckets.realizedFromCollectedFees
            + buckets.unrealizedFromPriceChanges
            + buckets.unrealizedFromUnclaimedFees;

          const parts = posRef.split('/');
          positions.push({
            positionRef: posRef,
            nftId: parts[parts.length - 1] ?? posRef,
            realizedFromWithdrawals: buckets.realizedFromWithdrawals.toString(),
            realizedFromCollectedFees: buckets.realizedFromCollectedFees.toString(),
            unrealizedFromPriceChanges: buckets.unrealizedFromPriceChanges.toString(),
            unrealizedFromUnclaimedFees: buckets.unrealizedFromUnclaimedFees.toString(),
            netPnl: posNetPnl.toString(),
          });
        }

        instruments.push({
          instrumentRef: instrRef,
          poolSymbol: meta?.symbol ?? instrRef,
          protocol: meta?.protocol ?? 'unknown',
          chainId: meta?.chainId ?? 0,
          feeTier: meta?.feeTier ?? '0',
          realizedFromWithdrawals: instrument.totals.realizedFromWithdrawals.toString(),
          realizedFromCollectedFees: instrument.totals.realizedFromCollectedFees.toString(),
          unrealizedFromPriceChanges: instrument.totals.unrealizedFromPriceChanges.toString(),
          unrealizedFromUnclaimedFees: instrument.totals.unrealizedFromUnclaimedFees.toString(),
          netPnl: instrNetPnl.toString(),
          positions,
        });
      }

      const totalNetPnl = totalRealizedWithdrawals + totalRealizedFees + totalUnrealizedPrice + totalUnrealizedFees;

      const response: PnlResponse = {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        reportingCurrency: 'USD',
        realizedFromWithdrawals: totalRealizedWithdrawals.toString(),
        realizedFromCollectedFees: totalRealizedFees.toString(),
        unrealizedFromPriceChanges: totalUnrealizedPrice.toString(),
        unrealizedFromUnclaimedFees: totalUnrealizedFees.toString(),
        netPnl: totalNetPnl.toString(),
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
