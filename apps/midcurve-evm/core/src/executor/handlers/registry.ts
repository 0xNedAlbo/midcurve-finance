/**
 * Effect Handler Registry
 *
 * Manages registration and lookup of effect handlers.
 * Handlers are registered by effect type (bytes32 hash).
 */

import type { Hex } from 'viem';
import type { EffectHandler } from './types';
import { LogEffectHandler } from './log-handler';
import { OhlcSubscribeHandler, OhlcUnsubscribeHandler } from './ohlc-handler';
import { UseFundsHandler, ReturnFundsHandler } from './funding-handler';

/**
 * Registry for effect handlers.
 *
 * Provides a centralized place to register and lookup handlers
 * based on effect type. Default handlers are registered automatically.
 */
export class EffectHandlerRegistry {
  private handlers = new Map<Hex, EffectHandler>();

  constructor() {
    // Register default handlers
    this.register(new LogEffectHandler());
    this.register(new OhlcSubscribeHandler());
    this.register(new OhlcUnsubscribeHandler());

    // Register funding handlers
    this.register(new UseFundsHandler());
    this.register(new ReturnFundsHandler());
  }

  /**
   * Register a handler for an effect type.
   *
   * @param handler The handler to register
   * @throws Error if a handler is already registered for the effect type
   */
  register(handler: EffectHandler): void {
    if (this.handlers.has(handler.effectType)) {
      throw new Error(
        `Handler already registered for effect type: ${handler.effectType}`
      );
    }
    this.handlers.set(handler.effectType, handler);
    console.log(
      `[Registry] Registered handler: ${handler.name} ` +
        `(${handler.effectType.slice(0, 10)}...)`
    );
  }

  /**
   * Get a handler for an effect type.
   *
   * @param effectType The effect type (bytes32 hash)
   * @returns The handler, or undefined if not registered
   */
  get(effectType: Hex): EffectHandler | undefined {
    return this.handlers.get(effectType);
  }

  /**
   * Check if a handler is registered for an effect type.
   *
   * @param effectType The effect type (bytes32 hash)
   * @returns true if a handler is registered
   */
  has(effectType: Hex): boolean {
    return this.handlers.has(effectType);
  }

  /**
   * List all registered handlers.
   *
   * @returns Array of registered handlers
   */
  list(): EffectHandler[] {
    return Array.from(this.handlers.values());
  }

  /**
   * Get the number of registered handlers.
   */
  get size(): number {
    return this.handlers.size;
  }
}
