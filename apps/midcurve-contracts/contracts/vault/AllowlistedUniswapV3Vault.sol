// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UniswapV3Vault} from "./UniswapV3Vault.sol";

/// @title AllowlistedUniswapV3Vault
/// @notice Extends UniswapV3Vault with a shareholder allowlist restricting who may receive shares.
/// @dev Burns are always permitted. Mints and transfers require the recipient to be on the allowlist.
///      The allowlistAdmin role uses a two-step commit/accept transfer pattern.
contract AllowlistedUniswapV3Vault is UniswapV3Vault {
    // ============ Storage ============

    address public allowlistAdmin;
    address public pendingAllowlistAdmin;
    mapping(address => bool) public allowlisted;

    // ============ Events ============

    event AllowlistUpdated(address indexed account, bool allowed);
    event AllowlistAdminTransferInitiated(address indexed currentAdmin, address indexed pendingAdmin);
    event AllowlistAdminTransferCancelled(address indexed currentAdmin);
    event AllowlistAdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    // ============ Errors ============

    error OnlyAllowlistAdmin();
    error OnlyPendingAdmin();
    error RecipientNotAllowlisted();

    // ============ Modifiers ============

    modifier onlyAllowlistAdmin() {
        if (msg.sender != allowlistAdmin) revert OnlyAllowlistAdmin();
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
    /// @param allowlistAdmin_ Address that manages the allowlist
    function initialize(
        address positionManager_,
        uint256 tokenId_,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address initialShareRecipient_,
        address allowlistAdmin_
    ) external initializer {
        // Set allowlist BEFORE _initializeVault, because _mint() triggers
        // _checkTransferAllowed via _beforeTokenTransfer
        allowlistAdmin = allowlistAdmin_;
        allowlisted[allowlistAdmin_] = true;
        emit AllowlistUpdated(allowlistAdmin_, true);

        if (initialShareRecipient_ != allowlistAdmin_) {
            allowlisted[initialShareRecipient_] = true;
            emit AllowlistUpdated(initialShareRecipient_, true);
        }

        // Initialize the base vault (calls _mint which needs allowlist to be set)
        _initializeVault(positionManager_, tokenId_, name_, symbol_, decimals_, initialShareRecipient_);
    }

    /// @dev Disable the base initialize to force using the allowlisted version
    function initialize(
        address,
        uint256,
        string calldata,
        string calldata,
        uint8,
        address
    ) external pure override {
        revert("Use allowlisted initialize");
    }

    // ============ Allowlist admin functions ============

    /// @notice Add or remove an address from the allowlist
    function setAllowlisted(address account, bool allowed) external onlyAllowlistAdmin {
        allowlisted[account] = allowed;
        emit AllowlistUpdated(account, allowed);
    }

    /// @notice Batch add or remove addresses from the allowlist
    function setAllowlistedBatch(address[] calldata accounts, bool allowed) external onlyAllowlistAdmin {
        for (uint256 i = 0; i < accounts.length; i++) {
            allowlisted[accounts[i]] = allowed;
            emit AllowlistUpdated(accounts[i], allowed);
        }
    }

    /// @notice Initiate admin role transfer (two-step pattern)
    /// @param newAdmin Address to transfer admin role to. Use address(0) to cancel.
    function transferAllowlistAdmin(address newAdmin) external onlyAllowlistAdmin {
        pendingAllowlistAdmin = newAdmin;
        if (newAdmin == address(0)) {
            emit AllowlistAdminTransferCancelled(msg.sender);
        } else {
            emit AllowlistAdminTransferInitiated(msg.sender, newAdmin);
        }
    }

    /// @notice Accept the admin role transfer
    function acceptAllowlistAdmin() external {
        if (msg.sender != pendingAllowlistAdmin) revert OnlyPendingAdmin();
        address previous = allowlistAdmin;
        allowlistAdmin = msg.sender;
        pendingAllowlistAdmin = address(0);
        emit AllowlistAdminTransferred(previous, msg.sender);
    }

    // ============ Transfer restriction ============

    /// @dev Burns (to == address(0)) are always permitted.
    ///      Mints and transfers require the recipient to be on the allowlist.
    function _checkTransferAllowed(address, /* from */ address to) internal view override {
        if (to == address(0)) return;
        if (!allowlisted[to]) revert RecipientNotAllowlisted();
    }
}
