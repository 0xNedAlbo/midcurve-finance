// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStrategy
 * @notice Base interface for all SEMSEE strategies
 * @dev All strategies must implement this interface to be deployable in SEMSEE
 */
interface IStrategy {
    /// @notice Returns the owner address of the strategy
    /// @return The address that owns this strategy (can call onlyOwner functions)
    function owner() external view returns (address);
}
