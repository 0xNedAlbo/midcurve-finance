// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IUniswapV3PoolMinimal
/// @notice Minimal Uniswap V3 pool interface
interface IUniswapV3PoolMinimal {
    /// @notice The first of the two tokens of the pool, sorted by address
    function token0() external view returns (address);

    /// @notice The second of the two tokens of the pool, sorted by address
    function token1() external view returns (address);

    /// @notice The pool's fee in hundredths of a bip (1e-6)
    function fee() external view returns (uint24);

    /// @notice The 0th storage slot in the pool stores many values
    /// @return sqrtPriceX96 The current price of the pool as a sqrt(token1/token0) Q64.96 value
    /// @return tick The current tick of the pool
    /// @return observationIndex The index of the last oracle observation
    /// @return observationCardinality The current maximum number of observations stored
    /// @return observationCardinalityNext The next maximum number of observations
    /// @return feeProtocol The protocol fee
    /// @return unlocked Whether the pool is currently locked
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    /// @notice Swap token0 for token1, or token1 for token0
    /// @param recipient The address to receive the output of the swap
    /// @param zeroForOne The direction of the swap, true for token0 to token1
    /// @param amountSpecified The amount of the swap (positive = exact input, negative = exact output)
    /// @param sqrtPriceLimitX96 The Q64.96 sqrt price limit
    /// @param data Any data to be passed through to the callback
    /// @return amount0 The delta of the balance of token0 of the pool
    /// @return amount1 The delta of the balance of token1 of the pool
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}
