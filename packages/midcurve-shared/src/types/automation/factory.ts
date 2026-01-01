/**
 * Automation Factory
 *
 * Creates typed automation instances from database rows.
 * Uses type discriminators to select the correct implementation.
 */

import type { AutomationContractInterface } from './automation-contract.interface.js';
import type { AutomationContractType } from './automation-contract.types.js';
import type { CloseOrderInterface } from './close-order.interface.js';
import type { CloseOrderType } from './close-order.types.js';
import { UniswapV3AutomationContract } from './uniswapv3/uniswapv3-automation-contract.js';
import { UniswapV3CloseOrder } from './uniswapv3/uniswapv3-close-order.js';

// ============================================================================
// Generic Database Row Types
// ============================================================================

/**
 * Generic database row for automation contracts
 */
export interface AutomationContractRow {
  id: string;
  contractType: string;
  userId: string;
  isActive: boolean;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Generic database row for close orders
 */
export interface CloseOrderRow {
  id: string;
  contractId: string;
  orderType: string;
  status: string;
  positionId: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Automation Contract Factory
// ============================================================================

/**
 * Automation Contract Factory
 *
 * Creates typed automation contract instances from database rows.
 * Dispatches to the correct implementation based on contractType.
 */
export class AutomationContractFactory {
  /**
   * Create an automation contract from a database row
   *
   * @param row - Database row with contractType discriminator
   * @returns Typed automation contract instance
   * @throws Error if contract type is unknown
   */
  static fromDB(row: AutomationContractRow): AutomationContractInterface {
    const contractType = row.contractType as AutomationContractType;

    switch (contractType) {
      case 'uniswapv3':
        return UniswapV3AutomationContract.fromDB({
          ...row,
          contractType: 'uniswapv3',
        });

      default:
        throw new Error(`Unknown contract type: ${row.contractType}`);
    }
  }

  /**
   * Check if a contract type is supported
   */
  static isSupported(contractType: string): contractType is AutomationContractType {
    return ['uniswapv3'].includes(contractType);
  }
}

// ============================================================================
// Close Order Factory
// ============================================================================

/**
 * Close Order Factory
 *
 * Creates typed close order instances from database rows.
 * Dispatches to the correct implementation based on orderType.
 */
export class CloseOrderFactory {
  /**
   * Create a close order from a database row
   *
   * @param row - Database row with orderType discriminator
   * @returns Typed close order instance
   * @throws Error if order type is unknown
   */
  static fromDB(row: CloseOrderRow): CloseOrderInterface {
    const orderType = row.orderType as CloseOrderType;

    switch (orderType) {
      case 'uniswapv3':
        return UniswapV3CloseOrder.fromDB({
          ...row,
          orderType: 'uniswapv3',
          status: row.status as 'pending' | 'registering' | 'active' | 'triggering' | 'executed' | 'cancelled' | 'expired' | 'failed',
        });

      default:
        throw new Error(`Unknown order type: ${row.orderType}`);
    }
  }

  /**
   * Check if an order type is supported
   */
  static isSupported(orderType: string): orderType is CloseOrderType {
    return ['uniswapv3'].includes(orderType);
  }
}
