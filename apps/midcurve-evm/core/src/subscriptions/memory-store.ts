import type { Address, Hex } from 'viem';
import { keccak256, encodePacked } from 'viem';
import type { ISubscriptionStore } from './subscription-store.js';
import type { Subscription, CreateSubscriptionParams } from './types.js';

/**
 * In-memory implementation of ISubscriptionStore.
 *
 * Uses Maps for efficient lookups:
 * - Primary key: strategy + subscriptionType + payloadHash
 * - Index by subscription type + payload (for getSubscribers)
 * - Index by strategy (for getByStrategy)
 */
export class MemorySubscriptionStore implements ISubscriptionStore {
  /** Primary storage: key -> Subscription */
  private subscriptions: Map<string, Subscription> = new Map();

  /** Index: subscriptionType:payloadHash -> Set<strategyAddress> */
  private byTypeAndPayload: Map<string, Set<Address>> = new Map();

  /** Index: strategyAddress -> Set<subscriptionKey> */
  private byStrategy: Map<Address, Set<string>> = new Map();

  /**
   * Generate a unique key for a subscription
   */
  private makeKey(
    strategyAddress: Address,
    subscriptionType: Hex,
    payloadHash: Hex
  ): string {
    return `${strategyAddress.toLowerCase()}:${subscriptionType}:${payloadHash}`;
  }

  /**
   * Generate a key for type+payload lookup
   */
  private makeTypePayloadKey(subscriptionType: Hex, payloadHash: Hex): string {
    return `${subscriptionType}:${payloadHash}`;
  }

  /**
   * Compute hash of subscription type and payload
   */
  private computePayloadHash(subscriptionType: Hex, payload: Hex): Hex {
    return keccak256(encodePacked(['bytes32', 'bytes'], [subscriptionType, payload]));
  }

  async add(params: CreateSubscriptionParams): Promise<Subscription> {
    const { strategyAddress, subscriptionType, payload } = params;
    const payloadHash = this.computePayloadHash(subscriptionType, payload);
    const key = this.makeKey(strategyAddress, subscriptionType, payloadHash);

    // Check if already exists
    const existing = this.subscriptions.get(key);
    if (existing) {
      // Re-enable if disabled
      if (!existing.active) {
        existing.active = true;
        existing.updatedAt = Date.now();
        this.addToIndexes(existing);
      }
      return existing;
    }

    // Create new subscription
    const now = Date.now();
    const subscription: Subscription = {
      strategyAddress,
      subscriptionType,
      payload,
      payloadHash,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    // Store in primary map
    this.subscriptions.set(key, subscription);

    // Add to indexes
    this.addToIndexes(subscription);

    return subscription;
  }

  async remove(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<boolean> {
    const payloadHash = this.computePayloadHash(subscriptionType, payload);
    const key = this.makeKey(strategyAddress, subscriptionType, payloadHash);

    const subscription = this.subscriptions.get(key);
    if (!subscription) {
      return false;
    }

    // Remove from indexes
    this.removeFromIndexes(subscription);

    // Remove from primary storage
    this.subscriptions.delete(key);

    return true;
  }

  async getSubscribers(subscriptionType: Hex, payload: Hex): Promise<Address[]> {
    const payloadHash = this.computePayloadHash(subscriptionType, payload);
    const typePayloadKey = this.makeTypePayloadKey(subscriptionType, payloadHash);

    const subscribers = this.byTypeAndPayload.get(typePayloadKey);
    if (!subscribers) {
      return [];
    }

    // Filter to only return active subscriptions
    const activeSubscribers: Address[] = [];
    for (const strategyAddress of subscribers) {
      const key = this.makeKey(strategyAddress, subscriptionType, payloadHash);
      const subscription = this.subscriptions.get(key);
      if (subscription?.active) {
        activeSubscribers.push(strategyAddress);
      }
    }

    return activeSubscribers;
  }

  async getByStrategy(strategyAddress: Address): Promise<Subscription[]> {
    const normalizedAddress = strategyAddress.toLowerCase() as Address;
    const keys = this.byStrategy.get(normalizedAddress);
    if (!keys) {
      return [];
    }

    const subscriptions: Subscription[] = [];
    for (const key of keys) {
      const subscription = this.subscriptions.get(key);
      if (subscription) {
        subscriptions.push(subscription);
      }
    }

    return subscriptions;
  }

  async disable(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<boolean> {
    const payloadHash = this.computePayloadHash(subscriptionType, payload);
    const key = this.makeKey(strategyAddress, subscriptionType, payloadHash);

    const subscription = this.subscriptions.get(key);
    if (!subscription) {
      return false;
    }

    if (subscription.active) {
      subscription.active = false;
      subscription.updatedAt = Date.now();
      // Note: We don't remove from indexes when disabling,
      // getSubscribers filters by active status
    }

    return true;
  }

  async enable(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<boolean> {
    const payloadHash = this.computePayloadHash(subscriptionType, payload);
    const key = this.makeKey(strategyAddress, subscriptionType, payloadHash);

    const subscription = this.subscriptions.get(key);
    if (!subscription) {
      return false;
    }

    if (!subscription.active) {
      subscription.active = true;
      subscription.updatedAt = Date.now();
    }

    return true;
  }

  async exists(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<boolean> {
    const payloadHash = this.computePayloadHash(subscriptionType, payload);
    const key = this.makeKey(strategyAddress, subscriptionType, payloadHash);
    return this.subscriptions.has(key);
  }

  async get(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<Subscription | null> {
    const payloadHash = this.computePayloadHash(subscriptionType, payload);
    const key = this.makeKey(strategyAddress, subscriptionType, payloadHash);
    return this.subscriptions.get(key) ?? null;
  }

  async getAllActive(): Promise<Subscription[]> {
    const active: Subscription[] = [];
    for (const subscription of this.subscriptions.values()) {
      if (subscription.active) {
        active.push(subscription);
      }
    }
    return active;
  }

  async clear(): Promise<void> {
    this.subscriptions.clear();
    this.byTypeAndPayload.clear();
    this.byStrategy.clear();
  }

  /**
   * Add subscription to indexes
   */
  private addToIndexes(subscription: Subscription): void {
    const { strategyAddress, subscriptionType, payloadHash } = subscription;
    const normalizedAddress = strategyAddress.toLowerCase() as Address;
    const key = this.makeKey(strategyAddress, subscriptionType, payloadHash);

    // Add to type+payload index
    const typePayloadKey = this.makeTypePayloadKey(subscriptionType, payloadHash);
    let typePayloadSet = this.byTypeAndPayload.get(typePayloadKey);
    if (!typePayloadSet) {
      typePayloadSet = new Set();
      this.byTypeAndPayload.set(typePayloadKey, typePayloadSet);
    }
    typePayloadSet.add(normalizedAddress);

    // Add to strategy index
    let strategySet = this.byStrategy.get(normalizedAddress);
    if (!strategySet) {
      strategySet = new Set();
      this.byStrategy.set(normalizedAddress, strategySet);
    }
    strategySet.add(key);
  }

  /**
   * Remove subscription from indexes
   */
  private removeFromIndexes(subscription: Subscription): void {
    const { strategyAddress, subscriptionType, payloadHash } = subscription;
    const normalizedAddress = strategyAddress.toLowerCase() as Address;
    const key = this.makeKey(strategyAddress, subscriptionType, payloadHash);

    // Remove from type+payload index
    const typePayloadKey = this.makeTypePayloadKey(subscriptionType, payloadHash);
    const typePayloadSet = this.byTypeAndPayload.get(typePayloadKey);
    if (typePayloadSet) {
      typePayloadSet.delete(normalizedAddress);
      if (typePayloadSet.size === 0) {
        this.byTypeAndPayload.delete(typePayloadKey);
      }
    }

    // Remove from strategy index
    const strategySet = this.byStrategy.get(normalizedAddress);
    if (strategySet) {
      strategySet.delete(key);
      if (strategySet.size === 0) {
        this.byStrategy.delete(normalizedAddress);
      }
    }
  }
}
