// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, VaultCloseOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3PoolMinimal} from "../../position-closer/interfaces/IUniswapV3PoolMinimal.sol";

/// @title ViewFacet
/// @notice Facet for reading vault close order state and configuration
/// @dev All functions are view-only
contract ViewFacet is Modifiers {
    // ========================================
    // ORDER VIEWS
    // ========================================

    /// @notice Get the full order details
    /// @param vault The vault address
    /// @param owner The share holder address
    /// @param triggerMode The trigger mode
    /// @return order The vault close order data
    function getOrder(address vault, address owner, TriggerMode triggerMode)
        external
        view
        returns (VaultCloseOrder memory order)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, owner, triggerMode);
        order = s.orders[key];
    }

    /// @notice Check if an order exists
    /// @param vault The vault address
    /// @param owner The share holder address
    /// @param triggerMode The trigger mode
    /// @return exists True if order exists
    function hasOrder(address vault, address owner, TriggerMode triggerMode)
        external
        view
        returns (bool exists)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        exists = s.orderExists[vault][owner][triggerMode];
    }

    /// @notice Check if an order can be executed (status, expiry, trigger)
    /// @param vault The vault address
    /// @param owner The share holder address
    /// @param triggerMode The trigger mode
    /// @return canExecute True if order can be executed now
    function canExecuteOrder(address vault, address owner, TriggerMode triggerMode)
        external
        view
        returns (bool canExecute)
    {
        AppStorage storage s = LibAppStorage.appStorage();

        if (!s.orderExists[vault][owner][triggerMode]) {
            return false;
        }

        bytes32 key = LibAppStorage.orderKey(vault, owner, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

        if (order.status != OrderStatus.ACTIVE) {
            return false;
        }

        if (order.validUntil != 0 && block.timestamp > order.validUntil) {
            return false;
        }

        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(order.pool).slot0();

        if (triggerMode == TriggerMode.LOWER) {
            canExecute = currentTick <= order.triggerTick;
        } else {
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

    /// @notice Get the MidcurveSwapRouter address
    /// @return The MidcurveSwapRouter address
    function swapRouter() external view returns (address) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.swapRouter;
    }

    /// @notice Get the maximum fee in basis points
    /// @return The max fee bps (e.g., 100 = 1%)
    function maxFeeBps() external view returns (uint16) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.maxFeeBps;
    }
}
