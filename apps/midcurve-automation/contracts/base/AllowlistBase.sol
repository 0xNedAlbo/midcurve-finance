// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IAllowlist.sol";

/// @title AllowlistBase
/// @notice Base contract for allowlist-gated share transfers
/// @dev Provides state variables, management functions, and internal check function for allowlist logic
abstract contract AllowlistBase is IAllowlist {
    // ============ State ============

    bool internal _allowlistEnabled;
    mapping(address => bool) internal _allowlist;

    // ============ View Functions ============

    function allowlistEnabled() public view virtual override returns (bool) {
        return _allowlistEnabled;
    }

    function allowlist(address account) public view virtual override returns (bool) {
        return _allowlist[account];
    }

    // ============ Management Functions ============

    /// @inheritdoc IAllowlist
    function setAllowlistEnabled(bool enabled) external virtual override {
        _checkAllowlistAccess();
        _allowlistEnabled = enabled;
        emit AllowlistEnabledChanged(enabled);
    }

    /// @inheritdoc IAllowlist
    function addToAllowlist(address[] calldata accounts) external virtual override {
        _checkAllowlistAccess();
        for (uint256 i = 0; i < accounts.length; i++) {
            _allowlist[accounts[i]] = true;
            emit AddedToAllowlist(accounts[i]);
        }
    }

    /// @inheritdoc IAllowlist
    function removeFromAllowlist(address[] calldata accounts) external virtual override {
        _checkAllowlistAccess();
        for (uint256 i = 0; i < accounts.length; i++) {
            _allowlist[accounts[i]] = false;
            emit RemovedFromAllowlist(accounts[i]);
        }
    }

    // ============ Internal ============

    /// @notice Hook for access control - override to add restrictions
    /// @dev Called before any allowlist modification. Override to add onlyManager or similar checks.
    function _checkAllowlistAccess() internal view virtual;

    /// @notice Check if account is allowlisted (reverts if not)
    /// @param account Address to check
    function _requireAllowlisted(address account) internal view {
        if (_allowlistEnabled && !_allowlist[account]) {
            revert NotAllowlisted(account);
        }
    }
}
