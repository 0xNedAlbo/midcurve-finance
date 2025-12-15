// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseStrategy } from "../BaseStrategy.sol";

/// @notice ActionMixin provides a fixed StepEvent type for user-triggered actions.
/// Core/operator can forward arbitrary (but manifest-defined) actions as:
///
///   step( abi.encode(
///     STEP_EVENT_ACTION,
///     uint32(1), // envelope version
///     abi.encode(
///       actionType,    // bytes32, e.g. keccak256("UNISWAPV3_COMPOUND_FEES")
///       actionNonce,   // uint64, monotonic (replay protection)
///       params         // bytes, ABI-encoded params per actionType
///     )
///   ))
///
/// This mixin:
/// - validates actionNonce monotonicity (optional strict mode)
/// - dispatches into a single hook: `onAction(actionType, params, actionNonce)`
/// - forwards unknown StepEvent types via `super._onStepEvent(...)`
///
/// IMPORTANT: This mixin assumes BaseStrategy exposes `_decodeStepEvent(...)` + `_onStepEvent(...)` chain.
/// If your current BaseStrategy still uses `_onStep(bytes)`, update it to the StepEvent envelope router first.
abstract contract ActionMixin is BaseStrategy {
  // Fixed StepEvent discriminator (core knows this constant set)
  bytes32 internal constant STEP_EVENT_ACTION = keccak256("STEP_EVENT_ACTION");

  // Envelope version supported for action payload layout
  uint32 internal constant ACTION_EVENT_VERSION = 1;

  // Monotonic replay protection (per strategy instance)
  uint64 public lastActionNonce;

  error UnsupportedActionEventVersion(uint32 got);
  error InvalidActionNonce(uint64 expected, uint64 got);
  error UnknownActionType(bytes32 actionType);

  /// @notice Strategy hook for handling an action.
  /// @dev Implementations should route by actionType and decode params accordingly.
  ///      Default implementation reverts for unknown action types.
  function onAction(bytes32 actionType, bytes memory params, uint64 actionNonce) internal virtual {
    // Silence unused variable warnings
    params; actionNonce;
    revert UnknownActionType(actionType);
  }

  /// @notice Override point: if you want non-strict nonce checks (e.g. allow jumps), override and relax.
  function _validateActionNonce(uint64 actionNonce) internal {
    uint64 expected = lastActionNonce + 1;
    if (actionNonce != expected) revert InvalidActionNonce(expected, actionNonce);
    lastActionNonce = actionNonce;
  }

  /// @dev StepEvent router hook. Handles STEP_EVENT_ACTION; otherwise forwards via super.
  function _onStepEvent(bytes32 eventType, uint32 eventVersion, bytes memory payload)
    internal
    virtual
    override
  {
    if (eventType != STEP_EVENT_ACTION) {
      super._onStepEvent(eventType, eventVersion, payload);
      return;
    }

    if (eventVersion != ACTION_EVENT_VERSION) revert UnsupportedActionEventVersion(eventVersion);

    (bytes32 actionType, uint64 actionNonce, bytes memory params) =
      abi.decode(payload, (bytes32, uint64, bytes));

    _validateActionNonce(actionNonce);
    onAction(actionType, params, actionNonce);
  }
}
