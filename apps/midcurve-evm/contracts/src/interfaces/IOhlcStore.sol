// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IOhlcStore
 * @notice Interface for storing OHLC (Open, High, Low, Close) price candles
 */
interface IOhlcStore {
    /// @notice OHLC candle data structure
    struct OhlcCandle {
        uint256 timestamp;
        uint256 open;
        uint256 high;
        uint256 low;
        uint256 close;
        uint256 volume;
    }

    /// @notice Appends a new candle to the store (Core only)
    /// @param marketId The unique identifier for the market
    /// @param timeframe The timeframe (e.g., 1 = 1min, 5 = 5min, 60 = 1hour)
    /// @param candle The candle data
    function appendCandle(bytes32 marketId, uint8 timeframe, OhlcCandle calldata candle) external;

    /// @notice Returns the latest candle for a market/timeframe
    /// @param marketId The unique identifier for the market
    /// @param timeframe The timeframe
    /// @return The latest candle
    function getLatestCandle(
        bytes32 marketId,
        uint8 timeframe
    ) external view returns (OhlcCandle memory);

    /// @notice Returns the most recent N candles for a market/timeframe
    /// @param marketId The unique identifier for the market
    /// @param timeframe The timeframe
    /// @param count The number of candles to return
    /// @return Array of candles (oldest to newest)
    function getCandles(
        bytes32 marketId,
        uint8 timeframe,
        uint256 count
    ) external view returns (OhlcCandle[] memory);

    /// @notice Returns the number of candles stored for a market/timeframe
    /// @param marketId The unique identifier for the market
    /// @param timeframe The timeframe
    /// @return The candle count
    function getCandleCount(bytes32 marketId, uint8 timeframe) external view returns (uint256);

    /// @notice Emitted when a candle is appended
    event CandleAppended(bytes32 indexed marketId, uint8 indexed timeframe, uint256 timestamp);
}
