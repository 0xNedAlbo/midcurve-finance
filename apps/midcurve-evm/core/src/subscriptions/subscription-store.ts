import type { Address, Hex } from 'viem';
import type { Subscription, CreateSubscriptionParams } from './types.js';

/**
 * Interface for subscription storage.
 *
 * This interface allows for different storage implementations:
 * - MemorySubscriptionStore: In-memory storage for development/testing
 * - DatabaseSubscriptionStore: PostgreSQL/other DB for production (future)
 */
export interface ISubscriptionStore {
  /**
   * Add a new subscription
   * @param params The subscription parameters
   * @returns The created subscription
   */
  add(params: CreateSubscriptionParams): Promise<Subscription>;

  /**
   * Remove a subscription
   * @param strategyAddress The strategy that owns the subscription
   * @param subscriptionType The type of subscription
   * @param payload The subscription payload
   * @returns true if removed, false if not found
   */
  remove(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<boolean>;

  /**
   * Get all active subscribers for a specific event
   * @param subscriptionType The type of subscription
   * @param payload The subscription payload
   * @returns Array of strategy addresses subscribed to this event
   */
  getSubscribers(subscriptionType: Hex, payload: Hex): Promise<Address[]>;

  /**
   * Get all subscriptions for a strategy
   * @param strategyAddress The strategy address
   * @returns Array of subscriptions for this strategy
   */
  getByStrategy(strategyAddress: Address): Promise<Subscription[]>;

  /**
   * Disable a subscription (mark inactive without deleting)
   * Used when a callback doesn't exist or consistently fails
   * @param strategyAddress The strategy address
   * @param subscriptionType The type of subscription
   * @param payload The subscription payload
   * @returns true if disabled, false if not found
   */
  disable(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<boolean>;

  /**
   * Enable a previously disabled subscription
   * @param strategyAddress The strategy address
   * @param subscriptionType The type of subscription
   * @param payload The subscription payload
   * @returns true if enabled, false if not found
   */
  enable(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<boolean>;

  /**
   * Check if a subscription exists (active or inactive)
   * @param strategyAddress The strategy address
   * @param subscriptionType The type of subscription
   * @param payload The subscription payload
   * @returns true if exists, false otherwise
   */
  exists(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<boolean>;

  /**
   * Get a specific subscription
   * @param strategyAddress The strategy address
   * @param subscriptionType The type of subscription
   * @param payload The subscription payload
   * @returns The subscription or null if not found
   */
  get(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<Subscription | null>;

  /**
   * Get all active subscriptions
   * @returns Array of all active subscriptions
   */
  getAllActive(): Promise<Subscription[]>;

  /**
   * Clear all subscriptions (useful for testing)
   */
  clear(): Promise<void>;
}
