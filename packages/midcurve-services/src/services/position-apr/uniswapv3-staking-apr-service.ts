/**
 * UniswapV3StakingAprService
 *
 * Handles APR period CRUD operations for UniswapV3StakingVault positions.
 * Mirrors `UniswapV3AprService` (NFT canonical) with one semantic difference:
 *
 * **APR periods for staking are bracketed by `STAKING_DISPOSE` events**, not
 * `COLLECT`. Staking has no separate fee-collection moment — yield is realized
 * at swap settlement, so each `STAKING_DISPOSE` ledger event closes one APR
 * period and starts the next. The bracketing happens during
 * `UniswapV3StakingLedgerService.recalculateAggregates`; this service is the
 * thin CRUD layer that persists / reads / deletes the resulting `PositionAprPeriod`
 * rows and computes the running summary.
 *
 * Public surface mirrors `UniswapV3AprService`:
 * - `fetchAprPeriods(blockNumber?)` — read periods
 * - `persistAprPeriod(period)` — append a single period (called by the ledger
 *    service mid-recalc as it crosses each STAKING_DISPOSE)
 * - `deleteAllAprPeriods()` — wipe periods for this position
 * - `calculateSummary({ positionOpenedAt, costBasis, unclaimedYield }, blockNumber?)`
 *    — compute realized + unrealized + total APR (same shape as NFT/Vault)
 */

import { prisma as prismaClient, PrismaClient } from "@midcurve/database";
import type { AprSummary } from "@midcurve/shared";
import type { PrismaTransactionClient } from "../../clients/prisma/index.js";
import type { AprPeriodData } from "../types/position-apr/index.js";

// ============================================================================
// SERVICE CONFIGURATION
// ============================================================================

export interface UniswapV3StakingAprServiceConfig {
    /** Position ID that this service instance operates on. */
    positionId: string;
}

export interface UniswapV3StakingAprServiceDependencies {
    prisma?: PrismaClient;
}

// ============================================================================
// SERVICE
// ============================================================================

export class UniswapV3StakingAprService {
    private readonly prisma: PrismaClient;
    readonly positionId: string;

    constructor(
        config: UniswapV3StakingAprServiceConfig,
        dependencies: UniswapV3StakingAprServiceDependencies = {},
    ) {
        this.positionId = config.positionId;
        this.prisma = dependencies.prisma ?? prismaClient;
    }

    /**
     * Fetch APR periods up to a specific block.
     *
     * Returns periods where the endEvent's blockNumber <= the specified block.
     * Periods are sorted by `startTimestamp` descending (newest first).
     */
    async fetchAprPeriods(
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<AprPeriodData[]> {
        const db = tx ?? this.prisma;

        const periods = await db.positionAprPeriod.findMany({
            where: { positionId: this.positionId },
            orderBy: { startTimestamp: "desc" },
        });

        if (blockNumber === "latest") {
            return periods.map((period) => this.mapDbPeriodToAprPeriodData(period));
        }

        const filteredPeriods: AprPeriodData[] = [];
        for (const period of periods) {
            const endEvent = await db.positionLedgerEvent.findUnique({
                where: { id: period.endEventId },
            });
            if (endEvent) {
                const eventConfig = endEvent.config as { blockNumber: number };
                if (eventConfig.blockNumber <= blockNumber) {
                    filteredPeriods.push(this.mapDbPeriodToAprPeriodData(period));
                }
            }
        }
        return filteredPeriods;
    }

    /**
     * Append a single APR period. Called by the ledger service's
     * `recalculateAggregates` as it crosses each `STAKING_DISPOSE` event.
     */
    async persistAprPeriod(
        period: AprPeriodData,
        tx?: PrismaTransactionClient,
    ): Promise<void> {
        const db = tx ?? this.prisma;

        await db.positionAprPeriod.create({
            data: {
                positionId: this.positionId,
                startEventId: period.startEventId,
                endEventId: period.endEventId,
                startTimestamp: period.startTimestamp,
                endTimestamp: period.endTimestamp,
                durationSeconds: period.durationSeconds,
                costBasis: period.costBasis.toString(),
                collectedYieldValue: period.collectedYieldValue.toString(),
                aprBps: period.aprBps,
                eventCount: period.eventCount,
            },
        });
    }

    /** Wipe all APR periods for this position. Called at the start of recalc. */
    async deleteAllAprPeriods(tx?: PrismaTransactionClient): Promise<void> {
        const db = tx ?? this.prisma;

        await db.positionAprPeriod.deleteMany({
            where: { positionId: this.positionId },
        });
    }

    /**
     * Compute realized + unrealized + total APR.
     *
     * Realized = bracketed periods bounded by STAKING_DISPOSE events.
     * Unrealized = unclaimedYield since the last dispose (passed in by caller;
     * staking currently has `unclaimedYield = 0n` until contract issue #69 lands).
     */
    async calculateSummary(
        params: {
            positionOpenedAt: Date;
            costBasis: bigint;
            unclaimedYield: bigint;
        },
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<AprSummary> {
        const aprPeriods = await this.fetchAprPeriods(blockNumber, tx);

        // Realized metrics from completed APR periods.
        let realizedFees = 0n;
        let realizedWeightedCostBasisSum = 0n;
        let realizedTotalSeconds = 0;

        for (const period of aprPeriods) {
            realizedFees += period.collectedYieldValue;
            realizedWeightedCostBasisSum +=
                period.costBasis * BigInt(period.durationSeconds);
            realizedTotalSeconds += period.durationSeconds;
        }

        const realizedTWCostBasis =
            realizedTotalSeconds > 0
                ? realizedWeightedCostBasisSum / BigInt(realizedTotalSeconds)
                : 0n;
        const realizedActiveDays = realizedTotalSeconds / 86400;
        const realizedApr =
            realizedTWCostBasis > 0n && realizedActiveDays > 0
                ? (Number(realizedFees) / Number(realizedTWCostBasis)) *
                  (365 / realizedActiveDays) *
                  100
                : 0;

        // Unrealized metrics from current state (since the most recent period end).
        const unrealizedFees = params.unclaimedYield;
        const unrealizedCostBasis = params.costBasis;
        const firstPeriod = aprPeriods[0];
        const lastPeriodEnd = firstPeriod
            ? firstPeriod.endTimestamp
            : params.positionOpenedAt;
        const unrealizedSeconds = Math.max(
            0,
            (Date.now() - lastPeriodEnd.getTime()) / 1000,
        );
        const unrealizedActiveDays = unrealizedSeconds / 86400;
        const unrealizedApr =
            unrealizedCostBasis > 0n && unrealizedActiveDays > 0
                ? (Number(unrealizedFees) / Number(unrealizedCostBasis)) *
                  (365 / unrealizedActiveDays) *
                  100
                : 0;

        // Time-weighted total APR.
        const totalActiveDays = realizedActiveDays + unrealizedActiveDays;
        const totalApr =
            totalActiveDays > 0
                ? (realizedApr * realizedActiveDays +
                      unrealizedApr * unrealizedActiveDays) /
                  totalActiveDays
                : 0;

        // Minimum threshold: 5 minutes of active duration.
        const belowThreshold = totalActiveDays < 0.00347;

        return {
            realizedFees,
            realizedTWCostBasis,
            realizedActiveDays: Math.round(realizedActiveDays * 10) / 10,
            realizedApr,
            unrealizedFees,
            unrealizedCostBasis,
            unrealizedActiveDays: Math.round(unrealizedActiveDays * 10) / 10,
            unrealizedApr,
            totalApr,
            baseApr: totalApr,
            rewardApr: 0,
            totalActiveDays: Math.round(totalActiveDays * 10) / 10,
            belowThreshold,
        };
    }

    private mapDbPeriodToAprPeriodData(period: {
        startEventId: string;
        endEventId: string;
        startTimestamp: Date;
        endTimestamp: Date;
        durationSeconds: number;
        costBasis: string;
        collectedYieldValue: string;
        aprBps: number;
        eventCount: number;
    }): AprPeriodData {
        return {
            startEventId: period.startEventId,
            endEventId: period.endEventId,
            startTimestamp: period.startTimestamp,
            endTimestamp: period.endTimestamp,
            durationSeconds: period.durationSeconds,
            costBasis: BigInt(period.costBasis),
            collectedYieldValue: BigInt(period.collectedYieldValue),
            aprBps: period.aprBps,
            eventCount: period.eventCount,
        };
    }
}
