// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OhlcCandle} from "../types/OhlcCandle.sol";

/**
 * @title IOhlcConsumer
 * @notice Interface for strategies that consume OHLC price candle data
 * @dev Implement this interface to receive price candle callbacks from Core
 */
interface IOhlcConsumer {
    /**
     * @notice Called when a new OHLC candle closes
     * @param marketId The market identifier (e.g., keccak256("ETH/USD"))
     * @param timeframe The candle timeframe in minutes (use TIMEFRAME_* constants)
     * @param candle The OHLC candle data
     */
    function onOhlcCandle(
        bytes32 marketId,
        uint8 timeframe,
        OhlcCandle calldata candle
    ) external;
}
