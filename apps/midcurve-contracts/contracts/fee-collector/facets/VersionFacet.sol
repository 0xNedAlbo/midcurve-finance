// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage} from "../storage/AppStorage.sol";

/// @title VersionFacet
/// @notice Facet for querying contract version information
contract VersionFacet {
    function interfaceVersion() external view returns (uint32) {
        AppStorage storage s = LibAppStorage.appStorage();
        return s.interfaceVersion;
    }

    function version() external pure returns (string memory) {
        return "UniswapV3FeeCollector v1.0.0";
    }
}
