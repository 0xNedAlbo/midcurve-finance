/**
 * UniswapV3AprService
 *
 * Handles APR period CRUD operations for Uniswap V3 positions.
 * APR periods are bounded by COLLECT events and track fee generation metrics.
 *
 * This service is used by:
 * - UniswapV3LedgerService: to persist APR periods during event import
 * - External callers: to query APR periods for display/analysis
 */

import { PrismaClient } from "@midcurve/database";
import type { PrismaTransactionClient } from "../../clients/prisma/index.js";
import type { AprPeriodData } from "../types/position-apr/index.js";

// ============================================================================
// SERVICE CONFIGURATION
// ============================================================================

/**
 * Configuration for UniswapV3AprService.
 */
export interface UniswapV3AprServiceConfig {
    /**
     * Position ID that this service instance operates on.
     * All methods will use this position ID.
     */
    positionId: string;
}

/**
 * Dependencies for UniswapV3AprService.
 * All dependencies are optional and will use defaults if not provided.
 */
export interface UniswapV3AprServiceDependencies {
    /**
     * Prisma client for database operations.
     * If not provided, a new PrismaClient instance will be created.
     */
    prisma?: PrismaClient;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

/**
 * UniswapV3AprService
 *
 * Provides APR period management for Uniswap V3 positions.
 * Handles persistence and retrieval of APR periods bounded by COLLECT events.
 */
export class UniswapV3AprService {
    private readonly prisma: PrismaClient;

    /**
     * Position ID that this service operates on.
     */
    readonly positionId: string;

    /**
     * Creates a new UniswapV3AprService instance.
     *
     * @param config - Service configuration
     * @param dependencies - Optional dependencies
     */
    constructor(
        config: UniswapV3AprServiceConfig,
        dependencies: UniswapV3AprServiceDependencies = {},
    ) {
        this.positionId = config.positionId;
        this.prisma = dependencies.prisma ?? new PrismaClient();
    }

    // ============================================================================
    // PUBLIC METHODS
    // ============================================================================

    /**
     * Fetch APR periods up to a specific block.
     *
     * Returns APR periods where the endEvent's blockNumber <= specified block.
     * Periods are sorted by startTimestamp descending (newest first).
     *
     * @param blockNumber - Block number limit (inclusive), or 'latest' for all
     * @param tx - Optional transaction client
     * @returns Array of APR periods, or empty array if none exist
     */
    async fetchAprPeriods(
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<AprPeriodData[]> {
        const db = tx ?? this.prisma;

        // Get all APR periods for this position
        const periods = await db.positionAprPeriod.findMany({
            where: { positionId: this.positionId },
            orderBy: { startTimestamp: "desc" },
        });

        if (blockNumber === "latest") {
            return periods.map((period) => this.mapDbPeriodToAprPeriodData(period));
        }

        // Filter by block number - need to check endEvent's block
        // Since we store eventIds, we need to join with events to filter
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
     * Persist a single APR period to database.
     *
     * @param period - APR period data to persist
     * @param tx - Optional transaction client
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
                collectedFeeValue: period.collectedFeeValue.toString(),
                aprBps: period.aprBps,
                eventCount: period.eventCount,
            },
        });
    }

    /**
     * Delete all APR periods for this position.
     *
     * @param tx - Optional transaction client
     */
    async deleteAllAprPeriods(tx?: PrismaTransactionClient): Promise<void> {
        const db = tx ?? this.prisma;

        await db.positionAprPeriod.deleteMany({
            where: { positionId: this.positionId },
        });
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    /**
     * Map database APR period record to AprPeriodData interface.
     */
    private mapDbPeriodToAprPeriodData(period: {
        startEventId: string;
        endEventId: string;
        startTimestamp: Date;
        endTimestamp: Date;
        durationSeconds: number;
        costBasis: string;
        collectedFeeValue: string;
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
            collectedFeeValue: BigInt(period.collectedFeeValue),
            aprBps: period.aprBps,
            eventCount: period.eventCount,
        };
    }
}
