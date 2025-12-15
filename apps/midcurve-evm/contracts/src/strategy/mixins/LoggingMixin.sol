// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseStrategy } from "../BaseStrategy.sol";

/// @notice Logging as a durable Effect.
/// The operator/core can record the log even when step() reverts during eth_call simulation,
/// because the log request is surfaced via the EffectNeeded(...) custom error.
///
/// Semantics:
/// - Each log line is a separate effect (idempotent by (epoch, logSeq)).
/// - Core should "execute" the log effect by writing it to its own log sink
///   and then call submitEffectResult(epoch, key, true, "").
/// - The strategy can continue once the log effect result exists.
///
abstract contract LoggingMixin is BaseStrategy {
  bytes32 internal constant EFFECT_LOG = keccak256("LOG");

  /// @dev Monotonic per-epoch log counter used to derive stable idempotency keys.
  /// Persists on successful commit-tx only; in eth_call it advances transiently.
  uint64 internal _logSeq;

  /// @notice Returns the current log sequence number (mostly for debugging).
  function _logSequence() internal view returns (uint64) {
    return _logSeq;
  }

  /// @dev Emit a log request as an effect. This will revert with EffectNeeded(...) if the log
  /// has not yet been acknowledged via submitEffectResult.
  function _log(uint8 level, bytes32 topic, bytes memory data) internal {
    // Key must be deterministic and unique per log line within an epoch.
    // We include epoch() so keys don't collide across epochs even if _logSeq resets.
    bytes32 key = keccak256(abi.encodePacked("log", epoch(), _logSeq));

    // Payload contains everything core needs to write a log line.
    bytes memory payload = abi.encode(level, topic, data);

    // Await the "log effect". Core should acknowledge with ok=true and empty data.
    // We ignore READY_FAILED here (core could theoretically fail logging); strategy continues either way.
    (AwaitStatus st,) = _awaitEffect(key, EFFECT_LOG, payload);

    // Advance sequence once the effect result exists (OK or FAILED).
    if (st == AwaitStatus.READY_OK || st == AwaitStatus.READY_FAILED) {
      unchecked { _logSeq += 1; }
    }
  }

  function _logDebug(bytes32 topic, bytes memory data) internal { _log(0, topic, data); }
  function _logInfo(bytes32 topic, bytes memory data)  internal { _log(1, topic, data); }
  function _logWarn(bytes32 topic, bytes memory data)  internal { _log(2, topic, data); }
  function _logError(bytes32 topic, bytes memory data) internal { _log(3, topic, data); }
}
