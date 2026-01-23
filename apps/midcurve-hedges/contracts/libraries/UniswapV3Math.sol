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

    /// @dev Indicates which token the vault currently holds 100% (ignoring dust).
    enum SingleSidedInput {
        TOKEN0_ONLY,
        TOKEN1_ONLY
    }

    /// @notice Computes how much of the single-sided `inputAmount` should be swapped
    ///         into the other token so that, at the current pool price, the resulting
    ///         (token0, token1) mix matches the *in-range* Uniswap V3 geometry for
    ///         the range [sqrtRatioAX96, sqrtRatioBX96].
    ///
    /// @dev Out-of-range handling:
    ///      - If sqrtP <= sqrtA: ideal holdings for this position are 100% token0.
    ///          * TOKEN0_ONLY -> swap 0
    ///          * TOKEN1_ONLY -> swap all (token1 -> token0)
    ///      - If sqrtP >= sqrtB: ideal holdings are 100% token1.
    ///          * TOKEN1_ONLY -> swap 0
    ///          * TOKEN0_ONLY -> swap all (token0 -> token1)
    ///
    /// @param inputAmount      Amount of the token you currently hold
    /// @param sqrtRatioX96     Current pool sqrtPriceX96
    /// @param sqrtRatioAX96    Lower bound sqrtPriceX96 (range lower)
    /// @param sqrtRatioBX96    Upper bound sqrtPriceX96 (range upper)
    /// @param inputType        Which token you hold: TOKEN0_ONLY or TOKEN1_ONLY
    /// @return swapAmountIn    Amount of the input token to swap into the other token
    function computeIdealSwapAmountSingleSided(
        uint256 inputAmount,
        uint160 sqrtRatioX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        SingleSidedInput inputType
    ) internal pure returns (uint256 swapAmountIn) {
        uint256 sqrtP = uint256(sqrtRatioX96);
        uint256 sqrtA = uint256(sqrtRatioAX96);
        uint256 sqrtB = uint256(sqrtRatioBX96);

        // Basic config guard
        require(sqrtA < sqrtB, "INVALID_RANGE");

        // ---------- Out-of-range cases ----------
        // Below range: position wants only token0
        if (sqrtP <= sqrtA) {
            return (inputType == SingleSidedInput.TOKEN1_ONLY) ? inputAmount : 0;
        }

        // Above range: position wants only token1
        if (sqrtP >= sqrtB) {
            return (inputType == SingleSidedInput.TOKEN0_ONLY) ? inputAmount : 0;
        }

        // ---------- In-range case ----------
        uint256 Q96_VAL = Q96;

        // P_Q96 = sqrtP^2 / 2^96 (Q96-scaled)
        uint256 P_Q96 = FullMath.mulDiv(sqrtP, sqrtP, Q96_VAL);

        // R = ((sqrtP - sqrtA) * sqrtP * sqrtB) / (sqrtB - sqrtP)
        // R_Q96 computed as: t = (sqrtP * sqrtB) / Q96, R_Q96 = (sqrtP - sqrtA) * t / (sqrtB - sqrtP)
        uint256 t_Q96 = FullMath.mulDiv(sqrtP, sqrtB, Q96_VAL);
        uint256 R_Q96 = FullMath.mulDiv(sqrtP - sqrtA, t_Q96, sqrtB - sqrtP);

        // denom = R_Q96 + P_Q96 (both Q96)
        require(R_Q96 <= type(uint256).max - P_Q96, "OVERFLOW");
        uint256 denom = R_Q96 + P_Q96;
        if (denom == 0) return 0;

        if (inputType == SingleSidedInput.TOKEN0_ONLY) {
            // swap token0 -> token1
            swapAmountIn = FullMath.mulDiv(inputAmount, R_Q96, denom);
        } else {
            // swap token1 -> token0
            swapAmountIn = FullMath.mulDiv(inputAmount, P_Q96, denom);
        }

        if (swapAmountIn > inputAmount) swapAmountIn = inputAmount;
    }
}
