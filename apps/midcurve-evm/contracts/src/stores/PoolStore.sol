// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/CoreControlled.sol";
import "../interfaces/IPoolStore.sol";

/**
 * @title PoolStore
 * @notice Stores synchronized Uniswap V3 pool state data
 * @dev Pool data is written by the Core orchestrator and readable by any strategy.
 *      Pool IDs are computed off-chain as keccak256(abi.encodePacked(chainId, poolAddress)).
 */
contract PoolStore is CoreControlled, IPoolStore {
    /// @notice Mapping from pool ID to pool state
    mapping(bytes32 => PoolState) public pools;

    /// @inheritdoc IPoolStore
    function updatePool(bytes32 poolId, PoolState calldata state) external override onlyCore {
        pools[poolId] = state;
        emit PoolUpdated(poolId, state.sqrtPriceX96, state.tick);
    }

    /// @inheritdoc IPoolStore
    function getPool(bytes32 poolId) external view override returns (PoolState memory) {
        return pools[poolId];
    }

    /// @inheritdoc IPoolStore
    function getCurrentPrice(bytes32 poolId) external view override returns (uint160 sqrtPriceX96) {
        return pools[poolId].sqrtPriceX96;
    }

    /// @inheritdoc IPoolStore
    function getCurrentTick(bytes32 poolId) external view override returns (int24 tick) {
        return pools[poolId].tick;
    }
}
