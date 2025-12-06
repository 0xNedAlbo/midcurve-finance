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
 *      - Using lifecycle hooks (_onStart, _onShutdown) for subscription management
 *
 * Lifecycle:
 * 1. Deploy: Constructor configures ETH_USD_MARKET, no subscriptions yet
 * 2. Start: Owner calls start(), subscription created in _onStart()
 * 3. Running: Receives OHLC candles via onOhlcCandle callback
 * 4. Shutdown: Owner calls shutdown(), subscription removed in _onShutdown()
 */
contract OhlcLoggerStrategy is BaseStrategy, IOhlcConsumer {
    using OhlcConsumerLib for *;
    using LoggingLib for *;

    /// @notice The market ID for ETH/USD
    bytes32 public immutable ETH_USD_MARKET;

    /// @notice Counter for received candles
    uint256 public candleCount;

    /**
     * @notice Deploy the strategy (owner = msg.sender)
     * @dev Only configuration happens here, no subscriptions yet
     */
    constructor() BaseStrategy() {
        ETH_USD_MARKET = ResourceIds.marketId("ETH", "USD");
        LoggingLib.logInfo("OhlcLoggerStrategy deployed (not started)");
    }

    /**
     * @notice Set up subscriptions when started
     * @dev Called by BaseStrategy.start() after state changes to Running
     */
    function _onStart() internal override {
        OhlcConsumerLib.subscribeOhlc(ETH_USD_MARKET, TIMEFRAME_1M);
        LoggingLib.logInfo("OhlcLoggerStrategy started, subscribed to ETH/USD 1m");
    }

    /**
     * @notice Remove subscriptions on shutdown
     * @dev Called by BaseStrategy.shutdown() before state changes to Shutdown
     */
    function _onShutdown() internal override {
        OhlcConsumerLib.unsubscribeOhlc(ETH_USD_MARKET, TIMEFRAME_1M);
        LoggingLib.logInfo("OhlcLoggerStrategy shutdown, unsubscribed from ETH/USD 1m");
    }

    /**
     * @notice Called when a new OHLC candle closes
     * @param marketId The market identifier
     * @param timeframe The candle timeframe in minutes
     * @param candle The OHLC candle data
     * @dev Only receives callbacks when Running (subscriptions only exist in Running state)
     */
    function onOhlcCandle(
        bytes32 marketId,
        uint8 timeframe,
        OhlcCandle calldata candle
    ) external override {
        // Note: We don't need onlyRunning here because:
        // 1. Before start(): No subscriptions, so no callbacks
        // 2. After shutdown(): Subscriptions removed, so no callbacks
        // The subscription manager naturally handles this.

        if (marketId == ETH_USD_MARKET && timeframe == TIMEFRAME_1M) {
            candleCount++;
            LoggingLib.logInfo(
                "ETH/USD 1m candle received",
                abi.encode(candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume)
            );
        }
    }
}
