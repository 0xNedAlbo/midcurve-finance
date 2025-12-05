// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPoolConsumer
 * @notice Interface for strategies that consume Uniswap V3 pool state updates
 * @dev Implement this interface to receive pool state callbacks from Core
 */
interface IPoolConsumer {
    /**
     * @notice Called when a pool's state is updated
     * @param poolId The pool identifier (keccak256 of "uniswapv3:{chainId}:{poolAddress}"))
     * @param chainId The chain ID where the pool exists
     * @param poolAddress The address of the Uniswap V3 pool contract
     * @param sqrtPriceX96 The current sqrt price as a Q64.96 value
     * @param tick The current tick of the pool
     * @param liquidity The current in-range liquidity
     * @param feeGrowthGlobal0X128 Global fee growth for token0
     * @param feeGrowthGlobal1X128 Global fee growth for token1
     */
    function onPoolStateUpdate(
        bytes32 poolId,
        uint256 chainId,
        address poolAddress,
        uint160 sqrtPriceX96,
        int24 tick,
        uint128 liquidity,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128
    ) external;
}
