import type { Address, Hex } from 'viem';

/**
 * Represents a subscription from a strategy to an event type
 */
export interface Subscription {
  /** The strategy contract address */
  strategyAddress: Address;

  /** The subscription type (e.g., OHLC, Pool, Position, Balance) */
  subscriptionType: Hex;

  /** The subscription payload (e.g., encoded marketId + timeframe for OHLC) */
  payload: Hex;

  /** Hash of subscriptionType + payload for efficient lookups */
  payloadHash: Hex;

  /** Whether the subscription is currently active */
  active: boolean;

  /** When the subscription was created */
  createdAt: number;

  /** When the subscription was last updated */
  updatedAt: number;
}

/**
 * Parameters for creating a new subscription
 */
export interface CreateSubscriptionParams {
  strategyAddress: Address;
  subscriptionType: Hex;
  payload: Hex;
}

/**
 * Parameters for looking up subscribers
 */
export interface SubscriberLookupParams {
  subscriptionType: Hex;
  payload: Hex;
}
