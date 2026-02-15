// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage} from "../storage/AppStorage.sol";

/// @title VersionFacet
/// @notice Facet for querying contract version information
/// @dev Provides on-chain version querying for interface compatibility checks
contract VersionFacet {
    /// @notice Returns the interface version
    /// @return Version number (e.g., 1_00 = v1.0)
    function interfaceVersion() external view returns (uint32) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.interfaceVersion;
    }

    /// @notice Returns the implementation version string
    /// @return Human-readable version string
    function version() external pure returns (string memory) {
        return "UniswapV3PositionCloser v1.0.0";
    }
}
