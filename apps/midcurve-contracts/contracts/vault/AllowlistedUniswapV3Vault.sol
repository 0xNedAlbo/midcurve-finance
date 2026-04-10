// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UniswapV3Vault} from "./UniswapV3Vault.sol";
import {IMultiTokenVaultAllowlisted} from "./interfaces/IMultiTokenVaultAllowlisted.sol";

/// @title AllowlistedUniswapV3Vault
/// @notice Extends UniswapV3Vault with an admin-controlled allowlist restricting who may receive shares.
/// @dev Implements {IMultiTokenVaultAllowlisted}. Burns are always permitted.
///      Mints and transfers require the recipient to be on the allowlist (when enabled).
///      The allowlist can be permanently disabled via disableAllowlist().
contract AllowlistedUniswapV3Vault is UniswapV3Vault, IMultiTokenVaultAllowlisted {
    // ============ Storage ============

    bool private _allowlistEnabled;
    address private _allowlistAdmin;
    mapping(address => bool) private _allowlisted;

    // ============ Errors ============

    error OnlyAllowlistAdmin();
    error AllowlistAlreadyDisabled();
    error RecipientNotAllowlisted();

    // ============ Modifiers ============

    modifier onlyAllowlistAdmin() {
        if (msg.sender != _allowlistAdmin) revert OnlyAllowlistAdmin();
        _;
    }

    // ============ Initialization ============

    /// @notice Initialize the allowlisted vault clone
    /// @param positionManager_ Uniswap V3 NonfungiblePositionManager
    /// @param tokenId_ NFT token ID (must be owned by this contract)
    /// @param name_ ERC-20 token name
    /// @param symbol_ ERC-20 token symbol
    /// @param decimals_ ERC-20 decimals
    /// @param initialShareRecipient_ Receives initial shares equal to current liquidity
    /// @param operator_ Address authorized to call tend() and setOperator()
    /// @param allowlistAdmin_ Address that manages the allowlist
    function initialize(
        address positionManager_,
        uint256 tokenId_,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address initialShareRecipient_,
        address operator_,
        address allowlistAdmin_
    ) external initializer {
        // Set allowlist BEFORE _initializeVault, because _mint() triggers
        // _checkTransferAllowed via _beforeTokenTransfer
        _allowlistEnabled = true;
        _allowlistAdmin = allowlistAdmin_;
        _allowlisted[allowlistAdmin_] = true;
        emit AllowlistMemberAdded(allowlistAdmin_);

        if (initialShareRecipient_ != allowlistAdmin_) {
            _allowlisted[initialShareRecipient_] = true;
            emit AllowlistMemberAdded(initialShareRecipient_);
        }

        // Initialize the base vault (calls _mint which needs allowlist to be set)
        _initializeVault(positionManager_, tokenId_, name_, symbol_, decimals_, initialShareRecipient_, operator_);
    }

    /// @dev Disable the base initialize to force using the allowlisted version
    function initialize(
        address,
        uint256,
        string calldata,
        string calldata,
        uint8,
        address,
        address
    ) external pure override {
        revert("Use allowlisted initialize");
    }

    // ============ IMultiTokenVaultAllowlisted — Views ============

    /// @inheritdoc IMultiTokenVaultAllowlisted
    function allowlistEnabled() external view returns (bool) {
        return _allowlistEnabled;
    }

    /// @inheritdoc IMultiTokenVaultAllowlisted
    function allowlistAdmin() external view returns (address) {
        return _allowlistAdmin;
    }

    /// @inheritdoc IMultiTokenVaultAllowlisted
    function isAllowlisted(address account) external view returns (bool) {
        if (!_allowlistEnabled) return true;
        if (account == address(0)) return true;
        return _allowlisted[account];
    }

    // ============ IMultiTokenVaultAllowlisted — Management ============

    /// @inheritdoc IMultiTokenVaultAllowlisted
    function addToAllowlist(address account) external onlyAllowlistAdmin {
        if (!_allowlistEnabled) revert AllowlistAlreadyDisabled();
        if (!_allowlisted[account]) {
            _allowlisted[account] = true;
            emit AllowlistMemberAdded(account);
        }
    }

    /// @inheritdoc IMultiTokenVaultAllowlisted
    function removeFromAllowlist(address account) external onlyAllowlistAdmin {
        if (!_allowlistEnabled) revert AllowlistAlreadyDisabled();
        if (_allowlisted[account]) {
            _allowlisted[account] = false;
            emit AllowlistMemberRemoved(account);
        }
    }

    /// @inheritdoc IMultiTokenVaultAllowlisted
    function disableAllowlist() external onlyAllowlistAdmin {
        if (!_allowlistEnabled) revert AllowlistAlreadyDisabled();
        _allowlistEnabled = false;
        emit AllowlistDisabled();
    }

    /// @inheritdoc IMultiTokenVaultAllowlisted
    function transferAllowlistAdmin(address newAdmin) external onlyAllowlistAdmin {
        address prev = _allowlistAdmin;
        _allowlistAdmin = newAdmin;
        emit AllowlistAdminTransferred(prev, newAdmin);
    }

    // ============ Transfer restriction ============

    /// @dev Burns (to == address(0)) are always permitted.
    ///      When allowlist is disabled, all transfers are permitted.
    ///      When enabled, mints and transfers require the recipient to be allowlisted.
    function _checkTransferAllowed(address, /* from */ address to) internal view override {
        if (!_allowlistEnabled) return;
        if (to == address(0)) return;
        if (!_allowlisted[to]) revert RecipientNotAllowlisted();
    }
}
