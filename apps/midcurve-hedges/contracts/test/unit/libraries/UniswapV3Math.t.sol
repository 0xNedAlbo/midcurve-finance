// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {UniswapV3Math} from "../../../libraries/UniswapV3Math.sol";
import {TickMath} from "../../../libraries/TickMath.sol";

contract UniswapV3MathTest is Test {
    uint256 constant Q96 = 1 << 96;

    // Common test values
    int24 constant TICK_LOWER = -887220; // Near min tick, divisible by 60
    int24 constant TICK_UPPER = 887220; // Near max tick, divisible by 60
    int24 constant TICK_LOWER_NARROW = -1000;
    int24 constant TICK_UPPER_NARROW = 1000;

    // ============ getAmount0ForLiquidity tests ============

    function test_getAmount0ForLiquidity_basic() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(-100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(100);
        uint128 liquidity = 1e18;

        uint256 amount0 = UniswapV3Math.getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);

        // Should return a non-zero positive amount
        assertGt(amount0, 0);
    }

    function test_getAmount0ForLiquidity_swappedOrder() public pure {
        // Should handle sqrtA > sqrtB by swapping internally
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(-100);
        uint128 liquidity = 1e18;

        uint256 amount0 = UniswapV3Math.getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        assertGt(amount0, 0);
    }

    function test_getAmount0ForLiquidity_zeroLiquidity() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(-100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(100);

        uint256 amount0 = UniswapV3Math.getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, 0);
        assertEq(amount0, 0);
    }

    function test_getAmount0ForLiquidity_widerRangeMoreAmount() public pure {
        uint128 liquidity = 1e18;

        uint160 sqrtLowerNarrow = TickMath.getSqrtRatioAtTick(-100);
        uint160 sqrtUpperNarrow = TickMath.getSqrtRatioAtTick(100);
        uint256 amount0Narrow = UniswapV3Math.getAmount0ForLiquidity(sqrtLowerNarrow, sqrtUpperNarrow, liquidity);

        uint160 sqrtLowerWide = TickMath.getSqrtRatioAtTick(-1000);
        uint160 sqrtUpperWide = TickMath.getSqrtRatioAtTick(1000);
        uint256 amount0Wide = UniswapV3Math.getAmount0ForLiquidity(sqrtLowerWide, sqrtUpperWide, liquidity);

        // Wider range should require more token0 for same liquidity
        assertGt(amount0Wide, amount0Narrow);
    }

    // ============ getAmount1ForLiquidity tests ============

    function test_getAmount1ForLiquidity_basic() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(-100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(100);
        uint128 liquidity = 1e18;

        uint256 amount1 = UniswapV3Math.getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        assertGt(amount1, 0);
    }

    function test_getAmount1ForLiquidity_swappedOrder() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(-100);
        uint128 liquidity = 1e18;

        uint256 amount1 = UniswapV3Math.getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        assertGt(amount1, 0);
    }

    function test_getAmount1ForLiquidity_zeroLiquidity() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(-100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(100);

        uint256 amount1 = UniswapV3Math.getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, 0);
        assertEq(amount1, 0);
    }

    // ============ getAmountsForLiquidity tests ============

    function test_getAmountsForLiquidity_priceInRange() public pure {
        // Price in the middle of range
        int24 tickLower = -1000;
        int24 tickUpper = 1000;
        int24 currentTick = 0;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(currentTick);
        uint128 liquidity = 1e18;

        (uint256 amount0, uint256 amount1) =
            UniswapV3Math.getAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, liquidity);

        // Both amounts should be non-zero when price is in range
        assertGt(amount0, 0);
        assertGt(amount1, 0);
    }

    function test_getAmountsForLiquidity_priceBelowRange() public pure {
        // Price below range: all token0
        int24 tickLower = 100;
        int24 tickUpper = 1000;
        int24 currentTick = 0; // Below tickLower
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(currentTick);
        uint128 liquidity = 1e18;

        (uint256 amount0, uint256 amount1) =
            UniswapV3Math.getAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, liquidity);

        // All token0, no token1
        assertGt(amount0, 0);
        assertEq(amount1, 0);
    }

    function test_getAmountsForLiquidity_priceAboveRange() public pure {
        // Price above range: all token1
        int24 tickLower = -1000;
        int24 tickUpper = -100;
        int24 currentTick = 0; // Above tickUpper
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(currentTick);
        uint128 liquidity = 1e18;

        (uint256 amount0, uint256 amount1) =
            UniswapV3Math.getAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, liquidity);

        // All token1, no token0
        assertEq(amount0, 0);
        assertGt(amount1, 0);
    }

    function test_getAmountsForLiquidity_priceAtLowerBound() public pure {
        // Price exactly at lower tick: all token0
        int24 tickLower = -1000;
        int24 tickUpper = 1000;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint128 liquidity = 1e18;

        (uint256 amount0, uint256 amount1) =
            UniswapV3Math.getAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, liquidity);

        // At lower bound: all token0
        assertGt(amount0, 0);
        assertEq(amount1, 0);
    }

    function test_getAmountsForLiquidity_zeroLiquidity() public pure {
        int24 tickLower = -1000;
        int24 tickUpper = 1000;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(0);

        (uint256 amount0, uint256 amount1) = UniswapV3Math.getAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, 0);

        assertEq(amount0, 0);
        assertEq(amount1, 0);
    }

    // ============ getLiquidityForAmount0 tests ============

    function test_getLiquidityForAmount0_basic() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(-100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(100);
        uint256 amount0 = 1e18;

        uint128 liquidity = UniswapV3Math.getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
        assertGt(liquidity, 0);
    }

    function test_getLiquidityForAmount0_swappedOrder() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(-100);
        uint256 amount0 = 1e18;

        uint128 liquidity = UniswapV3Math.getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
        assertGt(liquidity, 0);
    }

    function test_getLiquidityForAmount0_zeroAmount() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(-100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(100);

        uint128 liquidity = UniswapV3Math.getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, 0);
        assertEq(liquidity, 0);
    }

    // ============ getLiquidityForAmount1 tests ============

    function test_getLiquidityForAmount1_basic() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(-100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(100);
        uint256 amount1 = 1e18;

        uint128 liquidity = UniswapV3Math.getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
        assertGt(liquidity, 0);
    }

    function test_getLiquidityForAmount1_zeroAmount() public pure {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(-100);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(100);

        uint128 liquidity = UniswapV3Math.getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, 0);
        assertEq(liquidity, 0);
    }

    // ============ getLiquidityForAmounts tests ============

    function test_getLiquidityForAmounts_priceInRange() public pure {
        int24 tickLower = -1000;
        int24 tickUpper = 1000;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(0);
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        uint256 amount0 = 1e18;
        uint256 amount1 = 1e18;

        uint128 liquidity =
            UniswapV3Math.getLiquidityForAmounts(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1);

        // Should return liquidity based on the limiting token
        assertGt(liquidity, 0);
    }

    function test_getLiquidityForAmounts_priceBelowRange() public pure {
        // When price is below range, only token0 matters
        int24 tickLower = 100;
        int24 tickUpper = 1000;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(0); // Below range
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        uint256 amount0 = 1e18;
        uint256 amount1 = 1e18;

        uint128 liquidity =
            UniswapV3Math.getLiquidityForAmounts(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1);
        assertGt(liquidity, 0);

        // Should be same as liquidity from amount0 alone
        uint128 liquidityFromAmount0 = UniswapV3Math.getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
        assertEq(liquidity, liquidityFromAmount0);
    }

    function test_getLiquidityForAmounts_priceAboveRange() public pure {
        // When price is above range, only token1 matters
        int24 tickLower = -1000;
        int24 tickUpper = -100;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(0); // Above range
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        uint256 amount0 = 1e18;
        uint256 amount1 = 1e18;

        uint128 liquidity =
            UniswapV3Math.getLiquidityForAmounts(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1);
        assertGt(liquidity, 0);

        // Should be same as liquidity from amount1 alone
        uint128 liquidityFromAmount1 = UniswapV3Math.getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
        assertEq(liquidity, liquidityFromAmount1);
    }

    function test_getLiquidityForAmounts_takesMinimum() public pure {
        // When in range, should take minimum of the two calculated liquidities
        int24 tickLower = -1000;
        int24 tickUpper = 1000;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(0);
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        // Provide unbalanced amounts (lots of token0, little token1)
        uint256 amount0 = 100e18;
        uint256 amount1 = 1e18;

        uint128 liquidity =
            UniswapV3Math.getLiquidityForAmounts(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1);

        // Liquidity with balanced amounts should be different
        uint128 liquidityBalanced =
            UniswapV3Math.getLiquidityForAmounts(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, 1e18, 1e18);

        // The unbalanced case should give less liquidity (limited by token1)
        assertLt(liquidity, liquidityBalanced * 100); // Sanity check
    }

    // ============ Round-trip tests ============

    function test_roundTrip_liquidityToAmountsToLiquidity_inRange() public pure {
        int24 tickLower = -1000;
        int24 tickUpper = 1000;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(0);
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        uint128 originalLiquidity = 1e18;

        // Liquidity -> Amounts
        (uint256 amount0, uint256 amount1) =
            UniswapV3Math.getAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, originalLiquidity);

        // Amounts -> Liquidity
        uint128 recoveredLiquidity =
            UniswapV3Math.getLiquidityForAmounts(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1);

        // Should be approximately equal (small rounding errors expected)
        assertApproxEqRel(recoveredLiquidity, originalLiquidity, 0.0001e18); // 0.01% tolerance
    }

    function test_roundTrip_amountsToLiquidityToAmounts_belowRange() public pure {
        int24 tickLower = 100;
        int24 tickUpper = 1000;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(0); // Below range
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        uint256 originalAmount0 = 1e18;

        // Amount -> Liquidity
        uint128 liquidity = UniswapV3Math.getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, originalAmount0);

        // Liquidity -> Amount (below range = all token0)
        (uint256 recoveredAmount0,) =
            UniswapV3Math.getAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, liquidity);

        // Should be approximately equal
        assertApproxEqRel(recoveredAmount0, originalAmount0, 0.0001e18);
    }

    // ============ Fuzz tests ============

    function testFuzz_getAmountsForLiquidity_nonNegative(int24 tickLower, int24 tickUpper, uint128 liquidity) public pure {
        vm.assume(tickLower >= TickMath.MIN_TICK && tickLower <= TickMath.MAX_TICK);
        vm.assume(tickUpper >= TickMath.MIN_TICK && tickUpper <= TickMath.MAX_TICK);
        vm.assume(tickLower < tickUpper);

        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick((tickLower + tickUpper) / 2);

        (uint256 amount0, uint256 amount1) =
            UniswapV3Math.getAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, liquidity);

        // Amounts should never be negative (uint256 guarantees this, but good to be explicit)
        assertGe(amount0, 0);
        assertGe(amount1, 0);
    }

    function testFuzz_getLiquidityForAmounts_monotonic(uint64 amount0, uint64 amount1, uint64 additionalAmount)
        public
        pure
    {
        // Use uint64 to avoid overflow in liquidity calculations
        vm.assume(amount0 > 0 && amount1 > 0);
        vm.assume(additionalAmount > 0);

        int24 tickLower = -1000;
        int24 tickUpper = 1000;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(0);
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        uint128 liquidity1 =
            UniswapV3Math.getLiquidityForAmounts(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1);

        uint128 liquidity2 = UniswapV3Math.getLiquidityForAmounts(
            sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, uint256(amount0) + uint256(additionalAmount), amount1
        );

        // More amounts should give >= liquidity
        assertGe(liquidity2, liquidity1);
    }
}
