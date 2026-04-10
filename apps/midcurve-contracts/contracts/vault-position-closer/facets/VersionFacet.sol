// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, Modifiers} from "../storage/AppStorage.sol";

/// @title VersionFacet
/// @notice Facet for querying the vault position closer version
contract VersionFacet is Modifiers {
    /// @notice Returns the interface version from storage
    /// @return The interface version (e.g., 100 = v1.0)
    function interfaceVersion() external view returns (uint32) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.interfaceVersion;
    }

    /// @notice Returns the implementation version string
    /// @return Human-readable version string
    function version() external pure returns (string memory) {
        return "UniswapV3VaultPositionCloser v1.0.0";
    }
}
