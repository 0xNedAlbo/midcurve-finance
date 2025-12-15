// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ActionMixin } from "./ActionMixin.sol";

/// @notice LifecycleMixin implements START / SHUTDOWN as user actions.
/// - Actions are delivered via STEP_EVENT_ACTION (ActionMixin).
/// - This mixin manages a minimal onchain lifecycle state and calls hooks.
///
/// Core enforcement idea (offchain):
/// - After SHUTDOWN is requested, core should stop feeding normal market events,
///   and immediately remove the strategy from all core-managed subscriptions.
/// - The strategy still performs graceful cleanup via effects during SHUTTING_DOWN.
///
/// Action types (bytes32):
/// - keccak256("START")
/// - keccak256("SHUTDOWN")
abstract contract LifecycleMixin is ActionMixin {
  bytes32 internal constant ACTION_START    = keccak256("START");
  bytes32 internal constant ACTION_SHUTDOWN = keccak256("SHUTDOWN");

  enum LifecycleStatus {
    STOPPED,         // default
    RUNNING,
    SHUTTING_DOWN,
    SHUTDOWN         // final state (optional distinct from STOPPED)
  }

  LifecycleStatus public lifecycleStatus;

  error AlreadyRunning();
  error NotRunning();
  error AlreadyShuttingDown();
  error AlreadyShutdown();

  /// @notice Hook called when the strategy is started (RUNNING).
  /// @dev Put initialization logic here; may request effects via _awaitEffect(...).
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

  /// @dev Optional: gate other event handlers by lifecycle. Mixins/strategies can call these helpers.
  function _requireRunning() internal view {
    if (lifecycleStatus != LifecycleStatus.RUNNING) revert NotRunning();
  }

  function _isRunning() internal view returns (bool) {
    return lifecycleStatus == LifecycleStatus.RUNNING;
  }

  function _isShuttingDown() internal view returns (bool) {
    return lifecycleStatus == LifecycleStatus.SHUTTING_DOWN;
  }

  // =============================================================
  // Action dispatch integration
  // =============================================================

  /// @dev Intercepts START/SHUTDOWN actions, forwards all other actions to `super.onAction(...)`.
  function onAction(bytes32 actionType, bytes memory params, uint64 actionNonce) internal virtual override {
    // Silence unused warnings (params/actionNonce are used for other actions).
    params; actionNonce;

    if (actionType == ACTION_START) {
      if (lifecycleStatus == LifecycleStatus.RUNNING) revert AlreadyRunning();
      if (lifecycleStatus == LifecycleStatus.SHUTTING_DOWN) revert AlreadyShuttingDown();
      if (lifecycleStatus == LifecycleStatus.SHUTDOWN) revert AlreadyShutdown();

      lifecycleStatus = LifecycleStatus.RUNNING;
      onStart();
      return;
    }

    if (actionType == ACTION_SHUTDOWN) {
      if (lifecycleStatus == LifecycleStatus.SHUTDOWN) revert AlreadyShutdown();
      if (lifecycleStatus == LifecycleStatus.SHUTTING_DOWN) revert AlreadyShuttingDown();

      // Allow shutdown from RUNNING or STOPPED. If STOPPED, it becomes a no-op cleanup path.
      lifecycleStatus = LifecycleStatus.SHUTTING_DOWN;
      onShutdownRequested();
      return;
    }

    super.onAction(actionType, params, actionNonce);
  }

  // =============================================================
  // StepEvent integration
  // =============================================================

  /// @dev While SHUTTING_DOWN, we keep progressing cleanup on every step (regardless of eventType),
  /// after letting other mixins handle the incoming event.
  ///
  /// This way, core can drive cleanup with any "tick" event (or even the shutdown action itself),
  /// and the strategy continues until `onShutdownStep()` returns done=true.
  function _onStepEvent(bytes32 eventType, uint32 eventVersion, bytes memory payload)
    internal
    virtual
    override
  {
    // First: let other mixins / handlers process the incoming event.
    super._onStepEvent(eventType, eventVersion, payload);

    // Then: if shutting down, progress cleanup deterministically.
    if (lifecycleStatus == LifecycleStatus.SHUTTING_DOWN) {
      bool done = onShutdownStep();
      if (done) {
        lifecycleStatus = LifecycleStatus.SHUTDOWN;
        onShutdownComplete();
      }
    }
  }
}
