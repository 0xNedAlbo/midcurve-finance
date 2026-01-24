/**
 * Position Ledger Event Factory
 *
 * Factory for creating position ledger events from database rows.
 * Handles protocol detection and instantiation.
 */

import type { PositionLedgerEventInterface } from './position-ledger-event.interface.js';
import type {
  LedgerEventProtocol,
  PositionLedgerEventRow,
} from './position-ledger-event.types.js';
import {
  UniswapV3PositionLedgerEvent,
  type UniswapV3PositionLedgerEventRow,
} from './uniswapv3/uniswapv3-position-ledger-event.js';

/**
 * PositionLedgerEventFactory
 *
 * Factory for creating protocol-specific ledger event instances.
 *
 * @example
 * ```typescript
 * // From database row
 * const event = PositionLedgerEventFactory.fromDB(row);
 *
 * // Check protocol support
 * if (PositionLedgerEventFactory.isSupported(row.protocol)) {
 *   const event = PositionLedgerEventFactory.fromDB(row);
 * }
 * ```
 */
export class PositionLedgerEventFactory {
  /**
   * Create a ledger event from a database row.
   *
   * @param row - Database row from Prisma
   * @returns Protocol-specific ledger event instance
   * @throws Error if protocol is not supported
   */
  static fromDB(row: PositionLedgerEventRow): PositionLedgerEventInterface {
    const protocol = row.protocol as LedgerEventProtocol;

    switch (protocol) {
      case 'uniswapv3':
        return UniswapV3PositionLedgerEvent.fromDB(
          row as UniswapV3PositionLedgerEventRow
        );

      default:
        throw new Error(`Unknown ledger event protocol: ${row.protocol}`);
    }
  }

  /**
   * Check if a protocol is supported.
   *
   * @param protocol - Protocol identifier
   * @returns true if protocol is supported
   */
  static isSupported(protocol: string): protocol is LedgerEventProtocol {
    return ['uniswapv3'].includes(protocol);
  }
}
