/**
 * P&L Statement Endpoint
 *
 * GET /api/v1/accounting/pnl?period=week
 *
 * Returns hierarchical P&L: Portfolio → Instrument → Position
 * with realized sub-categories only.
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
        realizedFromFxEffect: bigint;
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
            totals: { realizedFromWithdrawals: 0n, realizedFromCollectedFees: 0n, realizedFromFxEffect: 0n },
          };
          instrumentMap.set(instrRef, instrument);
        }

        let position = instrument.positions.get(posRef);
        if (!position) {
          position = { realizedFromWithdrawals: 0n, realizedFromCollectedFees: 0n, realizedFromFxEffect: 0n };
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
          case ACCOUNT_CODES.FX_GAIN_LOSS:
            position.realizedFromFxEffect += -signed;
            instrument.totals.realizedFromFxEffect += -signed;
            break;
        }
      }

      // Look up pool metadata from positions (one position per instrument ref is enough)
      const instrumentRefs = [...instrumentMap.keys()].filter((r) => r !== 'unknown');
      const poolMetaMap = new Map<string, { symbol: string; protocol: string; chainId: number; feeTier: string }>();

      if (instrumentRefs.length > 0) {
        // Parse pool hashes to extract chainId + poolAddress, then find a position for each
        for (const ref of instrumentRefs) {
          const parts = ref.split('/');
          if (parts.length !== 3) continue;
          const [protocol, chainIdStr, poolAddress] = parts;
          const chainId = Number(chainIdStr);

          const position = await prisma.position.findFirst({
            where: {
              protocol,
              config: {
                path: ['chainId'],
                equals: chainId,
              },
              AND: [
                { config: { path: ['poolAddress'], string_contains: poolAddress } },
              ],
            },
            select: { config: true },
          });

          if (position) {
            const config = position.config as Record<string, unknown>;
            const token0Addr = config.token0Address as string;
            const token1Addr = config.token1Address as string;

            // Look up token symbols
            const [token0, token1] = await Promise.all([
              prisma.token.findFirst({ where: { config: { path: ['address'], equals: token0Addr } }, select: { symbol: true } }),
              prisma.token.findFirst({ where: { config: { path: ['address'], equals: token1Addr } }, select: { symbol: true } }),
            ]);

            poolMetaMap.set(ref, {
              symbol: `${token0?.symbol ?? '???'}/${token1?.symbol ?? '???'}`,
              protocol,
              chainId,
              feeTier: String((config.feeBps as number) ?? 0),
            });
          }
        }
      }

      // Build response
      let totalRealizedWithdrawals = 0n;
      let totalRealizedFees = 0n;
      let totalRealizedFx = 0n;
      const instruments: PnlInstrumentItem[] = [];

      for (const [instrRef, instrument] of instrumentMap.entries()) {
        totalRealizedWithdrawals += instrument.totals.realizedFromWithdrawals;
        totalRealizedFees += instrument.totals.realizedFromCollectedFees;
        totalRealizedFx += instrument.totals.realizedFromFxEffect;

        const meta = poolMetaMap.get(instrRef);
        const instrNetPnl = instrument.totals.realizedFromWithdrawals
          + instrument.totals.realizedFromCollectedFees
          + instrument.totals.realizedFromFxEffect;

        const positions: PnlPositionItem[] = [];
        for (const [posRef, buckets] of instrument.positions.entries()) {
          const posNetPnl = buckets.realizedFromWithdrawals
            + buckets.realizedFromCollectedFees
            + buckets.realizedFromFxEffect;

          const parts = posRef.split('/');
          positions.push({
            positionRef: posRef,
            nftId: parts[parts.length - 1] ?? posRef,
            realizedFromWithdrawals: buckets.realizedFromWithdrawals.toString(),
            realizedFromCollectedFees: buckets.realizedFromCollectedFees.toString(),
            realizedFromFxEffect: buckets.realizedFromFxEffect.toString(),
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
          realizedFromFxEffect: instrument.totals.realizedFromFxEffect.toString(),
          netPnl: instrNetPnl.toString(),
          positions,
        });
      }

      const totalNetPnl = totalRealizedWithdrawals + totalRealizedFees + totalRealizedFx;

      const response: PnlResponse = {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        reportingCurrency: 'USD',
        realizedFromWithdrawals: totalRealizedWithdrawals.toString(),
        realizedFromCollectedFees: totalRealizedFees.toString(),
        realizedFromFxEffect: totalRealizedFx.toString(),
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
