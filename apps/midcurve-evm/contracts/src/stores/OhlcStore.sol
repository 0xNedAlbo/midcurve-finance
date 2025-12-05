// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/CoreControlled.sol";
import "../interfaces/IOhlcStore.sol";

/**
 * @title OhlcStore
 * @notice Stores OHLC (Open, High, Low, Close) price candles with ring buffer
 * @dev Candles are written by Core and readable by any strategy.
 *      Uses a ring buffer to limit storage per market/timeframe.
 *      Market IDs are computed off-chain (e.g., keccak256(abi.encodePacked(baseToken, quoteToken))).
 */
contract OhlcStore is CoreControlled, IOhlcStore {
    /// @notice Maximum candles to store per market/timeframe (ring buffer size)
    uint256 public constant MAX_CANDLES = 1000;

    /// @notice Mapping: marketId => timeframe => candles array
    mapping(bytes32 => mapping(uint8 => OhlcCandle[])) internal _candles;

    /// @notice Error thrown when no candles exist for a market/timeframe
    error NoCandles();

    /// @inheritdoc IOhlcStore
    function appendCandle(
        bytes32 marketId,
        uint8 timeframe,
        OhlcCandle calldata candle
    ) external override onlyCore {
        OhlcCandle[] storage candles = _candles[marketId][timeframe];

        if (candles.length >= MAX_CANDLES) {
            // Ring buffer: shift all elements left and replace last
            for (uint256 i = 0; i < candles.length - 1; i++) {
                candles[i] = candles[i + 1];
            }
            candles[candles.length - 1] = candle;
        } else {
            candles.push(candle);
        }

        emit CandleAppended(marketId, timeframe, candle.timestamp);
    }

    /// @inheritdoc IOhlcStore
    function getLatestCandle(
        bytes32 marketId,
        uint8 timeframe
    ) external view override returns (OhlcCandle memory) {
        OhlcCandle[] storage candles = _candles[marketId][timeframe];
        if (candles.length == 0) revert NoCandles();
        return candles[candles.length - 1];
    }

    /// @inheritdoc IOhlcStore
    function getCandles(
        bytes32 marketId,
        uint8 timeframe,
        uint256 count
    ) external view override returns (OhlcCandle[] memory) {
        OhlcCandle[] storage allCandles = _candles[marketId][timeframe];
        uint256 actualCount = count > allCandles.length ? allCandles.length : count;

        OhlcCandle[] memory result = new OhlcCandle[](actualCount);
        uint256 startIdx = allCandles.length - actualCount;

        for (uint256 i = 0; i < actualCount; i++) {
            result[i] = allCandles[startIdx + i];
        }

        return result;
    }

    /// @inheritdoc IOhlcStore
    function getCandleCount(
        bytes32 marketId,
        uint8 timeframe
    ) external view override returns (uint256) {
        return _candles[marketId][timeframe].length;
    }
}
