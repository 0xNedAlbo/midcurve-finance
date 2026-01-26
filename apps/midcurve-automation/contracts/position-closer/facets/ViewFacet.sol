// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, CloseOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";

/// @title ViewFacet
/// @notice Facet for reading order state and configuration
/// @dev All functions are view-only
contract ViewFacet is Modifiers {
    // ========================================
    // ORDER VIEWS
    // ========================================

    /// @notice Get the full order details
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @return order The close order data
    function getOrder(uint256 nftId, TriggerMode triggerMode)
        external
        view
        returns (CloseOrder memory order)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        order = s.orders[key];
    }

    /// @notice Check if an order exists
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @return exists True if order exists
    function hasOrder(uint256 nftId, TriggerMode triggerMode)
        external
        view
        returns (bool exists)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        exists = s.orderExists[nftId][triggerMode];
    }

    /// @notice Check if an order can be executed (status, expiry, trigger)
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @return canExecute True if order can be executed now
    function canExecuteOrder(uint256 nftId, TriggerMode triggerMode)
        external
        view
        returns (bool canExecute)
    {
        AppStorage storage s = LibAppStorage.appStorage();

        // Check existence
        if (!s.orderExists[nftId][triggerMode]) {
            return false;
        }

        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        CloseOrder storage order = s.orders[key];

        // Check status
        if (order.status != OrderStatus.ACTIVE) {
            return false;
        }

        // Check expiry
        if (order.validUntil != 0 && block.timestamp > order.validUntil) {
            return false;
        }

        // Check trigger condition
        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(order.pool).slot0();

        if (triggerMode == TriggerMode.LOWER) {
            // LOWER triggers when price falls: currentTick <= triggerTick
            canExecute = currentTick <= order.triggerTick;
        } else {
            // UPPER triggers when price rises: currentTick >= triggerTick
            canExecute = currentTick >= order.triggerTick;
        }
    }

    // ========================================
    // POOL VIEWS
    // ========================================

    /// @notice Get the current tick from a pool
    /// @param pool The pool address
    /// @return tick The current tick
    function getCurrentTick(address pool) external view returns (int24 tick) {
        (, tick,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
    }

    // ========================================
    // CONFIGURATION VIEWS
    // ========================================

    /// @notice Get the position manager address
    /// @return The NonfungiblePositionManager address
    function positionManager() external view returns (address) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.positionManager;
    }

    /// @notice Get the Augustus registry address
    /// @return The Paraswap AugustusRegistry address
    function augustusRegistry() external view returns (address) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.augustusRegistry;
    }

    /// @notice Get the maximum fee in basis points
    /// @return The max fee bps (e.g., 100 = 1%)
    function maxFeeBps() external view returns (uint16) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.maxFeeBps;
    }
}
