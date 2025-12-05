// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/stores/OhlcStore.sol";
import "../../src/interfaces/IOhlcStore.sol";
import "../../src/libraries/CoreControlled.sol";

contract OhlcStoreTest is Test {
    OhlcStore public store;

    address constant CORE = 0x0000000000000000000000000000000000000001;
    address constant NON_CORE = address(0xBEEF);

    bytes32 constant MARKET_ID = keccak256(abi.encodePacked(address(0x1111), address(0x2222)));
    uint8 constant TIMEFRAME_1M = 1;
    uint8 constant TIMEFRAME_1H = 60;

    event CandleAppended(bytes32 indexed marketId, uint8 indexed timeframe, uint256 timestamp);

    function setUp() public {
        store = new OhlcStore();
    }

    function _createCandle(uint256 timestamp, uint256 price) internal pure returns (IOhlcStore.OhlcCandle memory) {
        return IOhlcStore.OhlcCandle({
            timestamp: timestamp,
            open: price,
            high: price + 10,
            low: price - 10,
            close: price + 5,
            volume: 1000
        });
    }

    function test_appendCandle() public {
        IOhlcStore.OhlcCandle memory candle = _createCandle(1000, 100);

        vm.prank(CORE);
        vm.expectEmit(true, true, false, true);
        emit CandleAppended(MARKET_ID, TIMEFRAME_1M, 1000);
        store.appendCandle(MARKET_ID, TIMEFRAME_1M, candle);

        assertEq(store.getCandleCount(MARKET_ID, TIMEFRAME_1M), 1);

        IOhlcStore.OhlcCandle memory retrieved = store.getLatestCandle(MARKET_ID, TIMEFRAME_1M);
        assertEq(retrieved.timestamp, candle.timestamp);
        assertEq(retrieved.open, candle.open);
        assertEq(retrieved.high, candle.high);
        assertEq(retrieved.low, candle.low);
        assertEq(retrieved.close, candle.close);
        assertEq(retrieved.volume, candle.volume);
    }

    function test_getCandles() public {
        vm.startPrank(CORE);
        for (uint256 i = 0; i < 5; i++) {
            store.appendCandle(MARKET_ID, TIMEFRAME_1M, _createCandle(1000 + i * 60, 100 + i));
        }
        vm.stopPrank();

        assertEq(store.getCandleCount(MARKET_ID, TIMEFRAME_1M), 5);

        IOhlcStore.OhlcCandle[] memory candles = store.getCandles(MARKET_ID, TIMEFRAME_1M, 3);
        assertEq(candles.length, 3);

        // Should return most recent 3 (oldest to newest)
        assertEq(candles[0].timestamp, 1120); // i=2
        assertEq(candles[1].timestamp, 1180); // i=3
        assertEq(candles[2].timestamp, 1240); // i=4
    }

    function test_getCandles_requestMoreThanExists() public {
        vm.startPrank(CORE);
        store.appendCandle(MARKET_ID, TIMEFRAME_1M, _createCandle(1000, 100));
        store.appendCandle(MARKET_ID, TIMEFRAME_1M, _createCandle(1060, 101));
        vm.stopPrank();

        // Request 10, but only 2 exist
        IOhlcStore.OhlcCandle[] memory candles = store.getCandles(MARKET_ID, TIMEFRAME_1M, 10);
        assertEq(candles.length, 2);
    }

    function test_revert_getLatestCandle_noCandles() public {
        vm.expectRevert(OhlcStore.NoCandles.selector);
        store.getLatestCandle(MARKET_ID, TIMEFRAME_1M);
    }

    function test_revert_appendCandle_notCore() public {
        IOhlcStore.OhlcCandle memory candle = _createCandle(1000, 100);

        vm.prank(NON_CORE);
        vm.expectRevert(CoreControlled.OnlyCoreAllowed.selector);
        store.appendCandle(MARKET_ID, TIMEFRAME_1M, candle);
    }

    function test_multipleTimeframes() public {
        vm.startPrank(CORE);
        store.appendCandle(MARKET_ID, TIMEFRAME_1M, _createCandle(1000, 100));
        store.appendCandle(MARKET_ID, TIMEFRAME_1H, _createCandle(3600, 200));
        vm.stopPrank();

        assertEq(store.getCandleCount(MARKET_ID, TIMEFRAME_1M), 1);
        assertEq(store.getCandleCount(MARKET_ID, TIMEFRAME_1H), 1);

        assertEq(store.getLatestCandle(MARKET_ID, TIMEFRAME_1M).open, 100);
        assertEq(store.getLatestCandle(MARKET_ID, TIMEFRAME_1H).open, 200);
    }

    function test_ringBuffer_maxCandles() public {
        uint256 maxCandles = store.MAX_CANDLES();

        vm.startPrank(CORE);
        // Fill to max
        for (uint256 i = 0; i < maxCandles; i++) {
            store.appendCandle(MARKET_ID, TIMEFRAME_1M, _createCandle(i * 60, 100 + i));
        }
        assertEq(store.getCandleCount(MARKET_ID, TIMEFRAME_1M), maxCandles);

        // Add one more - should trigger ring buffer
        store.appendCandle(MARKET_ID, TIMEFRAME_1M, _createCandle(maxCandles * 60, 9999));
        vm.stopPrank();

        // Count should still be max
        assertEq(store.getCandleCount(MARKET_ID, TIMEFRAME_1M), maxCandles);

        // Latest should be the new candle
        IOhlcStore.OhlcCandle memory latest = store.getLatestCandle(MARKET_ID, TIMEFRAME_1M);
        assertEq(latest.open, 9999);

        // Oldest should have been shifted out (i=0 removed, now i=1 is first)
        IOhlcStore.OhlcCandle[] memory candles = store.getCandles(MARKET_ID, TIMEFRAME_1M, maxCandles);
        assertEq(candles[0].timestamp, 60); // Was i=1, now shifted to position 0
    }

    function test_getCandles_empty() public view {
        IOhlcStore.OhlcCandle[] memory candles = store.getCandles(MARKET_ID, TIMEFRAME_1M, 10);
        assertEq(candles.length, 0);
    }
}
