// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage} from "../storage/AppStorage.sol";

/// @title DiamondInit
/// @notice Initializer contract for UniswapV3PositionCloser Diamond
/// @dev Called once during diamond deployment via delegatecall
///
/// This contract is deployed separately and then called via delegatecall
/// from the Diamond constructor. It initializes the AppStorage struct
/// with chain constants and protocol configuration.
contract DiamondInit {
    /// @notice Error when initialization parameters are invalid
    error ZeroAddress();

    /// @notice Error when trying to initialize an already initialized diamond
    error AlreadyInitialized();

    /// @notice Initialize the diamond with chain constants and configuration
    /// @param positionManager_ The Uniswap V3 NonfungiblePositionManager address
    /// @param augustusRegistry_ The Paraswap AugustusRegistry address for swap validation
    /// @param interfaceVersion_ The interface version (e.g., 100 = v1.0, 101 = v1.1)
    /// @param maxFeeBps_ Maximum operator fee in basis points (e.g., 100 = 1%)
    function init(
        address positionManager_,
        address augustusRegistry_,
        uint32 interfaceVersion_,
        uint16 maxFeeBps_
    ) external {
        AppStorage storage s = LibAppStorage.appStorage();

        // Prevent re-initialization
        if (s.initialized) revert AlreadyInitialized();

        // Validate addresses
        if (positionManager_ == address(0)) revert ZeroAddress();
        if (augustusRegistry_ == address(0)) revert ZeroAddress();

        // Set chain constants
        s.positionManager = positionManager_;
        s.augustusRegistry = augustusRegistry_;

        // Set protocol configuration
        s.interfaceVersion = interfaceVersion_;
        s.maxFeeBps = maxFeeBps_;

        // Initialize reentrancy lock (1 = unlocked)
        s.reentrancyLock = 1;

        // Mark as initialized
        s.initialized = true;
    }
}
