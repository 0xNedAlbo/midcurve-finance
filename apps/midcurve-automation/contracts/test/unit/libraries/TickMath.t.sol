// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "../../../libraries/TickMath.sol";

/// @dev Harness contract to expose library functions as external calls for revert testing
contract TickMathHarness {
    function getSqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    function getTickAtSqrtRatio(uint160 sqrtPriceX96) external pure returns (int24) {
        return TickMath.getTickAtSqrtRatio(sqrtPriceX96);
    }
}

contract TickMathTest is Test {
    TickMathHarness harness;

    // Known constants from Uniswap V3
    int24 constant MIN_TICK = -887272;
    int24 constant MAX_TICK = 887272;
    uint160 constant MIN_SQRT_RATIO = 4295128739;
    uint160 constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    function setUp() public {
        harness = new TickMathHarness();
    }

    // ============ getSqrtRatioAtTick tests ============

    function test_getSqrtRatioAtTick_minTick() public pure {
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(MIN_TICK);
        assertEq(sqrtPrice, MIN_SQRT_RATIO);
    }

    function test_getSqrtRatioAtTick_maxTick() public pure {
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(MAX_TICK);
        assertEq(sqrtPrice, MAX_SQRT_RATIO);
    }

    function test_getSqrtRatioAtTick_zero() public pure {
        // At tick 0, sqrt(1.0001^0) = sqrt(1) = 1
        // In Q64.96 format: 1 * 2^96 = 79228162514264337593543950336
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(0);
        uint160 Q96 = 1 << 96;
        assertEq(sqrtPrice, Q96);
    }

    function test_getSqrtRatioAtTick_positive() public pure {
        // Tick 1: sqrt(1.0001^1) = sqrt(1.0001) ≈ 1.00005
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(1);
        uint160 Q96 = 1 << 96;
        // Should be slightly greater than Q96
        assertGt(sqrtPrice, Q96);
    }

    function test_getSqrtRatioAtTick_negative() public pure {
        // Tick -1: sqrt(1.0001^-1) = sqrt(1/1.0001) ≈ 0.99995
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(-1);
        uint160 Q96 = 1 << 96;
        // Should be slightly less than Q96
        assertLt(sqrtPrice, Q96);
    }

    function test_getSqrtRatioAtTick_symmetry() public pure {
        // sqrt(1.0001^tick) * sqrt(1.0001^-tick) = 1
        // So sqrtPrice(tick) * sqrtPrice(-tick) ≈ Q96^2
        int24 tick = 1000;
        uint160 sqrtPricePos = TickMath.getSqrtRatioAtTick(tick);
        uint160 sqrtPriceNeg = TickMath.getSqrtRatioAtTick(-tick);

        // Product should be close to 2^192 (Q96 * Q96)
        uint256 product = uint256(sqrtPricePos) * uint256(sqrtPriceNeg);
        uint256 Q192 = uint256(1) << 192;

        // Allow small rounding error (0.01%)
        assertApproxEqRel(product, Q192, 0.0001e18);
    }

    function test_getSqrtRatioAtTick_knownValue_tick100() public pure {
        // Known value from Uniswap V3 SDK for tick 100
        // sqrt(1.0001^100) * 2^96 ≈ 79624299138508333417982196089
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(100);
        // Verify it's in reasonable range (slightly above Q96)
        uint160 Q96 = 1 << 96;
        assertGt(sqrtPrice, Q96);
        assertLt(sqrtPrice, Q96 + Q96 / 100); // Less than 1% above
    }

    function test_getSqrtRatioAtTick_revertsAboveMaxTick() public {
        vm.expectRevert(bytes("T"));
        harness.getSqrtRatioAtTick(MAX_TICK + 1);
    }

    function test_getSqrtRatioAtTick_revertsBelowMinTick() public {
        vm.expectRevert(bytes("T"));
        harness.getSqrtRatioAtTick(MIN_TICK - 1);
    }

    function test_getSqrtRatioAtTick_monotonicallyIncreasing() public pure {
        // sqrtPrice should increase as tick increases
        int24[5] memory ticks = [int24(-1000), int24(-100), int24(0), int24(100), int24(1000)];

        uint160 prevSqrtPrice = 0;
        for (uint256 i = 0; i < ticks.length; i++) {
            uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(ticks[i]);
            assertGt(sqrtPrice, prevSqrtPrice);
            prevSqrtPrice = sqrtPrice;
        }
    }

    // ============ getTickAtSqrtRatio tests ============

    function test_getTickAtSqrtRatio_minSqrtRatio() public pure {
        int24 tick = TickMath.getTickAtSqrtRatio(MIN_SQRT_RATIO);
        assertEq(tick, MIN_TICK);
    }

    function test_getTickAtSqrtRatio_belowMaxSqrtRatio() public pure {
        // getTickAtSqrtRatio requires sqrtPriceX96 < MAX_SQRT_RATIO
        int24 tick = TickMath.getTickAtSqrtRatio(MAX_SQRT_RATIO - 1);
        // Should return MAX_TICK - 1 or close to it
        assertLe(tick, MAX_TICK);
        assertGe(tick, MAX_TICK - 1);
    }

    function test_getTickAtSqrtRatio_Q96() public pure {
        // At sqrtPrice = Q96 (representing price = 1), tick should be 0
        uint160 Q96 = 1 << 96;
        int24 tick = TickMath.getTickAtSqrtRatio(Q96);
        assertEq(tick, 0);
    }

    function test_getTickAtSqrtRatio_revertsAtMaxSqrtRatio() public {
        vm.expectRevert(bytes("R"));
        harness.getTickAtSqrtRatio(MAX_SQRT_RATIO);
    }

    function test_getTickAtSqrtRatio_revertsBelowMinSqrtRatio() public {
        vm.expectRevert(bytes("R"));
        harness.getTickAtSqrtRatio(MIN_SQRT_RATIO - 1);
    }

    function test_getTickAtSqrtRatio_revertsAtZero() public {
        vm.expectRevert(bytes("R"));
        harness.getTickAtSqrtRatio(0);
    }

    // ============ Round-trip tests ============

    function test_roundTrip_getSqrtThenTick() public pure {
        // getSqrtRatioAtTick(getTickAtSqrtRatio(x)) should be close to x
        // But getTickAtSqrtRatio returns floor, so we test the other direction
        int24 originalTick = 12345;
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(originalTick);
        int24 recoveredTick = TickMath.getTickAtSqrtRatio(sqrtPrice);

        // Due to floor behavior, recovered tick should equal original
        assertEq(recoveredTick, originalTick);
    }

    function test_roundTrip_negativeTick() public pure {
        int24 originalTick = -54321;
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(originalTick);
        int24 recoveredTick = TickMath.getTickAtSqrtRatio(sqrtPrice);

        assertEq(recoveredTick, originalTick);
    }

    function test_roundTrip_zeroTick() public pure {
        int24 originalTick = 0;
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(originalTick);
        int24 recoveredTick = TickMath.getTickAtSqrtRatio(sqrtPrice);

        assertEq(recoveredTick, originalTick);
    }

    // ============ Edge case tests ============

    function test_getSqrtRatioAtTick_commonPoolTicks() public pure {
        // Test common fee tier tick spacings
        // 0.05% fee tier: tick spacing 10
        // 0.3% fee tier: tick spacing 60
        // 1% fee tier: tick spacing 200

        // USDC/ETH-like position: ticks around 200000
        uint160 sqrtPrice1 = TickMath.getSqrtRatioAtTick(200000);
        assertGt(sqrtPrice1, 0);

        // BTC/ETH-like position: ticks around 50000
        uint160 sqrtPrice2 = TickMath.getSqrtRatioAtTick(50000);
        assertGt(sqrtPrice2, 0);

        // Stablecoin pair: ticks near 0
        uint160 sqrtPrice3 = TickMath.getSqrtRatioAtTick(100);
        assertGt(sqrtPrice3, 0);
    }

    // ============ Fuzz tests ============

    function testFuzz_getSqrtRatioAtTick_inRange(int24 tick) public pure {
        vm.assume(tick >= MIN_TICK && tick <= MAX_TICK);

        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(tick);

        // Result should be within valid range
        assertGe(sqrtPrice, MIN_SQRT_RATIO);
        assertLe(sqrtPrice, MAX_SQRT_RATIO);
    }

    function testFuzz_getTickAtSqrtRatio_inRange(uint160 sqrtPriceX96) public pure {
        vm.assume(sqrtPriceX96 >= MIN_SQRT_RATIO && sqrtPriceX96 < MAX_SQRT_RATIO);

        int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);

        // Result should be within valid range
        assertGe(tick, MIN_TICK);
        assertLe(tick, MAX_TICK);
    }

    function testFuzz_roundTrip_tickToSqrtToTick(int24 tick) public pure {
        vm.assume(tick >= MIN_TICK && tick <= MAX_TICK);

        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(tick);
        int24 recoveredTick = TickMath.getTickAtSqrtRatio(sqrtPrice);

        // Should recover the exact same tick
        assertEq(recoveredTick, tick);
    }

    function testFuzz_monotonicity(int24 tickA, int24 tickB) public pure {
        vm.assume(tickA >= MIN_TICK && tickA <= MAX_TICK);
        vm.assume(tickB >= MIN_TICK && tickB <= MAX_TICK);
        vm.assume(tickA < tickB);

        uint160 sqrtPriceA = TickMath.getSqrtRatioAtTick(tickA);
        uint160 sqrtPriceB = TickMath.getSqrtRatioAtTick(tickB);

        // Higher tick should give higher sqrtPrice
        assertLt(sqrtPriceA, sqrtPriceB);
    }
}
