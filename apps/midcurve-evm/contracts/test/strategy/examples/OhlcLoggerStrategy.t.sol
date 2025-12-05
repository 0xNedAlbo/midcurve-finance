// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../../src/strategy/examples/OhlcLoggerStrategy.sol";
import "../../../src/types/OhlcCandle.sol";
import "../../../src/libraries/LoggingLib.sol";
import "../../../src/libraries/OhlcConsumerLib.sol";
import "../../../src/libraries/ResourceIds.sol";

contract OhlcLoggerStrategyTest is Test {
    OhlcLoggerStrategy public strategy;

    address constant OWNER = address(0xBEEF);
    bytes32 constant ETH_USD_MARKET = keccak256(abi.encodePacked("ETH", "/", "USD"));
    bytes32 constant BTC_USD_MARKET = keccak256(abi.encodePacked("BTC", "/", "USD"));

    // Events to check
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
    event LogMessage(LoggingLib.LogLevel indexed level, string message, bytes data);

    function setUp() public {
        strategy = new OhlcLoggerStrategy(OWNER);
    }

    function test_constructor_setsOwner() public view {
        assertEq(strategy.owner(), OWNER);
    }

    function test_constructor_setsEthUsdMarket() public view {
        assertEq(strategy.ETH_USD_MARKET(), ETH_USD_MARKET);
    }

    function test_constructor_subscribesToEthUsd1m() public {
        // Deploy new strategy to capture events
        vm.expectEmit(true, false, false, true);
        emit SubscriptionRequested(
            keccak256("Subscription:Ohlc:v1"),
            abi.encode(ETH_USD_MARKET, TIMEFRAME_1M)
        );

        new OhlcLoggerStrategy(OWNER);
    }

    function test_constructor_logsInitialization() public {
        // Deploy new strategy to capture events
        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Info, "OhlcLoggerStrategy initialized", "");

        new OhlcLoggerStrategy(OWNER);
    }

    function test_onOhlcCandle_logsCandle() public {
        OhlcCandle memory candle = OhlcCandle({
            timestamp: 1700000000,
            open: 2000e18,
            high: 2050e18,
            low: 1980e18,
            close: 2030e18,
            volume: 1000e18
        });

        bytes memory expectedData = abi.encode(
            candle.timestamp,
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.volume
        );

        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Info, "ETH/USD 1m candle received", expectedData);

        strategy.onOhlcCandle(ETH_USD_MARKET, TIMEFRAME_1M, candle);
    }

    function test_onOhlcCandle_incrementsCandleCount() public {
        OhlcCandle memory candle = _createCandle();

        assertEq(strategy.candleCount(), 0);

        strategy.onOhlcCandle(ETH_USD_MARKET, TIMEFRAME_1M, candle);
        assertEq(strategy.candleCount(), 1);

        strategy.onOhlcCandle(ETH_USD_MARKET, TIMEFRAME_1M, candle);
        assertEq(strategy.candleCount(), 2);

        strategy.onOhlcCandle(ETH_USD_MARKET, TIMEFRAME_1M, candle);
        assertEq(strategy.candleCount(), 3);
    }

    function test_onOhlcCandle_ignoresOtherMarkets() public {
        OhlcCandle memory candle = _createCandle();

        // BTC/USD should be ignored
        strategy.onOhlcCandle(BTC_USD_MARKET, TIMEFRAME_1M, candle);
        assertEq(strategy.candleCount(), 0);

        // Random market should be ignored
        strategy.onOhlcCandle(bytes32(uint256(123)), TIMEFRAME_1M, candle);
        assertEq(strategy.candleCount(), 0);

        // ETH/USD should work
        strategy.onOhlcCandle(ETH_USD_MARKET, TIMEFRAME_1M, candle);
        assertEq(strategy.candleCount(), 1);
    }

    function test_onOhlcCandle_ignoresOtherTimeframes() public {
        OhlcCandle memory candle = _createCandle();

        // 5m should be ignored
        strategy.onOhlcCandle(ETH_USD_MARKET, TIMEFRAME_5M, candle);
        assertEq(strategy.candleCount(), 0);

        // 1h should be ignored
        strategy.onOhlcCandle(ETH_USD_MARKET, TIMEFRAME_1H, candle);
        assertEq(strategy.candleCount(), 0);

        // 1m should work
        strategy.onOhlcCandle(ETH_USD_MARKET, TIMEFRAME_1M, candle);
        assertEq(strategy.candleCount(), 1);
    }

    function _createCandle() internal pure returns (OhlcCandle memory) {
        return OhlcCandle({
            timestamp: 1700000000,
            open: 2000e18,
            high: 2050e18,
            low: 1980e18,
            close: 2030e18,
            volume: 1000e18
        });
    }
}
