// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseStrategy } from "../BaseStrategy.sol";

/// @notice LifecycleMixin implements START / SHUTDOWN as lifecycle commands.
/// - Lifecycle commands are delivered via STEP_EVENT_LIFECYCLE (dedicated event type).
/// - This mixin manages a minimal onchain lifecycle state and calls hooks.
/// - Lifecycle is mandatory for all strategies (unlike custom actions).
///
/// Core enforcement (offchain):
/// - After SHUTDOWN is requested, core stops feeding normal market events,
///   and removes the strategy from all core-managed subscriptions.
/// - The strategy still performs graceful cleanup via effects during SHUTTING_DOWN.
///
/// Lifecycle commands (bytes32):
/// - keccak256("START")
/// - keccak256("SHUTDOWN")
abstract contract LifecycleMixin is BaseStrategy {
  // =============================================================
  // Constants
  // =============================================================

  /// @dev Event type for lifecycle commands (separate from custom actions)
  bytes32 internal constant STEP_EVENT_LIFECYCLE = keccak256("STEP_EVENT_LIFECYCLE");

  /// @dev Envelope version for lifecycle event payload layout
  uint32 internal constant LIFECYCLE_EVENT_VERSION = 1;

  /// @dev Lifecycle command: start the strategy
  bytes32 internal constant LIFECYCLE_START = keccak256("START");

  /// @dev Lifecycle command: graceful shutdown
  bytes32 internal constant LIFECYCLE_SHUTDOWN = keccak256("SHUTDOWN");

  // =============================================================
  // State
  // =============================================================

  enum LifecycleStatus {
    DEPLOYED,        // (0) Initial state after deployment (was STOPPED)
    STARTING,        // (1) START event received, onStart() processing
    ACTIVE,          // (2) Fully running (was RUNNING)
    SHUTTING_DOWN,   // (3) SHUTDOWN event received, cleanup in progress
    SHUTDOWN         // (4) Final state
  }

  LifecycleStatus public lifecycleStatus;

  // =============================================================
  // Errors
  // =============================================================

  error AlreadyStarting();
  error AlreadyActive();
  error NotActive();
  error AlreadyShuttingDown();
  error AlreadyShutdown();
  error UnsupportedLifecycleVersion(uint32 got);
  error UnknownLifecycleCommand(bytes32 command);

  // =============================================================
  // Lifecycle Hooks (override in strategy)
  // =============================================================

  /// @notice Hook called when the strategy is starting (STARTING state).
  /// @dev Put initialization logic here; may request effects via _awaitEffect(...).
  /// After this hook completes (including any effects), strategy transitions to ACTIVE.
  function onStart() internal virtual {}

  /// @notice Hook called when shutdown is requested.
  /// @dev Should initiate cleanup; may request effects via _awaitEffect(...).
  /// You should usually set internal flags so that subsequent steps keep progressing cleanup.
  function onShutdownRequested() internal virtual {}

  /// @notice Hook called on every step while SHUTTING_DOWN.
  /// @dev Use this to continue cleanup across multiple steps/effects until ready to finalize.
  /// Return true when cleanup is complete and lifecycle can transition to SHUTDOWN.
  function onShutdownStep() internal virtual returns (bool done) { done; return true; }

  /// @notice Hook called exactly once when shutdown completes (transition to SHUTDOWN).
  function onShutdownComplete() internal virtual {}

  // =============================================================
  // Lifecycle State Helpers
  // =============================================================

  /// @dev Revert if strategy is not in ACTIVE state. Useful for gating event handlers.
  function _requireActive() internal view {
    if (lifecycleStatus != LifecycleStatus.ACTIVE) revert NotActive();
  }

  function _isDeployed() internal view returns (bool) {
    return lifecycleStatus == LifecycleStatus.DEPLOYED;
  }

  function _isStarting() internal view returns (bool) {
    return lifecycleStatus == LifecycleStatus.STARTING;
  }

  function _isActive() internal view returns (bool) {
    return lifecycleStatus == LifecycleStatus.ACTIVE;
  }

  function _isShuttingDown() internal view returns (bool) {
    return lifecycleStatus == LifecycleStatus.SHUTTING_DOWN;
  }

  function _isShutdown() internal view returns (bool) {
    return lifecycleStatus == LifecycleStatus.SHUTDOWN;
  }

  // =============================================================
  // Lifecycle Command Handling
  // =============================================================

  /// @dev Handle a lifecycle command (START or SHUTDOWN).
  /// State machine: DEPLOYED -> STARTING -> ACTIVE -> SHUTTING_DOWN -> SHUTDOWN
  function _handleLifecycleCommand(bytes32 command) internal {
    if (command == LIFECYCLE_START) {
      if (lifecycleStatus == LifecycleStatus.STARTING) revert AlreadyStarting();
      if (lifecycleStatus == LifecycleStatus.ACTIVE) revert AlreadyActive();
      if (lifecycleStatus == LifecycleStatus.SHUTTING_DOWN) revert AlreadyShuttingDown();
      if (lifecycleStatus == LifecycleStatus.SHUTDOWN) revert AlreadyShutdown();

      // Transition to STARTING, call onStart() hook
      // After onStart() completes (including any effects), we transition to ACTIVE
      lifecycleStatus = LifecycleStatus.STARTING;
      onStart();
      // Transition to ACTIVE after onStart() hook completes
      lifecycleStatus = LifecycleStatus.ACTIVE;
      return;
    }

    if (command == LIFECYCLE_SHUTDOWN) {
      if (lifecycleStatus == LifecycleStatus.SHUTDOWN) revert AlreadyShutdown();
      if (lifecycleStatus == LifecycleStatus.SHUTTING_DOWN) revert AlreadyShuttingDown();

      // Allow shutdown from ACTIVE or DEPLOYED. If DEPLOYED, it becomes a no-op cleanup path.
      lifecycleStatus = LifecycleStatus.SHUTTING_DOWN;
      onShutdownRequested();
      return;
    }

    revert UnknownLifecycleCommand(command);
  }

  // =============================================================
  // StepEvent Integration
  // =============================================================

  /// @dev Routes STEP_EVENT_LIFECYCLE events. Other events are forwarded via super.
  /// While SHUTTING_DOWN, we keep progressing cleanup on every step (regardless of eventType),
  /// after letting other mixins handle the incoming event.
  function _onStepEvent(bytes32 eventType, uint32 eventVersion, bytes memory payload)
    internal
    virtual
    override
  {
    if (eventType == STEP_EVENT_LIFECYCLE) {
      if (eventVersion != LIFECYCLE_EVENT_VERSION) revert UnsupportedLifecycleVersion(eventVersion);

      // Decode payload: abi.encode(command)
      (bytes32 command) = abi.decode(payload, (bytes32));
      _handleLifecycleCommand(command);
      return;
    }

    // Forward other events via super chain
    super._onStepEvent(eventType, eventVersion, payload);

    // After processing any event, if shutting down, progress cleanup deterministically.
    // This allows core to drive cleanup with any "tick" event.
    if (lifecycleStatus == LifecycleStatus.SHUTTING_DOWN) {
      bool done = onShutdownStep();
      if (done) {
        lifecycleStatus = LifecycleStatus.SHUTDOWN;
        onShutdownComplete();
      }
    }
  }
}
