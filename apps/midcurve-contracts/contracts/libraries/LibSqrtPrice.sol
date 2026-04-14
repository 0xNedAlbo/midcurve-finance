// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title LibSqrtPrice
/// @notice Library for converting token amounts using Uniswap V3 sqrtPriceX96
/// @dev sqrtPriceX96 = sqrt(token1/token0) * 2^96
///      price(token1/token0) = (sqrtPriceX96 / 2^96)^2
///      All math uses uint256 to avoid overflow in intermediate steps
library LibSqrtPrice {
    uint256 internal constant Q96 = 2 ** 96;

    /// @notice Convert an amount of token0 to its equivalent in token1 using sqrtPriceX96
    /// @param amount0 The amount of token0
    /// @param sqrtPriceX96 The pool's sqrtPriceX96
    /// @return amount1 The equivalent amount in token1
    function convertToken0ToToken1(uint256 amount0, uint160 sqrtPriceX96) internal pure returns (uint256 amount1) {
        // amount1 = amount0 * (sqrtPriceX96 / Q96)^2
        // Two-step mulDiv to keep full precision without 512-bit overflow
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        amount1 = Math.mulDiv(Math.mulDiv(amount0, sqrtPrice, Q96), sqrtPrice, Q96);
    }

    /// @notice Convert an amount of token1 to its equivalent in token0 using sqrtPriceX96
    /// @param amount1 The amount of token1
    /// @param sqrtPriceX96 The pool's sqrtPriceX96
    /// @return amount0 The equivalent amount in token0
    function convertToken1ToToken0(uint256 amount1, uint160 sqrtPriceX96) internal pure returns (uint256 amount0) {
        // amount0 = amount1 * (Q96 / sqrtPriceX96)^2
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        if (sqrtPrice == 0) return 0;
        amount0 = Math.mulDiv(Math.mulDiv(amount1, Q96, sqrtPrice), Q96, sqrtPrice);
    }
}
