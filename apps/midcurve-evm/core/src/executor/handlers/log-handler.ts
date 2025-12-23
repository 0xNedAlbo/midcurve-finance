/**
 * LOG Effect Handler
 *
 * Handles LOG effects by:
 * 1. Decoding the payload
 * 2. Printing to console with formatting
 * 3. Persisting to database for later retrieval
 */

import type { Hex } from 'viem';
import {
  EFFECT_LOG,
  decodeLogPayload,
  executeLogEffect,
  KNOWN_TOPICS,
} from '../../poc/effect-parser';
import type { EffectHandler, EffectHandlerResult } from './types';
import type { EffectRequestMessage } from '../../mq/messages';
import { getDatabaseClient } from '../../clients/database-client';
import { logger } from '../../../../lib/logger';

const log = logger.child({ handler: 'LogEffectHandler' });

/**
 * Handler for LOG effects.
 *
 * LOG effects are used for durable logging from strategies.
 * The payload contains:
 * - level: uint8 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * - topic: bytes32 (keccak256 hash identifying the log topic)
 * - data: bytes (arbitrary encoded data)
 *
 * The handler:
 * 1. Decodes and prints the log to console (immediate feedback)
 * 2. Persists to database asynchronously (durable storage)
 * 3. Returns empty result (logs don't return data to strategy)
 */
export class LogEffectHandler implements EffectHandler {
  readonly effectType = EFFECT_LOG;
  readonly name = 'LOG';

  async handle(request: EffectRequestMessage): Promise<EffectHandlerResult> {
    // Decode the log payload
    const logPayload = decodeLogPayload(request.payload as Hex);

    // Execute the log (prints to console with formatting)
    executeLogEffect(logPayload);

    // Persist to database asynchronously (fire-and-forget)
    this.persistLog(request, logPayload).catch((error) => {
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
   * Persist log to database
   */
  private async persistLog(
    request: EffectRequestMessage,
    logPayload: { level: number; topic: Hex; data: Hex }
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

    // Resolve topic name if known
    const topicName = KNOWN_TOPICS[logPayload.topic];

    await dbClient.createStrategyLog({
      strategyId: strategy.id,
      contractAddress: request.strategyAddress,
      epoch: BigInt(request.epoch),
      correlationId: request.correlationId,
      level: logPayload.level,
      topic: logPayload.topic,
      topicName,
      data: logPayload.data,
      dataDecoded: undefined, // Could add decoding logic later
      timestamp: new Date(request.requestedAt),
    });
  }
}
