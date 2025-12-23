/**
 * LOG Effect Handler
 *
 * Handles LOG effects by:
 * 1. Decoding the payload
 * 2. Printing to console with formatting
 * 3. Persisting to database for later retrieval
 *
 * Supports custom log topics defined in strategy manifests.
 * Topic names are resolved using the manifest's logTopics field.
 */

import type { Hex } from 'viem';
import {
  EFFECT_LOG,
  decodeLogPayload,
  executeLogEffect,
  decodeLogMessage,
  resolveTopicName,
  buildTopicRegistry,
} from '../../poc/effect-parser';
import type { EffectHandler, EffectHandlerResult } from './types';
import type { EffectRequestMessage } from '../../mq/messages';
import { getDatabaseClient } from '../../clients/database-client';
import { logger } from '../../../../lib/logger';

const log = logger.child({ handler: 'LogEffectHandler' });

/**
 * Cache for per-strategy topic registries.
 * Maps strategy address → topic registry (Map<Hex, string>)
 */
const topicRegistryCache = new Map<string, Map<Hex, string>>();

/**
 * Handler for LOG effects.
 *
 * LOG effects are used for durable logging from strategies.
 * The payload contains:
 * - level: uint8 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * - topic: bytes32 (keccak256 hash identifying the log topic)
 * - data: bytes (abi.encode(string) - the log message)
 *
 * Custom topics are supported through the strategy manifest's logTopics field.
 * When a log with a custom topic is received, the handler looks up the
 * topic name from the manifest and displays it instead of the raw hash.
 *
 * The handler:
 * 1. Loads strategy manifest and builds topic registry (cached per strategy)
 * 2. Decodes and prints the log to console (immediate feedback)
 * 3. Persists to database asynchronously (durable storage)
 * 4. Returns empty result (logs don't return data to strategy)
 */
export class LogEffectHandler implements EffectHandler {
  readonly effectType = EFFECT_LOG;
  readonly name = 'LOG';

  async handle(request: EffectRequestMessage): Promise<EffectHandlerResult> {
    // Decode the log payload
    const logPayload = decodeLogPayload(request.payload as Hex);

    // Get or build topic registry for this strategy
    const topicRegistry = await this.getTopicRegistry(request.strategyAddress);

    // Execute the log (prints to console with formatting)
    executeLogEffect(logPayload, topicRegistry);

    // Persist to database asynchronously (fire-and-forget)
    this.persistLog(request, logPayload, topicRegistry).catch((error) => {
      log.error({
        strategyAddress: request.strategyAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Failed to persist log (non-fatal)',
      });
    });

    // LOG effects return empty data
    return {
      ok: true,
      data: '0x' as Hex,
    };
  }

  /**
   * Get or build topic registry for a strategy.
   * Caches the registry for subsequent calls.
   */
  private async getTopicRegistry(strategyAddress: string): Promise<Map<Hex, string>> {
    // Check cache first
    const cached = topicRegistryCache.get(strategyAddress.toLowerCase());
    if (cached) {
      return cached;
    }

    // Load strategy and build registry from manifest
    const dbClient = getDatabaseClient();
    const strategy = await dbClient.getStrategyByAddress(
      strategyAddress as `0x${string}`
    );

    let registry: Map<Hex, string>;
    if (strategy?.manifest && typeof strategy.manifest === 'object') {
      const manifest = strategy.manifest as { logTopics?: Record<string, string> };
      registry = buildTopicRegistry(manifest.logTopics);
    } else {
      // No manifest or no logTopics - use base registry
      registry = buildTopicRegistry();
    }

    // Cache for future use
    topicRegistryCache.set(strategyAddress.toLowerCase(), registry);

    return registry;
  }

  /**
   * Persist log to database
   */
  private async persistLog(
    request: EffectRequestMessage,
    logPayload: { level: number; topic: Hex; data: Hex },
    topicRegistry: Map<Hex, string>
  ): Promise<void> {
    const dbClient = getDatabaseClient();

    // Look up strategy ID from contract address
    const strategy = await dbClient.getStrategyByAddress(
      request.strategyAddress as `0x${string}`
    );

    if (!strategy) {
      log.warn({
        strategyAddress: request.strategyAddress,
        msg: 'Strategy not found for log persistence',
      });
      return;
    }

    // Resolve topic name using the registry (includes custom topics)
    const topicName = resolveTopicName(logPayload.topic, topicRegistry);

    // Decode log message (always abi.encode(string))
    const dataDecoded = decodeLogMessage(logPayload.data);

    await dbClient.createStrategyLog({
      strategyId: strategy.id,
      contractAddress: request.strategyAddress,
      epoch: BigInt(request.epoch),
      correlationId: request.correlationId,
      level: logPayload.level,
      topic: logPayload.topic,
      topicName,
      data: logPayload.data,
      dataDecoded,
      timestamp: new Date(request.requestedAt),
    });
  }

  /**
   * Clear the topic registry cache for a specific strategy.
   * Call this when a strategy is redeployed or its manifest changes.
   */
  static clearCacheForStrategy(strategyAddress: string): void {
    topicRegistryCache.delete(strategyAddress.toLowerCase());
  }

  /**
   * Clear the entire topic registry cache.
   */
  static clearCache(): void {
    topicRegistryCache.clear();
  }
}
