// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IAllowlist
/// @notice Interface for allowlist functionality
interface IAllowlist {
    // ============ Events ============

    event AddedToAllowlist(address indexed account);
    event RemovedFromAllowlist(address indexed account);
    event AllowlistEnabledChanged(bool enabled);

    // ============ Errors ============

    error NotAllowlisted(address account);

    // ============ View Functions ============

    /// @notice Whether the allowlist is enabled
    function allowlistEnabled() external view returns (bool);

    /// @notice Check if an address is allowlisted
    /// @param account Address to check
    /// @return True if address is on allowlist
    function allowlist(address account) external view returns (bool);

    // ============ Management Functions ============

    /// @notice Enable or disable the allowlist
    /// @param enabled True to enable allowlist, false to disable
    function setAllowlistEnabled(bool enabled) external;

    /// @notice Add addresses to the allowlist
    /// @param accounts Addresses to add to allowlist
    function addToAllowlist(address[] calldata accounts) external;

    /// @notice Remove addresses from the allowlist
    /// @param accounts Addresses to remove from allowlist
    function removeFromAllowlist(address[] calldata accounts) external;
}
