/**
 * WebSocket Connection Manager
 *
 * This module re-exports WebSocket-related utilities from providers.
 * Connection handling is managed internally by viem's WebSocket transport.
 *
 * For UniswapV3 pool subscriptions, see ./providers/uniswap-v3-pools.ts
 * For NFPM position subscriptions, see ./providers/uniswap-v3-nfpm.ts
 */

// Pool price subscriptions (Swap events)
export {
  UniswapV3PoolSubscriptionBatch,
  createSubscriptionBatches,
  MAX_POOLS_PER_SUBSCRIPTION,
  SWAP_EVENT_TOPIC,
  type PoolInfo,
} from './providers/uniswap-v3-pools';

// Position liquidity subscriptions (NFPM events)
export {
  UniswapV3NfpmSubscriptionBatch,
  createUniswapV3NfpmSubscriptionBatches,
  MAX_POSITIONS_PER_SUBSCRIPTION,
  type PositionInfo,
} from './providers/uniswap-v3-nfpm';

// Close order lifecycle subscriptions (UniswapV3PositionCloser events)
export {
  UniswapV3CloserSubscriptionBatch,
  createCloserSubscriptionBatches,
  MAX_CONTRACTS_PER_SUBSCRIPTION,
  type CloserContractInfo,
} from './providers/uniswap-v3-closer';

// NFPM Transfer subscriptions (ERC-721 Transfer events for mint/burn/transfer)
export {
  UniswapV3NfpmTransferSubscriptionBatch,
  createNfpmTransferSubscriptionBatches,
  MAX_WALLETS_PER_SUBSCRIPTION,
} from './providers/uniswap-v3-nfpm-transfer';
