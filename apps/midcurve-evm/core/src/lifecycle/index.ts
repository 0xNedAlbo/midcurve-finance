/**
 * Lifecycle module - Strategy lifecycle management with EIP-712 signatures
 *
 * This module provides the API for handling signed start/shutdown requests.
 * Users sign on Ethereum mainnet (chainId: 1), automation wallet executes on SEMSEE.
 */

export {
  // API class
  StrategyLifecycleApi,

  // EIP-712 constants
  LIFECYCLE_DOMAIN,
  START_TYPES,
  SHUTDOWN_TYPES,

  // Message types
  type StartMessage,
  type ShutdownMessage,
  type SignedStartRequest,
  type SignedShutdownRequest,
  type VerifiedLifecycleRequest,
  type LifecycleResult,

  // Callback types
  type GetStrategyOwnerCallback,
  type ExecuteStartCallback,
  type ExecuteShutdownCallback,

  // Helper functions
  createStartMessage,
  createShutdownMessage,
  signStartMessage,
  signShutdownMessage,
  hashStartMessage,
  hashShutdownMessage,
} from './strategy-lifecycle-api.js';
