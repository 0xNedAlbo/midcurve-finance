/**
 * SEMSEE Core - Single-EVM Multi-Strategy Execution Environment
 *
 * Main entry point for the core orchestrator package.
 */

// Orchestrator
export { CoreOrchestrator } from './orchestrator/index.js';
export type {
  OrchestratorConfig,
  MailboxStats,
  OhlcTimeframe,
} from './orchestrator/index.js';
export { OHLC_TIMEFRAMES } from './orchestrator/index.js';

// VM Runner
export { VmRunner, semseeChain, DEFAULT_RPC_CONFIG } from './vm/index.js';
export type { VmRunnerConfig, CallResult, DeployResult, StoreAddresses } from './vm/index.js';

// Events
export { EventDecoder, EVENT_TOPICS, SUBSCRIPTION_TYPES, ACTION_TYPES } from './events/index.js';
export type {
  DecodedEvent,
  DecodeResult,
  SubscriptionRequestedEvent,
  UnsubscriptionRequestedEvent,
  ActionRequestedEvent,
  LogMessageEvent,
} from './events/index.js';

// Subscriptions
export {
  SubscriptionManager,
  MemorySubscriptionStore,
} from './subscriptions/index.js';
export type {
  ISubscriptionStore,
  Subscription,
  OnSubscriptionAddedCallback,
} from './subscriptions/index.js';

// Stores
export { StoreSynchronizer } from './stores/index.js';
export type {
  PoolState,
  PositionState,
  BalanceEntry,
  ExternalEvent,
  OhlcEvent,
  PoolEvent,
  PositionEvent,
  BalanceEvent,
  OhlcCandle,
} from './stores/index.js';

// Effects
export { EffectEngine, MockEffectExecutor } from './effects/index.js';
export type {
  IEffectExecutor,
  QueuedAction,
  EffectResult,
} from './effects/index.js';

// Utilities
export { createLogger, LogLevel, getLogMethod } from './utils/logger.js';
export {
  CORE_ADDRESS,
  SYSTEM_REGISTRY_ADDRESS,
  GAS_LIMITS,
  TIMEFRAMES,
} from './utils/addresses.js';

// ABIs
export {
  SYSTEM_REGISTRY_ABI,
  POOL_STORE_ABI,
  POSITION_STORE_ABI,
  BALANCE_STORE_ABI,
} from './abi/index.js';
