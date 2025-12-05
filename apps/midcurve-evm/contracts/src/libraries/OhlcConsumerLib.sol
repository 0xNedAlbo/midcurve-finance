// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OhlcConsumerLib
 * @notice Library for OHLC subscription management
 * @dev Use with `using OhlcConsumerLib for *;` in strategies that implement IOhlcConsumer
 *
 * Note: OhlcStore was removed from the system. OHLC candles are delivered via callbacks only.
 */
library OhlcConsumerLib {
    /// @notice Emitted when a subscription is requested
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    /// @notice Emitted when an unsubscription is requested
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    /// @notice The subscription type identifier for OHLC subscriptions
    bytes32 constant SUBSCRIPTION_TYPE = keccak256("Subscription:Ohlc:v1");

    /**
     * @notice Subscribe to OHLC candle updates for a market
     * @param marketId The market identifier (e.g., keccak256("ETH/USD"))
     * @param timeframe The candle timeframe in minutes (use TIMEFRAME_* constants)
     */
    function subscribeOhlc(bytes32 marketId, uint8 timeframe) internal {
        emit SubscriptionRequested(SUBSCRIPTION_TYPE, abi.encode(marketId, timeframe));
    }

    /**
     * @notice Unsubscribe from OHLC candle updates for a market
     * @param marketId The market identifier
     * @param timeframe The candle timeframe in minutes
     */
    function unsubscribeOhlc(bytes32 marketId, uint8 timeframe) internal {
        emit UnsubscriptionRequested(SUBSCRIPTION_TYPE, abi.encode(marketId, timeframe));
    }
}
