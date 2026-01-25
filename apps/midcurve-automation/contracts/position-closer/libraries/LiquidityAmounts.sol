// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title LiquidityAmounts
/// @notice Provides functions for computing liquidity amounts from token amounts and prices
/// @dev Adapted from Uniswap V3 periphery LiquidityAmounts library
library LiquidityAmounts {
    /// @notice Computes the token0 and token1 value for a given amount of liquidity
    /// @param sqrtRatioX96 A sqrt price representing the current pool price
    /// @param sqrtRatioAX96 A sqrt price representing the first tick boundary
    /// @param sqrtRatioBX96 A sqrt price representing the second tick boundary
    /// @param liquidity The liquidity being valued
    /// @return amount0 The amount of token0
    /// @return amount1 The amount of token1
    function getAmountsForLiquidity(
        uint160 sqrtRatioX96,
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        unchecked {
            if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

            if (sqrtRatioX96 <= sqrtRatioAX96) {
                amount0 = getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
            } else if (sqrtRatioX96 < sqrtRatioBX96) {
                amount0 = getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity);
                amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity);
            } else {
                amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
            }
        }
    }

    /// @notice Computes the amount of token0 for a given amount of liquidity and a price range
    function getAmount0ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity)
        internal
        pure
        returns (uint256 amount0)
    {
        unchecked {
            if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
            uint256 intermediate = (uint256(liquidity) << 96) / sqrtRatioAX96;
            amount0 = (intermediate * (sqrtRatioBX96 - sqrtRatioAX96)) / sqrtRatioBX96;
        }
    }

    /// @notice Computes the amount of token1 for a given amount of liquidity and a price range
    function getAmount1ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity)
        internal
        pure
        returns (uint256 amount1)
    {
        unchecked {
            if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
            amount1 = (uint256(liquidity) * (sqrtRatioBX96 - sqrtRatioAX96)) / (1 << 96);
        }
    }
}
