// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FullMath} from "../../../libraries/FullMath.sol";

/// @dev Harness contract to expose library functions as external calls for revert testing
contract FullMathHarness {
    function mulDiv(uint256 a, uint256 b, uint256 denominator) external pure returns (uint256) {
        return FullMath.mulDiv(a, b, denominator);
    }

    function mulDivRoundingUp(uint256 a, uint256 b, uint256 denominator) external pure returns (uint256) {
        return FullMath.mulDivRoundingUp(a, b, denominator);
    }
}

contract FullMathTest is Test {
    FullMathHarness harness;

    function setUp() public {
        harness = new FullMathHarness();
    }

    // ============ mulDiv tests ============

    function test_mulDiv_simpleCase() public pure {
        // 10 * 20 / 5 = 40
        uint256 result = FullMath.mulDiv(10, 20, 5);
        assertEq(result, 40);
    }

    function test_mulDiv_zeroNumerator() public pure {
        // 0 * 100 / 5 = 0
        uint256 result = FullMath.mulDiv(0, 100, 5);
        assertEq(result, 0);
    }

    function test_mulDiv_oneMultiplier() public pure {
        // 100 * 1 / 10 = 10
        uint256 result = FullMath.mulDiv(100, 1, 10);
        assertEq(result, 10);
    }

    function test_mulDiv_largeNumbers() public pure {
        // Test with numbers that would overflow if multiplied directly
        // (2^128) * (2^128) / (2^128) = 2^128
        uint256 a = 1 << 128;
        uint256 b = 1 << 128;
        uint256 result = FullMath.mulDiv(a, b, a);
        assertEq(result, b);
    }

    function test_mulDiv_maxUint256() public pure {
        // type(uint256).max * 1 / 1 = type(uint256).max
        uint256 result = FullMath.mulDiv(type(uint256).max, 1, 1);
        assertEq(result, type(uint256).max);
    }

    function test_mulDiv_floorDivision() public pure {
        // 10 * 3 / 7 = 30 / 7 = 4 (floor)
        uint256 result = FullMath.mulDiv(10, 3, 7);
        assertEq(result, 4);
    }

    function test_mulDiv_exactDivision() public pure {
        // 12 * 5 / 4 = 60 / 4 = 15 (exact)
        uint256 result = FullMath.mulDiv(12, 5, 4);
        assertEq(result, 15);
    }

    function test_mulDiv_revertsOnZeroDenominator() public {
        vm.expectRevert(bytes("DIV0"));
        harness.mulDiv(10, 20, 0);
    }

    function test_mulDiv_revertsOnOverflow() public {
        // If a * b > type(uint256).max and denominator is too small
        // (2^255) * 4 / 1 would overflow
        vm.expectRevert(bytes("OVERFLOW"));
        harness.mulDiv(1 << 255, 4, 1);
    }

    function test_mulDiv_512bitIntermediate() public pure {
        // Test 512-bit intermediate: (2^200) * (2^200) / (2^200) = 2^200
        uint256 a = 1 << 200;
        uint256 b = 1 << 200;
        uint256 denom = 1 << 200;
        uint256 result = FullMath.mulDiv(a, b, denom);
        assertEq(result, 1 << 200);
    }

    function test_mulDiv_precisionPreservation() public pure {
        // Common DeFi pattern: scale by 1e18 then divide
        // (1e18 * 1e18) / 1e18 = 1e18
        uint256 result = FullMath.mulDiv(1e18, 1e18, 1e18);
        assertEq(result, 1e18);
    }

    function test_mulDiv_uniswapQ96Pattern() public pure {
        // Test Q96 math pattern used in Uniswap
        uint256 Q96 = 1 << 96;
        uint256 liquidity = 1e18;
        uint256 sqrtDiff = Q96 / 2;

        // liquidity * sqrtDiff / Q96
        uint256 result = FullMath.mulDiv(liquidity, sqrtDiff, Q96);
        assertEq(result, liquidity / 2);
    }

    // ============ mulDivRoundingUp tests ============

    function test_mulDivRoundingUp_simpleCase() public pure {
        // 10 * 20 / 5 = 40 (exact, no rounding)
        uint256 result = FullMath.mulDivRoundingUp(10, 20, 5);
        assertEq(result, 40);
    }

    function test_mulDivRoundingUp_roundsUp() public pure {
        // 10 * 3 / 7 = 30 / 7 = 4.28... -> rounds up to 5
        uint256 result = FullMath.mulDivRoundingUp(10, 3, 7);
        assertEq(result, 5);
    }

    function test_mulDivRoundingUp_exactDivision() public pure {
        // 12 * 5 / 4 = 15 (exact, no rounding needed)
        uint256 result = FullMath.mulDivRoundingUp(12, 5, 4);
        assertEq(result, 15);
    }

    function test_mulDivRoundingUp_alwaysRoundsUpOnRemainder() public pure {
        // 1 * 1 / 3 = 0.33... -> rounds up to 1
        uint256 result = FullMath.mulDivRoundingUp(1, 1, 3);
        assertEq(result, 1);
    }

    function test_mulDivRoundingUp_zeroResult() public pure {
        // 0 * 100 / 5 = 0 (no rounding needed)
        uint256 result = FullMath.mulDivRoundingUp(0, 100, 5);
        assertEq(result, 0);
    }

    function test_mulDivRoundingUp_revertsOnZeroDenominator() public {
        vm.expectRevert(bytes("DIV0"));
        harness.mulDivRoundingUp(10, 20, 0);
    }

    function test_mulDivRoundingUp_revertsOnOverflow() public {
        // Same overflow case as mulDiv - when result would exceed uint256
        vm.expectRevert(bytes("OVERFLOW"));
        harness.mulDivRoundingUp(1 << 255, 4, 1);
    }

    // ============ Comparison tests (mulDiv vs mulDivRoundingUp) ============

    function test_mulDiv_vs_mulDivRoundingUp_noRemainder() public pure {
        // When there's no remainder, both should return the same value
        uint256 floor = FullMath.mulDiv(100, 10, 5);
        uint256 ceil = FullMath.mulDivRoundingUp(100, 10, 5);
        assertEq(floor, ceil);
        assertEq(floor, 200);
    }

    function test_mulDiv_vs_mulDivRoundingUp_withRemainder() public pure {
        // When there's a remainder, ceil should be floor + 1
        uint256 floor = FullMath.mulDiv(100, 3, 7);
        uint256 ceil = FullMath.mulDivRoundingUp(100, 3, 7);
        assertEq(ceil, floor + 1);
    }

    // ============ Fuzz tests ============

    function testFuzz_mulDiv_commutative(uint128 a, uint128 b, uint128 denom) public pure {
        vm.assume(denom > 0);

        uint256 result1 = FullMath.mulDiv(uint256(a), uint256(b), uint256(denom));
        uint256 result2 = FullMath.mulDiv(uint256(b), uint256(a), uint256(denom));

        assertEq(result1, result2);
    }

    function testFuzz_mulDiv_identity(uint128 a, uint128 denom) public pure {
        vm.assume(denom > 0);

        // a * denom / denom = a
        uint256 result = FullMath.mulDiv(uint256(a), uint256(denom), uint256(denom));
        assertEq(result, uint256(a));
    }

    function testFuzz_mulDivRoundingUp_geqFloor(uint128 a, uint128 b, uint128 denom) public pure {
        vm.assume(denom > 0);

        uint256 floor = FullMath.mulDiv(uint256(a), uint256(b), uint256(denom));
        uint256 ceil = FullMath.mulDivRoundingUp(uint256(a), uint256(b), uint256(denom));

        assertGe(ceil, floor);
        assertLe(ceil, floor + 1);
    }
}
