// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IMultiTokenVault} from "./IMultiTokenVault.sol";

/// @title IMultiTokenVaultAllowlisted
/// @notice Extends {IMultiTokenVault} with an optional, admin-controlled allowlist
///         that restricts who may receive shares.
///
/// @dev Allowlist semantics:
///      - When enabled, only allowlisted addresses may receive shares via mint()
///        or ERC-20 transfer(). Existing holders retain the right to burn() and
///        collectYield() regardless of their allowlist status.
///      - When disabled (via disableAllowlist()), the vault is fully open and
///        any address may hold shares. Disabling is irreversible.
///      - The allowlist admin may add/remove members and transfer or renounce
///        the admin role. Setting admin to address(0) permanently locks the
///        current allowlist state (no further changes possible).
interface IMultiTokenVaultAllowlisted is IMultiTokenVault {

    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted when an address is added to the allowlist.
    event AllowlistMemberAdded(address indexed account);

    /// @notice Emitted when an address is removed from the allowlist.
    event AllowlistMemberRemoved(address indexed account);

    /// @notice Emitted when the allowlist is permanently disabled.
    event AllowlistDisabled();

    /// @notice Emitted when the allowlist admin role is transferred.
    /// @param prevAdmin The previous admin address.
    /// @param newAdmin  The new admin address. address(0) means permanently renounced.
    event AllowlistAdminTransferred(address indexed prevAdmin, address indexed newAdmin);

    // =========================================================================
    // Allowlist state
    // =========================================================================

    /// @notice Whether the allowlist is currently active.
    function allowlistEnabled() external view returns (bool);

    /// @notice The current allowlist admin.
    function allowlistAdmin() external view returns (address);

    /// @notice Returns true if the account may receive shares.
    function isAllowlisted(address account) external view returns (bool);

    // =========================================================================
    // Allowlist management
    // =========================================================================

    /// @notice Add an address to the allowlist.
    function addToAllowlist(address account) external;

    /// @notice Remove an address from the allowlist.
    function removeFromAllowlist(address account) external;

    /// @notice Permanently disable the allowlist, making the vault fully open.
    function disableAllowlist() external;

    /// @notice Transfer the allowlist admin role to a new address.
    function transferAllowlistAdmin(address newAdmin) external;
}
