/**
 * OHLC Effect Handlers
 *
 * Handles SUBSCRIBE_OHLC and UNSUBSCRIBE_OHLC effects by
 * managing RabbitMQ queue bindings for OHLC data routing.
 */

import type { Channel } from 'amqplib';
import type { Hex } from 'viem';
import { decodeAbiParameters, keccak256, toHex } from 'viem';
import {
  bindOhlcSubscription,
  unbindOhlcSubscription,
} from '../../mq/topology.js';
import type { EffectHandler, EffectHandlerResult } from './types.js';
import type { EffectRequestMessage } from '../../mq/messages.js';

// Effect type constants (must match Solidity definitions)
export const EFFECT_SUBSCRIBE_OHLC = keccak256(toHex('SUBSCRIBE_OHLC')) as Hex;
export const EFFECT_UNSUBSCRIBE_OHLC = keccak256(
  toHex('UNSUBSCRIBE_OHLC')
) as Hex;

/**
 * Decode OHLC subscription payload.
 *
 * Payload format: abi.encode(bytes32 symbol, uint32 timeframe)
 */
function decodeOhlcPayload(payload: Hex): { symbol: string; timeframe: number } {
  const [symbolBytes, timeframe] = decodeAbiParameters(
    [
      { type: 'bytes32', name: 'symbol' },
      { type: 'uint32', name: 'timeframe' },
    ],
    payload
  );

  // Convert bytes32 to string (trim null bytes)
  const symbol = Buffer.from(symbolBytes.slice(2), 'hex')
    .toString('utf8')
    .replace(/\0/g, '');

  return {
    symbol,
    timeframe: Number(timeframe),
  };
}

/**
 * Handler for SUBSCRIBE_OHLC effects.
 *
 * Creates a RabbitMQ binding from the OHLC routing key
 * to the strategy's events queue, enabling OHLC data delivery.
 */
export class OhlcSubscribeHandler implements EffectHandler {
  readonly effectType = EFFECT_SUBSCRIBE_OHLC;
  readonly name = 'SUBSCRIBE_OHLC';

  async handle(
    request: EffectRequestMessage,
    channel: Channel
  ): Promise<EffectHandlerResult> {
    const { symbol, timeframe } = decodeOhlcPayload(request.payload as Hex);

    // Create binding in RabbitMQ
    // Routing key format: ohlc.{symbol}.{timeframe}s
    await bindOhlcSubscription(
      channel,
      request.strategyAddress,
      symbol,
      `${timeframe}s`
    );

    console.log(
      `[OhlcHandler] Subscribed ${request.strategyAddress.slice(0, 10)}... ` +
        `to ${symbol}/${timeframe}s`
    );

    return {
      ok: true,
      data: '0x' as Hex,
    };
  }
}

/**
 * Handler for UNSUBSCRIBE_OHLC effects.
 *
 * Removes the RabbitMQ binding, stopping OHLC data delivery
 * for the specified symbol/timeframe.
 */
export class OhlcUnsubscribeHandler implements EffectHandler {
  readonly effectType = EFFECT_UNSUBSCRIBE_OHLC;
  readonly name = 'UNSUBSCRIBE_OHLC';

  async handle(
    request: EffectRequestMessage,
    channel: Channel
  ): Promise<EffectHandlerResult> {
    const { symbol, timeframe } = decodeOhlcPayload(request.payload as Hex);

    // Remove binding in RabbitMQ
    await unbindOhlcSubscription(
      channel,
      request.strategyAddress,
      symbol,
      `${timeframe}s`
    );

    console.log(
      `[OhlcHandler] Unsubscribed ${request.strategyAddress.slice(0, 10)}... ` +
        `from ${symbol}/${timeframe}s`
    );

    return {
      ok: true,
      data: '0x' as Hex,
    };
  }
}
