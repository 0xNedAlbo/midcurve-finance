// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IERC173
/// @notice Interface for ERC-173 contract ownership
interface IERC173 {
    /// @notice Emitted when ownership of a contract changes
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Get the address of the owner
    /// @return owner_ The address of the owner
    function owner() external view returns (address owner_);

    /// @notice Set the address of the new owner of the contract
    /// @dev Set _newOwner to address(0) to renounce any ownership
    /// @param _newOwner The address of the new owner of the contract
    function transferOwnership(address _newOwner) external;
}
