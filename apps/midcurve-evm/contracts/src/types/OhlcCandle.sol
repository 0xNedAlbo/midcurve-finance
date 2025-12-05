// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OhlcCandle
 * @notice OHLC (Open-High-Low-Close) candle data structure for price feeds
 * @dev Used by IOhlcConsumer interface for receiving price data callbacks
 */
struct OhlcCandle {
    uint256 timestamp;
    uint256 open;
    uint256 high;
    uint256 low;
    uint256 close;
    uint256 volume;
}

// 1-minute candle timeframe
uint8 constant TIMEFRAME_1M = 1;

// 5-minute candle timeframe
uint8 constant TIMEFRAME_5M = 5;

// 15-minute candle timeframe
uint8 constant TIMEFRAME_15M = 15;

// 1-hour candle timeframe (60 minutes)
uint8 constant TIMEFRAME_1H = 60;

// 4-hour candle timeframe (240 minutes)
uint8 constant TIMEFRAME_4H = 240;

// 1-day candle timeframe (1440 minutes) - uses uint16 due to value > 255
uint16 constant TIMEFRAME_1D = 1440;
