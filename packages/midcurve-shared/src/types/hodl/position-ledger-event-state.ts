/**
 * HODL Position Ledger Event State Types
 *
 * Raw event data for HODL position events.
 * State is a discriminated union representing different event types.
 *
 * Event types:
 * - EXTERNAL_DEPOSIT: Tokens deposited from external source
 * - EXTERNAL_WITHDRAW: Tokens withdrawn to external destination
 * - TRADE_IN: Tokens received from a trade
 * - TRADE_OUT: Tokens sent in a trade
 * - TRADE_FEES: Fees paid for a trade
 * - INTERNAL_ALLOCATION_INFLOW: Tokens received from another position in strategy
 * - INTERNAL_ALLOCATION_OUTFLOW: Tokens sent to another position in strategy
 */

/**
 * External Deposit Event
 *
 * Tokens enter the basket from an external source (user wallet, other strategy).
 * Increases cost basis and balance.
 */
export interface HodlExternalDepositEvent {
  /**
   * Event type discriminator
   */
  eventType: 'EXTERNAL_DEPOSIT';

  /**
   * Database token ID of the deposited token
   */
  tokenId: string;

  /**
   * Amount deposited in smallest token units
   */
  amount: bigint;

  /**
   * Source wallet address (EIP-55 checksummed for EVM)
   */
  fromAddress: string;
}

/**
 * External Withdraw Event
 *
 * Tokens leave the basket to an external destination.
 * Reduces cost basis proportionally and realizes PnL.
 */
export interface HodlExternalWithdrawEvent {
  /**
   * Event type discriminator
   */
  eventType: 'EXTERNAL_WITHDRAW';

  /**
   * Database token ID of the withdrawn token
   */
  tokenId: string;

  /**
   * Amount withdrawn in smallest token units
   */
  amount: bigint;

  /**
   * Destination wallet address (EIP-55 checksummed for EVM)
   */
  toAddress: string;
}

/**
 * Trade In Event
 *
 * Tokens received in exchange for other tokens.
 * Increases cost basis and balance.
 * Linked to TRADE_OUT event via txHash in config.
 */
export interface HodlTradeInEvent {
  /**
   * Event type discriminator
   */
  eventType: 'TRADE_IN';

  /**
   * Database token ID of the received token
   */
  tokenId: string;

  /**
   * Amount received in smallest token units
   */
  amount: bigint;

  // Note: txHash in config links this to corresponding TRADE_OUT event
}

/**
 * Trade Out Event
 *
 * Tokens sent in exchange for other tokens.
 * Reduces cost basis proportionally and realizes PnL.
 * Linked to TRADE_IN event via txHash in config.
 */
export interface HodlTradeOutEvent {
  /**
   * Event type discriminator
   */
  eventType: 'TRADE_OUT';

  /**
   * Database token ID of the sent token
   */
  tokenId: string;

  /**
   * Amount sent in smallest token units
   */
  amount: bigint;

  // Note: txHash in config links this to corresponding TRADE_IN event
}

/**
 * Trade Fees Event
 *
 * Fees paid for a trade (DEX/exchange fees).
 * Reduces cost basis and realizes negative PnL (expense).
 * Linked to trade via txHash in config.
 */
export interface HodlTradeFeesEvent {
  /**
   * Event type discriminator
   */
  eventType: 'TRADE_FEES';

  /**
   * Database token ID of the fee token
   */
  tokenId: string;

  /**
   * Fee amount in smallest token units
   */
  amount: bigint;

  // Note: txHash in config links this to the trade
}

/**
 * Internal Allocation Inflow Event
 *
 * Tokens received from another position within the same strategy.
 * Inherits cost basis from source position (no PnL realization).
 */
export interface HodlInternalAllocationInflowEvent {
  /**
   * Event type discriminator
   */
  eventType: 'INTERNAL_ALLOCATION_INFLOW';

  /**
   * Database token ID of the received token
   */
  tokenId: string;

  /**
   * Amount received in smallest token units
   */
  amount: bigint;

  /**
   * Position ID that sent the tokens
   */
  sourcePositionId: string;
}

/**
 * Internal Allocation Outflow Event
 *
 * Tokens sent to another position within the same strategy.
 * Reduces cost basis proportionally (no PnL realization - deferred to destination).
 */
export interface HodlInternalAllocationOutflowEvent {
  /**
   * Event type discriminator
   */
  eventType: 'INTERNAL_ALLOCATION_OUTFLOW';

  /**
   * Database token ID of the sent token
   */
  tokenId: string;

  /**
   * Amount sent in smallest token units
   */
  amount: bigint;

  /**
   * Position ID receiving the tokens
   */
  destinationPositionId: string;
}

/**
 * HODL Position Ledger Event State
 *
 * Union type representing any of the seven HODL event types.
 * Discriminated by `eventType` field for type narrowing.
 *
 * @example
 * ```typescript
 * function processEvent(state: HodlLedgerEventState) {
 *   switch (state.eventType) {
 *     case 'EXTERNAL_DEPOSIT':
 *       console.log(`Deposited from: ${state.fromAddress}`);
 *       break;
 *     case 'TRADE_IN':
 *       console.log(`Received: ${state.amount}`);
 *       break;
 *     // ... other cases
 *   }
 * }
 * ```
 */
export type HodlLedgerEventState =
  | HodlExternalDepositEvent
  | HodlExternalWithdrawEvent
  | HodlTradeInEvent
  | HodlTradeOutEvent
  | HodlTradeFeesEvent
  | HodlInternalAllocationInflowEvent
  | HodlInternalAllocationOutflowEvent;

/**
 * HODL Event Type
 *
 * String literal union of all HODL event types.
 * Useful for type-safe event type handling.
 */
export type HodlEventType = HodlLedgerEventState['eventType'];
