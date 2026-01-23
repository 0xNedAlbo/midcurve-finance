/**
 * WebSocket Connection Manager
 *
 * This module re-exports WebSocket-related utilities from providers.
 * Connection handling is managed internally by viem's WebSocket transport.
 *
 * For UniswapV3 subscriptions, see ./providers/uniswap-v3.ts
 */

export {
  UniswapV3SubscriptionBatch,
  createSubscriptionBatches,
  MAX_POOLS_PER_SUBSCRIPTION,
  SWAP_EVENT_TOPIC,
  type PoolInfo,
} from './providers/uniswap-v3';
