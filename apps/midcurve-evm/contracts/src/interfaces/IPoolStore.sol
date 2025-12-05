// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPoolStore
 * @notice Interface for storing synchronized Uniswap V3 pool state data
 */
interface IPoolStore {
    /// @notice Pool state data structure
    struct PoolState {
        uint256 chainId;
        address poolAddress;
        address token0;
        address token1;
        uint24 fee;
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
        uint256 feeGrowthGlobal0X128;
        uint256 feeGrowthGlobal1X128;
        uint256 lastUpdated;
    }

    /// @notice Updates the state of a pool (Core only)
    /// @param poolId The unique identifier for the pool
    /// @param state The new pool state
    function updatePool(bytes32 poolId, PoolState calldata state) external;

    /// @notice Returns the full state of a pool
    /// @param poolId The unique identifier for the pool
    /// @return The pool state
    function getPool(bytes32 poolId) external view returns (PoolState memory);

    /// @notice Returns the current sqrtPriceX96 of a pool
    /// @param poolId The unique identifier for the pool
    /// @return sqrtPriceX96 The current price
    function getCurrentPrice(bytes32 poolId) external view returns (uint160 sqrtPriceX96);

    /// @notice Returns the current tick of a pool
    /// @param poolId The unique identifier for the pool
    /// @return tick The current tick
    function getCurrentTick(bytes32 poolId) external view returns (int24 tick);

    /// @notice Emitted when a pool state is updated
    event PoolUpdated(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick);
}
