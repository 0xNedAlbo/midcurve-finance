/**
 * RabbitMQ Topology Setup
 *
 * Declares topic exchanges for onchain data events:
 * - pool-prices: Pool swap events (price updates)
 * - position-liquidity-events: Position liquidity events (IncreaseLiquidity, DecreaseLiquidity, Collect)
 *
 * All operations are idempotent - safe to call multiple times.
 *
 * Topic exchange allows flexible routing:
 * - `uniswapv3.1.*` - All Ethereum mainnet events
 * - `uniswapv3.*.0x8ad5...` - Specific pool across all chains
 * - `uniswapv3.#` - All UniswapV3 events
 */

import type { Channel } from 'amqplib';
import { onchainDataLogger } from '../lib/logger';

const log = onchainDataLogger.child({ component: 'Topology' });

// ============================================================
// Constants
// ============================================================

/** Exchange name for pool prices (Swap events) */
export const EXCHANGE_POOL_PRICES = 'pool-prices';

/** Exchange name for position liquidity events (IncreaseLiquidity, DecreaseLiquidity, Collect) */
export const EXCHANGE_POSITION_LIQUIDITY = 'position-liquidity-events';

/** Exchange name for close order lifecycle events (registration, cancellation, config updates) */
export const EXCHANGE_CLOSE_ORDER_EVENTS = 'close-order-events';

/**
 * Build a routing key for UniswapV3 swap events.
 * Format: uniswapv3.{chainId}.{poolAddress}
 */
export function buildUniswapV3RoutingKey(chainId: number, poolAddress: string): string {
  return `uniswapv3.${chainId}.${poolAddress.toLowerCase()}`;
}

/**
 * Build a routing key for position liquidity events.
 * Format: uniswapv3.{chainId}.{nftId}
 */
export function buildPositionLiquidityRoutingKey(chainId: number, nftId: string): string {
  return `uniswapv3.${chainId}.${nftId}`;
}

/**
 * Build a routing key for close order lifecycle events.
 * Format: closer.{chainId}.{nftId}.{triggerMode}
 */
export function buildCloseOrderRoutingKey(chainId: number, nftId: string, triggerMode: string): string {
  return `closer.${chainId}.${nftId}.${triggerMode}`;
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
 * - position-liquidity-events (topic exchange) - for position events
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

  // Create position-liquidity-events topic exchange
  await channel.assertExchange(EXCHANGE_POSITION_LIQUIDITY, 'topic', {
    durable: true,
    autoDelete: false,
  });
  log.info({ exchange: EXCHANGE_POSITION_LIQUIDITY, type: 'topic', msg: 'Exchange declared' });

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
    await channel.checkExchange(EXCHANGE_POSITION_LIQUIDITY);
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
