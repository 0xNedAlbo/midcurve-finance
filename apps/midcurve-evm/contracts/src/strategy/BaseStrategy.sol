// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IStrategy } from "../interfaces/IStrategy.sol";

/// @notice BaseStrategy for simulation-driven durable execution.
///
/// Protocol:
/// - Operator calls `step(input)` via eth_call (simulation). If an external effect is missing,
///   the call reverts with `EffectNeeded(epoch, key, effectType, payload)`.
/// - Operator/Core executes the effect offchain and persists the result via `submitEffectResult(...)`.
/// - Repeat simulation until `step()` returns normally, then send `step()` as a TX to commit.
/// - On successful commit, BaseStrategy increments `epoch` as the last action.
/// - Core can garbage-collect old epoch results via `gcEpoch(...)` in bounded batches.
///
/// StepEvent envelope:
///   input = abi.encode(
///     eventType,    // bytes32
///     eventVersion, // uint32
///     payload       // bytes
///   )
abstract contract BaseStrategy is IStrategy {
  // =============================================================
  // Auth
  // =============================================================

  address public operator;
  address public core;

  error NotOperator();
  error NotCore();
  error ZeroAddress();

  modifier onlyOperator() {
    if (msg.sender != operator) revert NotOperator();
    _;
  }

  modifier onlyCore() {
    if (msg.sender != core) revert NotCore();
    _;
  }

  constructor(address operator_, address core_) {
    if (operator_ == address(0) || core_ == address(0)) revert ZeroAddress();
    operator = operator_;
    core = core_;
  }

  // =============================================================
  // StepEvent envelope decoding
  // =============================================================

  error InvalidStepEvent();

  function _decodeStepEvent(bytes calldata input)
    internal
    pure
    returns (bytes32 eventType, uint32 eventVersion, bytes memory payload)
  {
    // Minimal sanity check: abi.encode(bytes32,uint32,bytes) will be at least 96 bytes.
    if (input.length < 96) revert InvalidStepEvent();
    (eventType, eventVersion, payload) = abi.decode(input, (bytes32, uint32, bytes));
  }

  // =============================================================
  // Effect result store (durable)
  // =============================================================

  enum EffectStatus {
    NONE,
    SUCCESS,
    FAILED
  }

  struct EffectResult {
    EffectStatus status; // NONE means "not present"
    bytes data;          // ABI-encoded result or error payload
  }

  // epoch => idempotencyKey => result
  mapping(uint64 => mapping(bytes32 => EffectResult)) internal _results;

  // For GC: track which keys were written in each epoch (mappings are not iterable).
  mapping(uint64 => bytes32[]) internal _keysByEpoch;
  mapping(uint64 => uint256) internal _sweepCursor;

  uint64 internal _epoch;

  function epoch() public view override returns (uint64) {
    return _epoch;
  }

  /// @notice Persist an effect result (operator).
  function submitEffectResult(
    uint64 epoch_,
    bytes32 idempotencyKey,
    bool ok,
    bytes calldata data
  ) external override onlyOperator {
    require(epoch_ <= _epoch, "epoch too new");

    EffectResult storage r = _results[epoch_][idempotencyKey];

    // Idempotent: allow resubmitting the same status; disallow changing an existing entry.
    if (r.status != EffectStatus.NONE) {
      require((ok && r.status == EffectStatus.SUCCESS) || (!ok && r.status == EffectStatus.FAILED), "status mismatch");
      return;
    }

    r.status = ok ? EffectStatus.SUCCESS : EffectStatus.FAILED;
    r.data = data;

    _keysByEpoch[epoch_].push(idempotencyKey);
  }

  // =============================================================
  // Durable await primitive (revert only when missing)
  // =============================================================

  enum AwaitStatus {
    READY_OK,
    READY_FAILED
  }

  /// @notice Returns SUCCESS/FAILED without reverting. Reverts only when missing.
  function _awaitEffect(
    bytes32 idempotencyKey,
    bytes32 effectType,
    bytes memory payload
  ) internal view returns (AwaitStatus status, bytes memory data) {
    EffectResult storage r = _results[_epoch][idempotencyKey];

    if (r.status == EffectStatus.SUCCESS) return (AwaitStatus.READY_OK, r.data);
    if (r.status == EffectStatus.FAILED)  return (AwaitStatus.READY_FAILED, r.data);

    revert EffectNeeded(_epoch, idempotencyKey, effectType, payload);
  }

  // =============================================================
  // Step orchestration
  // =============================================================

  /// @notice Operator calls `step` via eth_call (simulate) and via TX (commit).
  function step(bytes calldata input) external override onlyOperator {
    (bytes32 eventType, uint32 eventVersion, bytes memory payload) = _decodeStepEvent(input);

    _onStepEvent(eventType, eventVersion, payload);

    // If we got here, the step completed without needing more effects.
    // Last act: advance epoch to logically separate the next cycle's results.
    unchecked {
      _epoch += 1;
    }
  }

  /// @notice StepEvent router hook. Mixins override this and call super to "rutsch durch".
  /// Default implementation: do nothing (unknown event types are ignored).
  function _onStepEvent(bytes32 eventType, uint32 eventVersion, bytes memory payload) internal virtual {
    // silence unused variable warnings in base
    eventType; eventVersion; payload;
  }

  // =============================================================
  // GC (core-sponsored)
  // =============================================================

  /// @notice Sweep stored effect results for a completed epoch in bounded batches.
  function gcEpoch(uint64 epochToSweep, uint256 maxItems)
    external
    override
    onlyCore
    returns (uint256 swept, bool done)
  {
    require(epochToSweep < _epoch, "active epoch");
    require(maxItems > 0, "maxItems=0");

    bytes32[] storage keys = _keysByEpoch[epochToSweep];
    uint256 i = _sweepCursor[epochToSweep];
    uint256 len = keys.length;

    if (i >= len) {
      return (0, true);
    }

    uint256 end = i + maxItems;
    if (end > len) end = len;

    for (; i < end; i++) {
      delete _results[epochToSweep][keys[i]];
    }

    swept = end - _sweepCursor[epochToSweep];
    _sweepCursor[epochToSweep] = end;

    if (end == len) {
      delete _keysByEpoch[epochToSweep];
      delete _sweepCursor[epochToSweep];
      done = true;
    } else {
      done = false;
    }
  }
}
