/**
 * Close Order Types
 *
 * Type definitions for automation close orders.
 * Close orders define price triggers for automatically closing positions.
 */

/**
 * Close order type discriminator
 *
 * Extensible for future protocols:
 * - 'uniswapv3': UniswapV3 concentrated liquidity position closer
 * - 'orca': Orca concentrated liquidity position closer (future)
 * - 'raydium': Raydium position closer (future)
 */
export type CloseOrderType = 'uniswapv3';

/**
 * Close order lifecycle status
 *
 * - pending: Order created in DB, not yet registered on-chain
 * - registering: Registration transaction in progress
 * - active: Order registered and actively monitoring price
 * - triggering: Price threshold met, execution in progress
 * - executed: Position successfully closed
 * - cancelled: Order cancelled by user
 * - expired: Order expired (validUntil passed)
 * - failed: Execution failed (see state.executionError)
 */
export type CloseOrderStatus =
  | 'pending'
  | 'registering'
  | 'active'
  | 'triggering'
  | 'executed'
  | 'cancelled'
  | 'expired'
  | 'failed';

/**
 * Contract configuration stored per-order (immutable at registration time)
 * Contains shared contract reference for this order
 */
export interface AutomationContractConfig {
  chainId: number;
  contractAddress: string;
  positionManager: string;
}

/**
 * JSON-serializable representation of a close order
 *
 * Used for API responses and database storage.
 */
export interface CloseOrderJSON {
  id: string;
  closeOrderType: CloseOrderType;
  status: CloseOrderStatus;
  positionId: string;
  automationContractConfig: AutomationContractConfig;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Base parameters for creating any close order
 */
export interface BaseCloseOrderParams {
  id: string;
  automationContractConfig: AutomationContractConfig;
  status: CloseOrderStatus;
  positionId: string;
  createdAt: Date;
  updatedAt: Date;
}
