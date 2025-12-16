/**
 * LOG Effect Handler
 *
 * Handles LOG effects by decoding the payload and printing
 * to the console with appropriate formatting.
 */

import type { Hex } from 'viem';
import {
  EFFECT_LOG,
  decodeLogPayload,
  executeLogEffect,
} from '../../poc/effect-parser.js';
import type { EffectHandler, EffectHandlerResult } from './types.js';
import type { EffectRequestMessage } from '../../mq/messages.js';

/**
 * Handler for LOG effects.
 *
 * LOG effects are used for durable logging from strategies.
 * The payload contains:
 * - level: uint8 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * - topic: bytes32 (keccak256 hash identifying the log topic)
 * - data: bytes (arbitrary encoded data)
 *
 * The handler decodes and prints the log, then returns an empty result.
 */
export class LogEffectHandler implements EffectHandler {
  readonly effectType = EFFECT_LOG;
  readonly name = 'LOG';

  async handle(request: EffectRequestMessage): Promise<EffectHandlerResult> {
    // Decode the log payload
    const logPayload = decodeLogPayload(request.payload as Hex);

    // Execute the log (prints to console with formatting)
    executeLogEffect(logPayload);

    // LOG effects return empty data
    return {
      ok: true,
      data: '0x' as Hex,
    };
  }
}
