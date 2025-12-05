// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseStrategy} from "../BaseStrategy.sol";
import {IOhlcConsumer} from "../../interfaces/IOhlcConsumer.sol";
import {OhlcCandle, TIMEFRAME_1M} from "../../types/OhlcCandle.sol";
import {OhlcConsumerLib} from "../../libraries/OhlcConsumerLib.sol";
import {ResourceIds} from "../../libraries/ResourceIds.sol";
import {LoggingLib} from "../../libraries/LoggingLib.sol";

/**
 * @title OhlcLoggerStrategy
 * @notice Example strategy that logs incoming OHLC candles
 * @dev Demonstrates the modular architecture by:
 *      - Extending BaseStrategy
 *      - Implementing IOhlcConsumer for price data callbacks
 *      - Using OhlcConsumerLib for subscription management
 *      - Using LoggingLib for logging
 */
contract OhlcLoggerStrategy is BaseStrategy, IOhlcConsumer {
    using OhlcConsumerLib for *;
    using LoggingLib for *;

    /// @notice The market ID for ETH/USD
    bytes32 public immutable ETH_USD_MARKET;

    /// @notice Counter for received candles
    uint256 public candleCount;

    /**
     * @notice Initialize the strategy and subscribe to ETH/USD 1m candles
     * @param _owner The address that will own this strategy
     */
    constructor(address _owner) BaseStrategy(_owner) {
        ETH_USD_MARKET = ResourceIds.marketId("ETH", "USD");
        OhlcConsumerLib.subscribeOhlc(ETH_USD_MARKET, TIMEFRAME_1M);
        LoggingLib.logInfo("OhlcLoggerStrategy initialized");
    }

    /**
     * @notice Called when a new OHLC candle closes
     * @param marketId The market identifier
     * @param timeframe The candle timeframe in minutes
     * @param candle The OHLC candle data
     */
    function onOhlcCandle(
        bytes32 marketId,
        uint8 timeframe,
        OhlcCandle calldata candle
    ) external override {
        if (marketId == ETH_USD_MARKET && timeframe == TIMEFRAME_1M) {
            candleCount++;
            LoggingLib.logInfo(
                "ETH/USD 1m candle received",
                abi.encode(candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume)
            );
        }
    }
}
