// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, CollectOrder, Modifiers} from "../storage/AppStorage.sol";

/// @title CollectViewFacet
/// @notice Facet for reading collect order state and configuration
/// @dev All functions are view-only
contract CollectViewFacet is Modifiers {
    // ========================================
    // ORDER VIEWS
    // ========================================

    /// @notice Get the full collect order details
    function getCollectOrder(uint256 nftId)
        external
        view
        returns (CollectOrder memory order)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        order = s.orders[nftId];
    }

    /// @notice Check if a collect order exists
    function hasCollectOrder(uint256 nftId)
        external
        view
        returns (bool exists)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        exists = s.orderExists[nftId];
    }

    // ========================================
    // CONFIGURATION VIEWS
    // ========================================

    /// @notice Get the position manager address
    function positionManager() external view returns (address) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.positionManager;
    }

    /// @notice Get the MidcurveSwapRouter address
    function swapRouter() external view returns (address) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.swapRouter;
    }

    /// @notice Get the maximum fee in basis points
    function maxFeeBps() external view returns (uint16) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.maxFeeBps;
    }
}
