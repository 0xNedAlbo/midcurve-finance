/**
 * APR Period Types
 *
 * Types for APR period calculation and persistence.
 * APR periods are bounded by COLLECT events and track fee generation metrics.
 */

/**
 * APR period data calculated during ledger event processing.
 * Ready for persistence to PositionAprPeriod table.
 */
export interface AprPeriodData {
    /** Event ID that started this period */
    startEventId: string;
    /** Event ID that ended this period (the COLLECT event) */
    endEventId: string;
    /** Timestamp when period started */
    startTimestamp: Date;
    /** Timestamp when period ended */
    endTimestamp: Date;
    /** Duration in seconds */
    durationSeconds: number;
    /** Time-weighted average cost basis during period (in quote token units) */
    costBasis: bigint;
    /** Total fees collected at end of period (in quote token units) */
    collectedFeeValue: bigint;
    /** Annual Percentage Rate in basis points (e.g., 2500 = 25%) */
    aprBps: number;
    /** Number of events in this period */
    eventCount: number;
}
