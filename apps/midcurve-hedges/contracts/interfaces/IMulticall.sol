// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMulticall
/// @notice Interface for executing multiple calls in a single transaction
interface IMulticall {
    /// @notice Execute multiple calls in a single transaction
    /// @dev Reverts if any call fails, bubbling up the revert reason
    /// @param data Array of encoded function calls
    /// @return results Array of return data from each call
    function multicall(bytes[] calldata data) external returns (bytes[] memory results);
}
