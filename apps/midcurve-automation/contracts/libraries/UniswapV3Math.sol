// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FullMath} from "./FullMath.sol";
import {TickMath} from "./TickMath.sol";

library UniswapV3Math {
    uint256 internal constant Q96 = 0x1000000000000000000000000; // 2**96

    /// @notice Computes the token0 and token1 amounts for a given liquidity and price range
    /// @dev Matches Uniswap V3 periphery LiquidityAmounts.getAmountsForLiquidity behavior.
    function getAmountsForLiquidity(
        uint160 sqrtRatioX96,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            // current price below the range: all token0
            amount0 = getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
            // current price inside the range: both tokens
            amount0 = getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity);
            amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity);
        } else {
            // current price above the range: all token1
            amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
        }
    }

    /// @notice Computes token0 amount for liquidity between sqrtRatioAX96 and sqrtRatioBX96
    /// @dev Equivalent to Uniswap V3 periphery:
    ///      amount0 = liquidity * (sqrtB - sqrtA) / (sqrtB * sqrtA) * Q96
    function getAmount0ForLiquidity(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity
    ) internal pure returns (uint256 amount0) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        require(sqrtRatioAX96 > 0, "SQRT_A_0");

        uint256 numerator1 = uint256(liquidity) << 96; // liquidity * Q96
        uint256 numerator2 = uint256(sqrtRatioBX96) - uint256(sqrtRatioAX96);

        // amount0 = (liquidity * Q96) * (sqrtB - sqrtA) / (sqrtB * sqrtA)
        // Compute as: FullMath.mulDiv(numerator1, numerator2, sqrtB) / sqrtA
        // This matches the periphery implementation and avoids overflow of sqrtB*sqrtA.
        uint256 tmp = FullMath.mulDiv(numerator1, numerator2, uint256(sqrtRatioBX96));
        amount0 = tmp / uint256(sqrtRatioAX96);
    }

    /// @notice Computes token1 amount for liquidity between sqrtRatioAX96 and sqrtRatioBX96
    /// @dev Equivalent to Uniswap V3 periphery:
    ///      amount1 = liquidity * (sqrtB - sqrtA) / Q96
    function getAmount1ForLiquidity(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity
    ) internal pure returns (uint256 amount1) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        amount1 = FullMath.mulDiv(
            uint256(liquidity),
            uint256(sqrtRatioBX96) - uint256(sqrtRatioAX96),
            Q96
        );
    }

    // ============ Liquidity for Amounts (inverse calculations) ============

    /// @notice Downcasts uint256 to uint128
    /// @param x The uint256 to be downcasted
    /// @return y The passed value, downcasted to uint128
    function toUint128(uint256 x) private pure returns (uint128 y) {
        require((y = uint128(x)) == x);
    }

    /// @notice Computes the amount of liquidity received for a given amount of token0 and price range
    /// @dev Calculates amount0 * (sqrt(upper) * sqrt(lower)) / (sqrt(upper) - sqrt(lower))
    /// @param sqrtRatioAX96 A sqrt price representing the first tick boundary
    /// @param sqrtRatioBX96 A sqrt price representing the second tick boundary
    /// @param amount0 The amount0 being sent in
    /// @return liquidity The amount of returned liquidity
    function getLiquidityForAmount0(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint256 amount0
    ) internal pure returns (uint128 liquidity) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        uint256 intermediate = FullMath.mulDiv(sqrtRatioAX96, sqrtRatioBX96, Q96);
        return toUint128(FullMath.mulDiv(amount0, intermediate, sqrtRatioBX96 - sqrtRatioAX96));
    }

    /// @notice Computes the amount of liquidity received for a given amount of token1 and price range
    /// @dev Calculates amount1 / (sqrt(upper) - sqrt(lower))
    /// @param sqrtRatioAX96 A sqrt price representing the first tick boundary
    /// @param sqrtRatioBX96 A sqrt price representing the second tick boundary
    /// @param amount1 The amount1 being sent in
    /// @return liquidity The amount of returned liquidity
    function getLiquidityForAmount1(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint256 amount1
    ) internal pure returns (uint128 liquidity) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        return toUint128(FullMath.mulDiv(amount1, Q96, sqrtRatioBX96 - sqrtRatioAX96));
    }

    /// @notice Computes the maximum amount of liquidity received for a given amount of token0, token1,
    /// the current pool prices and the prices at the tick boundaries
    /// @param sqrtRatioX96 A sqrt price representing the current pool prices
    /// @param sqrtRatioAX96 A sqrt price representing the first tick boundary
    /// @param sqrtRatioBX96 A sqrt price representing the second tick boundary
    /// @param amount0 The amount of token0 being sent in
    /// @param amount1 The amount of token1 being sent in
    /// @return liquidity The maximum amount of liquidity received
    function getLiquidityForAmounts(
        uint160 sqrtRatioX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint128 liquidity) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            liquidity = getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
            uint128 liquidity0 = getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0);
            uint128 liquidity1 = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1);
            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        } else {
            liquidity = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
        }
    }

    // ============ Swap Amount Calculations ============

    /// @notice Compute ideal in-range swap cap in QUOTE units (no fee/impact), derived from Uniswap V3 geometry.
    /// @dev Returns how much QUOTE we are willing to spend in an exact-out swap (maxQuoteIn).
    /// @param quoteAmount Total quote budget to allocate
    /// @param sqrtRatioX96 Current pool sqrt price
    /// @param sqrtRatioAX96 Lower tick sqrt price (must be < sqrtRatioBX96)
    /// @param sqrtRatioBX96 Upper tick sqrt price (must be > sqrtRatioAX96)
    /// @param token0IsQuote True if token0 is the quote token, false if token1 is quote
    /// @return maxQuoteIn Ideal amount of quote to swap
    function computeIdealInRangeSwapQuote(
        uint256 quoteAmount,
        uint160 sqrtRatioX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        bool token0IsQuote
    ) internal pure returns (uint256 maxQuoteIn) {
        // Compute R = amount1/amount0 from V3 geometry (in-range):
        // R = ((sqrtP - sqrtA) * sqrtP * sqrtB) / (sqrtB - sqrtP)
        uint256 sqrtP = uint256(sqrtRatioX96);
        uint256 sqrtA = uint256(sqrtRatioAX96);
        uint256 sqrtB = uint256(sqrtRatioBX96);

        uint256 num1 = sqrtP - sqrtA;
        uint256 num2 = FullMath.mulDiv(num1, sqrtP, 1);
        uint256 num3 = FullMath.mulDiv(num2, sqrtB, 1);
        uint256 den = sqrtB - sqrtP;

        uint256 R = FullMath.mulDiv(num3, 1, den);

        // P = token1 per token0 at current price (raw, no decimals adjustment)
        uint256 P = FullMath.mulDiv(sqrtP, sqrtP, 2 ** 192);

        uint256 denom = R + P;
        if (denom == 0) return 0;

        // If quote is token0: swap cap = quoteAmount * R / (R + P)
        // If quote is token1: swap cap = quoteAmount * P / (R + P)
        if (token0IsQuote) {
            maxQuoteIn = FullMath.mulDiv(quoteAmount, R, denom);
        } else {
            maxQuoteIn = FullMath.mulDiv(quoteAmount, P, denom);
        }

        if (maxQuoteIn > quoteAmount) maxQuoteIn = quoteAmount;
    }

    /// @notice Convert quote->base at current pool price (no fee/impact).
    /// @dev Used to derive an *ideal* baseOut target for exact-out swaps.
    ///      In production you should rely on actual deltas after executing the swap.
    /// @param quoteIn Amount of quote tokens to convert
    /// @param sqrtRatioX96 Current pool sqrt price
    /// @param token0IsQuote True if token0 is the quote token, false if token1 is quote
    /// @return baseOut Estimated base tokens received
    function quoteToBaseAtPrice(
        uint256 quoteIn,
        uint160 sqrtRatioX96,
        bool token0IsQuote
    ) internal pure returns (uint256 baseOut) {
        uint256 sqrtP = uint256(sqrtRatioX96);
        uint256 P = FullMath.mulDiv(sqrtP, sqrtP, 2 ** 192); // token1 per token0

        if (token0IsQuote) {
            // quote=token0, base=token1 => baseOut ≈ quoteIn * P
            baseOut = FullMath.mulDiv(quoteIn, P, 1);
        } else {
            // quote=token1, base=token0 => baseOut ≈ quoteIn / P
            if (P == 0) return 0;
            baseOut = FullMath.mulDiv(quoteIn, 1, P);
        }
    }
}
