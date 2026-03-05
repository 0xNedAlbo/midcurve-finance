/**
 * RabbitMQ Topology Setup
 *
 * Declares topic exchanges for onchain data events:
 * - pool-prices: Pool swap events (price updates)
 * - close-order-events: Close order lifecycle events
 *
 * All operations are idempotent - safe to call multiple times.
 *
 * Topic exchange allows flexible routing:
 * - `uniswapv3.1.*` - All Ethereum mainnet events
 * - `uniswapv3.*.0x8ad5...` - Specific pool across all chains
 * - `uniswapv3.#` - All UniswapV3 events
 */

import type { Channel } from 'amqplib';
import {
  EXCHANGE_CLOSE_ORDER_EVENTS,
  buildCloseOrderRoutingKey,
} from '@midcurve/services';
import { onchainDataLogger } from '../lib/logger';

const log = onchainDataLogger.child({ component: 'Topology' });

// ============================================================
// Constants
// ============================================================

/** Exchange name for pool prices (Swap events) */
export const EXCHANGE_POOL_PRICES = 'pool-prices';

// Re-export close order topology from @midcurve/services
export { EXCHANGE_CLOSE_ORDER_EVENTS, buildCloseOrderRoutingKey };

/**
 * Build a routing key for UniswapV3 swap events.
 * Format: uniswapv3.{chainId}.{poolAddress}
 */
export function buildUniswapV3RoutingKey(chainId: number, poolAddress: string): string {
  return `uniswapv3.${chainId}.${poolAddress.toLowerCase()}`;
}

// ============================================================
// Topology Setup
// ============================================================

/**
 * Setup onchain data topology.
 * Called once on service startup.
 *
 * Creates:
 * - pool-prices (topic exchange) - for Swap events
 * - close-order-events (topic exchange) - for close order lifecycle events
 *
 * Note: No queues are created here. Consumers will create their own
 * queues and bind them with appropriate routing key patterns.
 */
export async function setupOnchainDataTopology(channel: Channel): Promise<void> {
  log.info({ msg: 'Setting up onchain data topology...' });

  // Create pool-prices topic exchange
  await channel.assertExchange(EXCHANGE_POOL_PRICES, 'topic', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGE_POOL_PRICES, type: 'topic', msg: 'Exchange declared' });

  // Create close-order-events topic exchange
  await channel.assertExchange(EXCHANGE_CLOSE_ORDER_EVENTS, 'topic', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGE_CLOSE_ORDER_EVENTS, type: 'topic', msg: 'Exchange declared' });

  log.info({ msg: 'Onchain data topology setup complete' });
}

/**
 * @deprecated Use setupOnchainDataTopology instead. Kept for backward compatibility.
 */
export const setupPoolPricesTopology = setupOnchainDataTopology;

/**
 * Verify onchain data topology exists.
 */
export async function verifyOnchainDataTopology(channel: Channel): Promise<boolean> {
  try {
    await channel.checkExchange(EXCHANGE_POOL_PRICES);
    await channel.checkExchange(EXCHANGE_CLOSE_ORDER_EVENTS);
    return true;
  } catch {
    return false;
  }
}

/**
 * @deprecated Use verifyOnchainDataTopology instead. Kept for backward compatibility.
 */
export const verifyPoolPricesTopology = verifyOnchainDataTopology;
