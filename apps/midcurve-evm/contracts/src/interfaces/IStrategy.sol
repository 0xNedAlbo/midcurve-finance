// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Strategy interface for simulation-driven, durable execution.
/// Core/operator drives the strategy via `step(...)` using a StepEvent envelope.
/// Missing external work is requested via reverting with `EffectNeeded(...)`.
interface IStrategy {
  // =============================================================
  // Durable-await signal (returned via revert data during eth_call)
  // =============================================================

  /// @dev Signals that an external effect must be executed before `step()` can proceed.
  /// Returned via REVERT during eth_call simulation (this is NOT an event).
  ///
  /// @param epoch         Current logical epoch (result namespace)
  /// @param idempotencyKey Stable key for exactly-once semantics
  /// @param effectType    Discriminator understood by Core (e.g. SWAP, LOG, SUBSCRIBE_OHLC)
  /// @param payload       Full ABI-encoded payload required to execute the effect
  error EffectNeeded(
    uint64 epoch,
    bytes32 idempotencyKey,
    bytes32 effectType,
    bytes payload
  );

  // =============================================================
  // Strategy execution
  // =============================================================

  /// @notice Advances the strategy.
  ///
  /// This function is called by the operator:
  /// - via eth_call for simulation (may revert with EffectNeeded)
  /// - via a transaction to commit state changes
  ///
  /// @param input ABI-encoded StepEvent envelope:
  ///   abi.encode(
  ///     eventType,    // bytes32
  ///     eventVersion, // uint32
  ///     payload       // bytes
  ///   )
  function step(bytes calldata input) external;

  // =============================================================
  // Effect result persistence (durable memory)
  // =============================================================

  /// @notice Persists the result of a previously requested effect.
  ///
  /// Must be called after Core/operator has executed the external effect
  /// requested via EffectNeeded(...).
  ///
  /// @param epoch          Epoch for which the effect was requested
  /// @param idempotencyKey Same key as in EffectNeeded
  /// @param ok             Whether the effect succeeded
  /// @param data           ABI-encoded result data or error payload
  function submitEffectResult(
    uint64 epoch,
    bytes32 idempotencyKey,
    bool ok,
    bytes calldata data
  ) external;

  // =============================================================
  // Epoch / GC
  // =============================================================

  /// @notice Current epoch (increments after a successful committed step).
  function epoch() external view returns (uint64);

  /// @notice Garbage-collect effect results of a completed epoch in bounded batches.
  ///
  /// @param epochToSweep Epoch to sweep (must be < current epoch)
  /// @param maxItems     Max number of entries to delete in this call
  /// @return swept       Number of entries deleted
  /// @return done        True if the epoch is fully swept
  function gcEpoch(
    uint64 epochToSweep,
    uint256 maxItems
  ) external returns (uint256 swept, bool done);
}
