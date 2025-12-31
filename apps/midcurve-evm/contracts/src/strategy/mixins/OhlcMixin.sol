// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseStrategy } from "../BaseStrategy.sol";

/// @notice OHLC subscription mixin (subscribe/unsubscribe as Effects).
///
/// NOTE: This mixin needs updating to use the StepEvent envelope pattern.
/// Currently uses the older _onStep(bytes) pattern which is incompatible
/// with BaseStrategy's _onStepEvent(bytes32, uint32, bytes) router.
///
/// TODO: Update to use _onStepEvent pattern like ActionMixin.
abstract contract OhlcMixin is BaseStrategy {
  // Effect types
  bytes32 internal constant EFFECT_SUBSCRIBE_OHLC   = keccak256("SUBSCRIBE_OHLC");
  bytes32 internal constant EFFECT_UNSUBSCRIBE_OHLC = keccak256("UNSUBSCRIBE_OHLC");

  // Step event discriminator
  bytes32 internal constant STEP_EVENT_OHLC = keccak256("STEP_EVENT_OHLC");

  // Envelope version for OHLC events
  uint32 internal constant OHLC_EVENT_VERSION = 1;

  struct Candle {
    uint64 ts;
    uint256 open;
    uint256 high;
    uint256 low;
    uint256 close;
    uint256 volume;
  }

  /// @notice Strategy hook: override this to handle OHLC data.
  function onOhlcData(
    bytes32 symbol,
    uint32 timeframe,
    Candle memory candle
  ) internal virtual;

  // -----------------------
  // Durable subscription effects
  // -----------------------

  function subscribeOhlcData(bytes32 symbol, uint32 timeframe) internal {
    bytes32 key = keccak256(
      abi.encodePacked("ohlc:sub", epoch(), symbol, timeframe)
    );

    bytes memory payload = abi.encode(symbol, timeframe);
    _awaitEffect(key, EFFECT_SUBSCRIBE_OHLC, payload);
  }

  function unsubscribeOhlcData(bytes32 symbol, uint32 timeframe) internal {
    bytes32 key = keccak256(
      abi.encodePacked("ohlc:unsub", epoch(), symbol, timeframe)
    );

    bytes memory payload = abi.encode(symbol, timeframe);
    _awaitEffect(key, EFFECT_UNSUBSCRIBE_OHLC, payload);
  }

  // -----------------------
  // Step routing (StepEvent envelope pattern)
  // -----------------------

  /// @dev Routes OHLC events. Other events are forwarded via super.
  function _onStepEvent(bytes32 eventType, uint32 eventVersion, bytes memory payload)
    internal
    virtual
    override
  {
    if (eventType != STEP_EVENT_OHLC) {
      super._onStepEvent(eventType, eventVersion, payload);
      return;
    }

    // Decode OHLC payload
    (bytes32 symbol, uint32 timeframe, Candle memory candle) =
      abi.decode(payload, (bytes32, uint32, Candle));

    onOhlcData(symbol, timeframe, candle);
  }
}
