// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AllowlistBase
/// @notice Internal helper for allowlist-gated functionality
/// @dev All methods are internal - implementer creates public wrappers with appropriate access control
abstract contract AllowlistBase {
    // ============ Events ============

    event AddedToAllowlist(address indexed account);
    event RemovedFromAllowlist(address indexed account);
    event AllowlistEnabledChanged(bool enabled);

    // ============ Errors ============

    error NotAllowlisted(address account);

    // ============ State ============

    bool internal _allowlistEnabled;
    mapping(address => bool) internal _allowlist;

    // ============ Internal View Functions ============

    /// @notice Check if allowlist is enabled
    /// @return True if allowlist is enabled
    function _isAllowlistEnabled() internal view virtual returns (bool) {
        return _allowlistEnabled;
    }

    /// @notice Check if an address is on the allowlist
    /// @param account Address to check
    /// @return True if address is allowlisted
    function _isAllowlisted(address account) internal view virtual returns (bool) {
        return _allowlist[account];
    }

    // ============ Internal Management Functions ============

    /// @notice Enable or disable the allowlist
    /// @param enabled True to enable, false to disable
    function _setAllowlistEnabled(bool enabled) internal virtual {
        _allowlistEnabled = enabled;
        emit AllowlistEnabledChanged(enabled);
    }

    /// @notice Add addresses to the allowlist
    /// @param accounts Addresses to add
    function _addToAllowlist(address[] calldata accounts) internal virtual {
        for (uint256 i = 0; i < accounts.length; i++) {
            _allowlist[accounts[i]] = true;
            emit AddedToAllowlist(accounts[i]);
        }
    }

    /// @notice Remove addresses from the allowlist
    /// @param accounts Addresses to remove
    function _removeFromAllowlist(address[] calldata accounts) internal virtual {
        for (uint256 i = 0; i < accounts.length; i++) {
            _allowlist[accounts[i]] = false;
            emit RemovedFromAllowlist(accounts[i]);
        }
    }

    // ============ Internal Checks ============

    /// @notice Revert if account is not allowlisted (when allowlist is enabled)
    /// @param account Address to check
    function _requireAllowlisted(address account) internal view {
        if (_allowlistEnabled && !_allowlist[account]) {
            revert NotAllowlisted(account);
        }
    }
}
