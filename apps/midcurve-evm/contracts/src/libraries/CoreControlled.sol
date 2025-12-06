// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CoreControlled
 * @notice Base contract providing access control for Core orchestrator
 * @dev The Core address is a well-known address used by the SEMSEE orchestrator
 *      to write data to stores. Only the Core can modify store state.
 *
 *      Using Foundry's default account (private key 0xac097...ff80) for development.
 *      This allows the TypeScript orchestrator to sign transactions with a known key.
 */
abstract contract CoreControlled {
    /// @notice The well-known address of the Core orchestrator
    /// @dev Foundry default account: private key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
    address public constant CORE = address(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266);

    /// @notice Error thrown when a non-Core address attempts a Core-only operation
    error OnlyCoreAllowed();

    /// @notice Restricts function access to the Core orchestrator only
    modifier onlyCore() {
        if (msg.sender != CORE) revert OnlyCoreAllowed();
        _;
    }
}
