import type { Address, Hex, Log } from 'viem';
import type pino from 'pino';
import type { ISubscriptionStore } from './subscription-store.js';
import type { Subscription } from './types.js';
import { EventDecoder, SUBSCRIPTION_TYPES } from '../events/index.js';

/**
 * Callback invoked when a new subscription is added.
 * Used to notify data sources to start watching for the subscribed event.
 */
export type OnSubscriptionAddedCallback = (
  subscription: Subscription
) => Promise<void>;

/**
 * SubscriptionManager handles subscription lifecycle for strategies.
 *
 * Responsibilities:
 * - Process subscription/unsubscription events from callback execution
 * - Track which strategies are subscribed to which events
 * - Provide efficient lookup of subscribers for event routing
 * - Disable subscriptions when callbacks fail
 */
export class SubscriptionManager {
  private eventDecoder: EventDecoder;

  constructor(
    private store: ISubscriptionStore,
    private logger: pino.Logger,
    private onSubscriptionAdded?: OnSubscriptionAddedCallback
  ) {
    this.eventDecoder = new EventDecoder();
  }

  /**
   * Process logs from a callback execution to handle subscription events.
   * IMPORTANT: Processes events in order as emitted by the strategy.
   *
   * @param strategyAddress The strategy that emitted these events
   * @param logs The logs from the transaction receipt
   */
  async processLogs(strategyAddress: Address, logs: Log[]): Promise<void> {
    const decoded = this.eventDecoder.decodeAll(logs);

    for (const event of decoded) {
      if (event.type === 'SubscriptionRequested') {
        await this.handleSubscriptionRequested(
          strategyAddress,
          event.subscriptionType,
          event.payload
        );
      } else if (event.type === 'UnsubscriptionRequested') {
        await this.handleUnsubscriptionRequested(
          strategyAddress,
          event.subscriptionType,
          event.payload
        );
      }
      // Other event types (ActionRequested, LogMessage) are handled elsewhere
    }
  }

  /**
   * Handle a subscription request event
   */
  private async handleSubscriptionRequested(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<void> {
    const subscription = await this.store.add({
      strategyAddress,
      subscriptionType,
      payload,
    });

    this.logger.info(
      {
        strategy: strategyAddress,
        subscriptionType: this.getSubscriptionTypeName(subscriptionType),
        payloadHash: subscription.payloadHash,
      },
      'Subscription added'
    );

    // Notify data sources
    if (this.onSubscriptionAdded) {
      try {
        await this.onSubscriptionAdded(subscription);
      } catch (error) {
        this.logger.error(
          { error, subscription },
          'Failed to notify data source of new subscription'
        );
      }
    }
  }

  /**
   * Handle an unsubscription request event
   */
  private async handleUnsubscriptionRequested(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<void> {
    const removed = await this.store.remove(
      strategyAddress,
      subscriptionType,
      payload
    );

    if (removed) {
      this.logger.info(
        {
          strategy: strategyAddress,
          subscriptionType: this.getSubscriptionTypeName(subscriptionType),
        },
        'Subscription removed'
      );
    } else {
      this.logger.warn(
        {
          strategy: strategyAddress,
          subscriptionType: this.getSubscriptionTypeName(subscriptionType),
        },
        'Attempted to remove non-existent subscription'
      );
    }
  }

  /**
   * Get all strategies subscribed to a specific event
   * @param subscriptionType The subscription type
   * @param payload The subscription payload
   * @returns Array of strategy addresses
   */
  async getSubscribers(
    subscriptionType: Hex,
    payload: Hex
  ): Promise<Address[]> {
    return this.store.getSubscribers(subscriptionType, payload);
  }

  /**
   * Disable a subscription.
   * Used when a callback doesn't exist or consistently fails.
   *
   * @param strategyAddress The strategy address
   * @param subscriptionType The subscription type
   * @param payload The subscription payload
   */
  async disableSubscription(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<void> {
    const disabled = await this.store.disable(
      strategyAddress,
      subscriptionType,
      payload
    );

    if (disabled) {
      this.logger.warn(
        {
          strategy: strategyAddress,
          subscriptionType: this.getSubscriptionTypeName(subscriptionType),
        },
        'Subscription disabled due to callback failure'
      );
    }
  }

  /**
   * Enable a previously disabled subscription
   */
  async enableSubscription(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<void> {
    const enabled = await this.store.enable(
      strategyAddress,
      subscriptionType,
      payload
    );

    if (enabled) {
      this.logger.info(
        {
          strategy: strategyAddress,
          subscriptionType: this.getSubscriptionTypeName(subscriptionType),
        },
        'Subscription re-enabled'
      );
    }
  }

  /**
   * Get all subscriptions for a strategy
   */
  async getStrategySubscriptions(
    strategyAddress: Address
  ): Promise<Subscription[]> {
    return this.store.getByStrategy(strategyAddress);
  }

  /**
   * Get all active subscriptions
   */
  async getAllActiveSubscriptions(): Promise<Subscription[]> {
    return this.store.getAllActive();
  }

  /**
   * Check if a subscription exists
   */
  async hasSubscription(
    strategyAddress: Address,
    subscriptionType: Hex,
    payload: Hex
  ): Promise<boolean> {
    return this.store.exists(strategyAddress, subscriptionType, payload);
  }

  /**
   * Set the callback for when subscriptions are added.
   * Used by CoreOrchestrator to connect data sources.
   */
  setOnSubscriptionAdded(callback: OnSubscriptionAddedCallback): void {
    this.onSubscriptionAdded = callback;
  }

  /**
   * Get human-readable subscription type name
   */
  private getSubscriptionTypeName(subscriptionType: Hex): string {
    switch (subscriptionType) {
      case SUBSCRIPTION_TYPES.OHLC:
        return 'OHLC';
      case SUBSCRIPTION_TYPES.POOL:
        return 'Pool';
      case SUBSCRIPTION_TYPES.POSITION:
        return 'Position';
      case SUBSCRIPTION_TYPES.BALANCE:
        return 'Balance';
      default:
        return subscriptionType.slice(0, 10) + '...';
    }
  }
}
