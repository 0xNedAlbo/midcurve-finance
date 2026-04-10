// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage} from "../storage/AppStorage.sol";

/// @title DiamondInit
/// @notice Initializer contract for UniswapV3VaultPositionCloser Diamond
/// @dev Called once during diamond deployment via delegatecall
contract DiamondInit {
    error ZeroAddress();
    error AlreadyInitialized();

    /// @notice Initialize the diamond with configuration
    /// @param swapRouter_ The MidcurveSwapRouter address for post-close token swaps
    /// @param interfaceVersion_ The interface version (e.g., 100 = v1.0)
    /// @param maxFeeBps_ Maximum operator fee in basis points (e.g., 100 = 1%)
    function init(
        address swapRouter_,
        uint32 interfaceVersion_,
        uint16 maxFeeBps_
    ) external {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.initialized) revert AlreadyInitialized();
        if (swapRouter_ == address(0)) revert ZeroAddress();

        s.swapRouter = swapRouter_;
        s.interfaceVersion = interfaceVersion_;
        s.maxFeeBps = maxFeeBps_;

        // Initialize reentrancy lock (1 = unlocked)
        s.reentrancyLock = 1;

        s.initialized = true;
    }
}
