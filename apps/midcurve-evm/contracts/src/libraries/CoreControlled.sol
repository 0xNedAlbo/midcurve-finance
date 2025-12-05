// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CoreControlled
 * @notice Base contract providing access control for Core orchestrator
 * @dev The Core address is a well-known address used by the SEMSEE orchestrator
 *      to write data to stores. Only the Core can modify store state.
 */
abstract contract CoreControlled {
    /// @notice The well-known address of the Core orchestrator
    address public constant CORE = address(0x0000000000000000000000000000000000000001);

    /// @notice Error thrown when a non-Core address attempts a Core-only operation
    error OnlyCoreAllowed();

    /// @notice Restricts function access to the Core orchestrator only
    modifier onlyCore() {
        if (msg.sender != CORE) revert OnlyCoreAllowed();
        _;
    }
}
