// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../../src/strategy/examples/OhlcLoggerStrategy.sol";
import "../../../src/interfaces/IStrategy.sol";
import "../../../src/types/OhlcCandle.sol";
import "../../../src/libraries/LoggingLib.sol";
import "../../../src/libraries/OhlcConsumerLib.sol";
import "../../../src/libraries/ResourceIds.sol";

contract OhlcLoggerStrategyTest is Test {
    OhlcLoggerStrategy public strategy;

    bytes32 constant ETH_USD_MARKET = keccak256(abi.encodePacked("ETH", "/", "USD"));
    bytes32 constant BTC_USD_MARKET = keccak256(abi.encodePacked("BTC", "/", "USD"));

    // Events to check
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
    event LogMessage(LoggingLib.LogLevel indexed level, string message, bytes data);
    event StrategyStarted();
    event StrategyShutdown();

    function setUp() public {
        strategy = new OhlcLoggerStrategy();
    }

    // =========== Constructor Tests ===========

    function test_constructor_setsOwnerToDeployer() public view {
        assertEq(strategy.owner(), address(this));
    }

    function test_constructor_setsEthUsdMarket() public view {
        assertEq(strategy.ETH_USD_MARKET(), ETH_USD_MARKET);
    }

    function test_constructor_setsStateToCreated() public view {
        assertEq(uint256(strategy.state()), uint256(IStrategy.StrategyState.Created));
    }

    function test_constructor_doesNotSubscribe() public {
        // Deploy new strategy to capture events - NO subscription event should be emitted
        // Only the log message should be emitted
        vm.recordLogs();
        new OhlcLoggerStrategy();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Check that no SubscriptionRequested event was emitted
        bytes32 subscriptionTopic = keccak256("SubscriptionRequested(bytes32,bytes)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertFalse(logs[i].topics[0] == subscriptionTopic, "Should not emit SubscriptionRequested in constructor");
        }
    }

    // =========== Start Tests ===========

    function test_start_subscribesToEthUsd1m() public {
        vm.expectEmit(true, false, false, true);
        emit SubscriptionRequested(
            keccak256("Subscription:Ohlc:v1"),
            abi.encode(ETH_USD_MARKET, TIMEFRAME_1M)
        );

        strategy.start();
    }

    function test_start_logsStartMessage() public {
        vm.expectEmit(true, false, false, false);
        emit LogMessage(LoggingLib.LogLevel.Info, "OhlcLoggerStrategy started, subscribed to ETH/USD 1m", "");

        strategy.start();
    }

    function test_start_changesStateToRunning() public {
        strategy.start();
        assertEq(uint256(strategy.state()), uint256(IStrategy.StrategyState.Running));
    }

    // =========== Shutdown Tests ===========

    function test_shutdown_unsubscribesFromEthUsd1m() public {
        strategy.start();

        vm.expectEmit(true, false, false, true);
        emit UnsubscriptionRequested(
            keccak256("Subscription:Ohlc:v1"),
            abi.encode(ETH_USD_MARKET, TIMEFRAME_1M)
        );

        strategy.shutdown();
    }

    function test_shutdown_logsShutdownMessage() public {
        strategy.start();

        vm.expectEmit(true, false, false, false);
        emit LogMessage(LoggingLib.LogLevel.Info, "OhlcLoggerStrategy shutdown, unsubscribed from ETH/USD 1m", "");

        strategy.shutdown();
    }

    function test_shutdown_changesStateToShutdown() public {
        strategy.start();
        strategy.shutdown();
        assertEq(uint256(strategy.state()), uint256(IStrategy.StrategyState.Shutdown));
    }

    // =========== Callback Tests ===========

    function test_onOhlcCandle_logsCandle() public {
        strategy.start();

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
        strategy.start();
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
        strategy.start();
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
        strategy.start();
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

    // =========== Full Lifecycle Test ===========

    function test_fullLifecycle() public {
        // Deploy - state is Created
        OhlcLoggerStrategy strat = new OhlcLoggerStrategy();
        assertEq(uint256(strat.state()), uint256(IStrategy.StrategyState.Created));

        // Start - state is Running, subscription created
        strat.start();
        assertEq(uint256(strat.state()), uint256(IStrategy.StrategyState.Running));

        // Process candles
        OhlcCandle memory candle = _createCandle();
        strat.onOhlcCandle(ETH_USD_MARKET, TIMEFRAME_1M, candle);
        assertEq(strat.candleCount(), 1);

        // Shutdown - state is Shutdown, subscription removed
        strat.shutdown();
        assertEq(uint256(strat.state()), uint256(IStrategy.StrategyState.Shutdown));
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
