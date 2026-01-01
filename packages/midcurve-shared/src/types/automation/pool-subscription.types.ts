/**
 * Pool Price Subscription Types
 *
 * Type definitions for pool price monitoring subscriptions.
 * Used by the automation service to track which pools need WebSocket subscriptions.
 */

/**
 * Pool price subscription state
 *
 * Contains the last known price state for a pool.
 * Updated on each Swap event received via WebSocket.
 */
export interface PoolPriceSubscriptionState {
  /**
   * Last known sqrtPriceX96 from Swap event
   * Stored as string for JSON serialization
   */
  lastSqrtPriceX96: string;

  /**
   * Last known tick from Swap event
   */
  lastTick: number;

  /**
   * Timestamp of last price update
   */
  lastUpdatedAt: string;
}

/**
 * Pool price subscription data
 *
 * Represents a subscription to monitor a pool's price for automation.
 */
export interface PoolPriceSubscriptionData {
  id: string;
  poolId: string;
  isActive: boolean;
  activeOrderCount: number;
  state: PoolPriceSubscriptionState;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * JSON-serializable representation of a pool subscription
 *
 * Used for API responses and database storage.
 */
export interface PoolPriceSubscriptionJSON {
  id: string;
  poolId: string;
  isActive: boolean;
  activeOrderCount: number;
  state: PoolPriceSubscriptionState;
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert pool subscription to JSON-safe representation
 */
export function poolSubscriptionToJSON(
  subscription: PoolPriceSubscriptionData
): PoolPriceSubscriptionJSON {
  return {
    id: subscription.id,
    poolId: subscription.poolId,
    isActive: subscription.isActive,
    activeOrderCount: subscription.activeOrderCount,
    state: subscription.state,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

/**
 * Create pool subscription from JSON representation
 */
export function poolSubscriptionFromJSON(
  json: PoolPriceSubscriptionJSON
): PoolPriceSubscriptionData {
  return {
    id: json.id,
    poolId: json.poolId,
    isActive: json.isActive,
    activeOrderCount: json.activeOrderCount,
    state: json.state,
    createdAt: new Date(json.createdAt),
    updatedAt: new Date(json.updatedAt),
  };
}

/**
 * Create an empty subscription state
 */
export function emptySubscriptionState(): PoolPriceSubscriptionState {
  return {
    lastSqrtPriceX96: '0',
    lastTick: 0,
    lastUpdatedAt: new Date().toISOString(),
  };
}
