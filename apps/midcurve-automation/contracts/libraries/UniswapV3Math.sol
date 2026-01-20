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
}
