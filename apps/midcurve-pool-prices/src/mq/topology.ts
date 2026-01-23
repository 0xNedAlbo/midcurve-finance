/**
 * RabbitMQ Topology Setup
 *
 * Declares the pool-prices topic exchange for flexible routing.
 * All operations are idempotent - safe to call multiple times.
 *
 * Topic exchange allows flexible routing:
 * - `uniswapv3.1.*` - All Ethereum mainnet pools
 * - `uniswapv3.*.0x8ad5...` - Specific pool across all chains
 * - `uniswapv3.#` - All UniswapV3 events
 */

import type { Channel } from 'amqplib';
import { poolPricesLogger } from '../lib/logger';

const log = poolPricesLogger.child({ component: 'Topology' });

// ============================================================
// Constants
// ============================================================

/** Exchange name for pool prices */
export const EXCHANGE_POOL_PRICES = 'pool-prices';

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
 * Setup pool prices topology.
 * Called once on service startup.
 *
 * Creates:
 * - pool-prices (topic exchange)
 *
 * Note: No queues are created here. Consumers will create their own
 * queues and bind them with appropriate routing key patterns.
 */
export async function setupPoolPricesTopology(channel: Channel): Promise<void> {
  log.info({ msg: 'Setting up pool prices topology...' });

  // Create topic exchange for flexible routing
  await channel.assertExchange(EXCHANGE_POOL_PRICES, 'topic', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGE_POOL_PRICES, type: 'topic', msg: 'Exchange declared' });

  log.info({ msg: 'Pool prices topology setup complete' });
}

/**
 * Verify pool prices topology exists.
 */
export async function verifyPoolPricesTopology(channel: Channel): Promise<boolean> {
  try {
    await channel.checkExchange(EXCHANGE_POOL_PRICES);
    return true;
  } catch {
    return false;
  }
}
