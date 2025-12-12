/**
 * HODL Position Ledger Service
 *
 * Manages ledger events for HODL positions (multi-token baskets).
 * Unlike Uniswap V3, HODL events are manually managed - not discovered from on-chain.
 *
 * Event types supported:
 * - EXTERNAL_DEPOSIT: Tokens deposited from external source
 * - EXTERNAL_WITHDRAW: Tokens withdrawn to external destination
 * - TRADE_IN: Tokens received from a trade
 * - TRADE_OUT: Tokens sent in a trade
 * - TRADE_FEES: Fees paid for a trade
 * - INTERNAL_ALLOCATION_INFLOW: Tokens received from another position
 * - INTERNAL_ALLOCATION_OUTFLOW: Tokens sent to another position
 */

import { createHash } from 'crypto';
import type {
  HodlLedgerEvent,
  HodlLedgerEventConfig,
  HodlLedgerEventState,
} from '@midcurve/shared';
import {
  PositionLedgerService,
  type PositionLedgerServiceDependencies,
} from './position-ledger-service.js';
import type {
  CreateHodlLedgerEventInput,
  HodlLedgerEventDiscoverInput,
} from '../types/position-ledger/position-ledger-event-input.js';

/**
 * Database representation of HODL ledger event config
 * All bigint fields serialized as strings for JSON storage
 */
interface HodlLedgerEventConfigDB {
  chainId: number;
  blockNumber: string;
  txIndex: number;
  logIndex: number;
  txHash: string;
  tokenId: string;
  tokenAddress: string;
  tokenPriceInQuote: string;
  balanceAfter: string;
  costBasisAfter: string;
}

/**
 * Database representation of HODL ledger event state
 * Discriminated union with all amounts as strings
 */
interface HodlLedgerEventStateDB {
  eventType: string;
  tokenId: string;
  amount: string;
  fromAddress?: string;
  toAddress?: string;
  sourcePositionId?: string;
  destinationPositionId?: string;
}

/**
 * Dependencies for HodlPositionLedgerService
 * Extends base dependencies - no additional dependencies needed
 */
export interface HodlPositionLedgerServiceDependencies
  extends PositionLedgerServiceDependencies {
  // No additional dependencies for now
  // Future: Add CoinGeckoClient for price lookups if needed
}

/**
 * HODL Position Ledger Service
 *
 * Minimal implementation extending the base PositionLedgerService.
 * Only implements required abstract methods.
 */
export class HodlPositionLedgerService extends PositionLedgerService<'hodl'> {
  constructor(dependencies: HodlPositionLedgerServiceDependencies = {}) {
    super(dependencies);
  }

  // ============================================================================
  // SERIALIZATION METHODS
  // ============================================================================

  /**
   * Parse config from database JSON to application type
   */
  parseConfig(configDB: unknown): HodlLedgerEventConfig {
    const db = configDB as HodlLedgerEventConfigDB;

    return {
      chainId: db.chainId,
      blockNumber: BigInt(db.blockNumber),
      txIndex: db.txIndex,
      logIndex: db.logIndex,
      txHash: db.txHash,
      tokenId: db.tokenId,
      tokenAddress: db.tokenAddress,
      tokenPriceInQuote: BigInt(db.tokenPriceInQuote),
      balanceAfter: BigInt(db.balanceAfter),
      costBasisAfter: BigInt(db.costBasisAfter),
    };
  }

  /**
   * Serialize config from application type to database JSON
   */
  serializeConfig(config: HodlLedgerEventConfig): unknown {
    return {
      chainId: config.chainId,
      blockNumber: config.blockNumber.toString(),
      txIndex: config.txIndex,
      logIndex: config.logIndex,
      txHash: config.txHash,
      tokenId: config.tokenId,
      tokenAddress: config.tokenAddress,
      tokenPriceInQuote: config.tokenPriceInQuote.toString(),
      balanceAfter: config.balanceAfter.toString(),
      costBasisAfter: config.costBasisAfter.toString(),
    };
  }

  /**
   * Parse state from database JSON to application type
   * Handles discriminated union based on eventType
   */
  parseState(stateDB: unknown): HodlLedgerEventState {
    const db = stateDB as HodlLedgerEventStateDB;

    const base = {
      tokenId: db.tokenId,
      amount: BigInt(db.amount),
    };

    switch (db.eventType) {
      case 'EXTERNAL_DEPOSIT':
        return {
          eventType: 'EXTERNAL_DEPOSIT',
          ...base,
          fromAddress: db.fromAddress!,
        };

      case 'EXTERNAL_WITHDRAW':
        return {
          eventType: 'EXTERNAL_WITHDRAW',
          ...base,
          toAddress: db.toAddress!,
        };

      case 'TRADE_IN':
        return {
          eventType: 'TRADE_IN',
          ...base,
        };

      case 'TRADE_OUT':
        return {
          eventType: 'TRADE_OUT',
          ...base,
        };

      case 'TRADE_FEES':
        return {
          eventType: 'TRADE_FEES',
          ...base,
        };

      case 'INTERNAL_ALLOCATION_INFLOW':
        return {
          eventType: 'INTERNAL_ALLOCATION_INFLOW',
          ...base,
          sourcePositionId: db.sourcePositionId!,
        };

      case 'INTERNAL_ALLOCATION_OUTFLOW':
        return {
          eventType: 'INTERNAL_ALLOCATION_OUTFLOW',
          ...base,
          destinationPositionId: db.destinationPositionId!,
        };

      default:
        throw new Error(`Unknown HODL event type: ${db.eventType}`);
    }
  }

  /**
   * Serialize state from application type to database JSON
   * Handles discriminated union based on eventType
   */
  serializeState(state: HodlLedgerEventState): unknown {
    const base = {
      eventType: state.eventType,
      tokenId: state.tokenId,
      amount: state.amount.toString(),
    };

    switch (state.eventType) {
      case 'EXTERNAL_DEPOSIT':
        return {
          ...base,
          fromAddress: state.fromAddress,
        };

      case 'EXTERNAL_WITHDRAW':
        return {
          ...base,
          toAddress: state.toAddress,
        };

      case 'TRADE_IN':
      case 'TRADE_OUT':
      case 'TRADE_FEES':
        return base;

      case 'INTERNAL_ALLOCATION_INFLOW':
        return {
          ...base,
          sourcePositionId: state.sourcePositionId,
        };

      case 'INTERNAL_ALLOCATION_OUTFLOW':
        return {
          ...base,
          destinationPositionId: state.destinationPositionId,
        };

      default:
        throw new Error(`Unknown HODL event type: ${(state as any).eventType}`);
    }
  }

  // ============================================================================
  // HASH GENERATION
  // ============================================================================

  /**
   * Generate input hash for deduplication
   *
   * For HODL events, we use timestamp + tokenId + eventType + amount
   * since events are manually managed and may not have blockchain coordinates.
   *
   * Note: This method accepts either the full CreateHodlLedgerEventInput or
   * the HodlLedgerEventDiscoverInput (which has the same key fields).
   */
  generateInputHash(
    input: CreateHodlLedgerEventInput | HodlLedgerEventDiscoverInput
  ): string {
    // Handle both full input and discovery input
    const isDiscoveryInput = 'quoteValue' in input;

    if (isDiscoveryInput) {
      const discoverInput = input as HodlLedgerEventDiscoverInput;
      const hashInput = [
        discoverInput.timestamp.getTime().toString(),
        discoverInput.tokenId,
        discoverInput.eventType,
        discoverInput.amount.toString(),
      ].join('-');
      return createHash('md5').update(hashInput).digest('hex');
    }

    const fullInput = input as CreateHodlLedgerEventInput;
    const hashInput = [
      fullInput.timestamp.getTime().toString(),
      fullInput.state.tokenId,
      fullInput.state.eventType,
      fullInput.state.amount.toString(),
    ].join('-');

    return createHash('md5').update(hashInput).digest('hex');
  }

  // ============================================================================
  // DISCOVERY METHODS
  // ============================================================================

  /**
   * Discover all events for a position
   *
   * For HODL positions, there's no blockchain discovery.
   * This simply returns all existing events from the database.
   */
  async discoverAllEvents(positionId: string): Promise<HodlLedgerEvent[]> {
    this.logger.info({ positionId }, 'Discovering all HODL events (returning existing)');

    // HODL events are manual - no blockchain discovery needed
    // Just return existing events
    return this.findAllItems(positionId);
  }

  /**
   * Discover and add a single event to position ledger
   *
   * For HODL positions, this validates and adds the user-provided event.
   * The caller is responsible for providing complete event data including
   * financial calculations (cost basis, PnL).
   */
  async discoverEvent(
    positionId: string,
    input: HodlLedgerEventDiscoverInput
  ): Promise<HodlLedgerEvent[]> {
    this.logger.info(
      { positionId, eventType: input.eventType, tokenId: input.tokenId },
      'Discovering HODL event'
    );

    // Get the most recent event to link to
    const previousEvent = await this.getMostRecentEvent(positionId);

    // Build the event state based on event type
    const state = this.buildEventState(input);

    // Build the full event input
    // Note: The caller must provide a complete config with financial calculations
    // This is a minimal implementation - full implementation would calculate
    // cost basis and PnL based on previous state
    const eventInput: CreateHodlLedgerEventInput = {
      positionId,
      protocol: 'hodl',
      inputHash: this.generateInputHash(input),
      previousId: previousEvent?.id ?? null,
      timestamp: input.timestamp,
      eventType: this.mapEventTypeToGeneric(input.eventType),
      poolPrice: 0n, // HODL positions don't use pool price
      token0Amount: input.amount, // Use token0 for the primary token
      token1Amount: 0n,
      tokenValue: input.quoteValue,
      rewards: [],
      deltaCostBasis: this.calculateDeltaCostBasis(input),
      costBasisAfter: this.calculateCostBasisAfter(input, previousEvent),
      deltaPnl: this.calculateDeltaPnl(input),
      pnlAfter: this.calculatePnlAfter(input, previousEvent),
      config: this.buildEventConfig(input),
      state,
    };

    // Add the event using base class method
    return this.addItem(positionId, eventInput);
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Build event state from discovery input
   */
  private buildEventState(input: HodlLedgerEventDiscoverInput): HodlLedgerEventState {
    const base = {
      tokenId: input.tokenId,
      amount: input.amount,
    };

    switch (input.eventType) {
      case 'EXTERNAL_DEPOSIT':
        return {
          eventType: 'EXTERNAL_DEPOSIT',
          ...base,
          fromAddress: input.address ?? '',
        };

      case 'EXTERNAL_WITHDRAW':
        return {
          eventType: 'EXTERNAL_WITHDRAW',
          ...base,
          toAddress: input.address ?? '',
        };

      case 'TRADE_IN':
        return { eventType: 'TRADE_IN', ...base };

      case 'TRADE_OUT':
        return { eventType: 'TRADE_OUT', ...base };

      case 'TRADE_FEES':
        return { eventType: 'TRADE_FEES', ...base };

      case 'INTERNAL_ALLOCATION_INFLOW':
        return {
          eventType: 'INTERNAL_ALLOCATION_INFLOW',
          ...base,
          sourcePositionId: input.relatedPositionId ?? '',
        };

      case 'INTERNAL_ALLOCATION_OUTFLOW':
        return {
          eventType: 'INTERNAL_ALLOCATION_OUTFLOW',
          ...base,
          destinationPositionId: input.relatedPositionId ?? '',
        };

      default:
        throw new Error(`Unknown HODL event type: ${input.eventType}`);
    }
  }

  /**
   * Build event config from discovery input
   * Note: This is a minimal implementation - full implementation would
   * fetch chain info, token address, and current price
   */
  private buildEventConfig(input: HodlLedgerEventDiscoverInput): HodlLedgerEventConfig {
    return {
      chainId: 0, // Would be fetched from token
      blockNumber: 0n, // Manual events don't have blockchain coordinates
      txIndex: 0,
      logIndex: 0,
      txHash: input.txHash ?? '',
      tokenId: input.tokenId,
      tokenAddress: '', // Would be fetched from token
      tokenPriceInQuote: input.quoteValue > 0n && input.amount > 0n
        ? (input.quoteValue * BigInt(1e18)) / input.amount
        : 0n,
      balanceAfter: 0n, // Would be calculated from position state
      costBasisAfter: 0n, // Would be calculated from previous event
    };
  }

  /**
   * Map HODL event type to generic EventType
   */
  private mapEventTypeToGeneric(eventType: string): 'INCREASE_POSITION' | 'DECREASE_POSITION' | 'COLLECT' {
    switch (eventType) {
      case 'EXTERNAL_DEPOSIT':
      case 'TRADE_IN':
      case 'INTERNAL_ALLOCATION_INFLOW':
        return 'INCREASE_POSITION';

      case 'EXTERNAL_WITHDRAW':
      case 'TRADE_OUT':
      case 'INTERNAL_ALLOCATION_OUTFLOW':
        return 'DECREASE_POSITION';

      case 'TRADE_FEES':
        return 'COLLECT'; // Fees are similar to fee collection

      default:
        return 'INCREASE_POSITION';
    }
  }

  /**
   * Calculate delta cost basis for an event
   */
  private calculateDeltaCostBasis(input: HodlLedgerEventDiscoverInput): bigint {
    switch (input.eventType) {
      case 'EXTERNAL_DEPOSIT':
      case 'TRADE_IN':
      case 'INTERNAL_ALLOCATION_INFLOW':
        return input.quoteValue; // Increases cost basis

      case 'EXTERNAL_WITHDRAW':
      case 'TRADE_OUT':
      case 'INTERNAL_ALLOCATION_OUTFLOW':
        return -input.quoteValue; // Decreases cost basis (proportionally)

      case 'TRADE_FEES':
        return 0n; // Fees don't affect cost basis directly

      default:
        return 0n;
    }
  }

  /**
   * Calculate cost basis after event
   */
  private calculateCostBasisAfter(
    input: HodlLedgerEventDiscoverInput,
    previousEvent: HodlLedgerEvent | null
  ): bigint {
    const previousCostBasis = previousEvent?.costBasisAfter ?? 0n;
    return previousCostBasis + this.calculateDeltaCostBasis(input);
  }

  /**
   * Calculate delta PnL for an event
   */
  private calculateDeltaPnl(input: HodlLedgerEventDiscoverInput): bigint {
    switch (input.eventType) {
      case 'EXTERNAL_WITHDRAW':
      case 'TRADE_OUT':
        // PnL is realized on withdrawals
        // This is simplified - full implementation would compare to proportional cost basis
        return 0n;

      case 'TRADE_FEES':
        return -input.quoteValue; // Fees are negative PnL

      default:
        return 0n;
    }
  }

  /**
   * Calculate PnL after event
   */
  private calculatePnlAfter(
    input: HodlLedgerEventDiscoverInput,
    previousEvent: HodlLedgerEvent | null
  ): bigint {
    const previousPnl = previousEvent?.pnlAfter ?? 0n;
    return previousPnl + this.calculateDeltaPnl(input);
  }
}
