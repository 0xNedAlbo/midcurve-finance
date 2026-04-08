// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {INonfungiblePositionManagerMinimal} from "../position-closer/interfaces/INonfungiblePositionManagerMinimal.sol";
import {UniswapV3Vault} from "./UniswapV3Vault.sol";
import {AllowlistedUniswapV3Vault} from "./AllowlistedUniswapV3Vault.sol";

/// @title UniswapV3VaultFactory
/// @notice Deploys EIP-1167 clones of UniswapV3Vault and AllowlistedUniswapV3Vault.
/// @dev One factory per chain, registered as a SharedContract in the Midcurve DB.
///      The user approves this factory for their NFT, then calls createVault or
///      createAllowlistedVault in a single transaction.
contract UniswapV3VaultFactory {
    // ============ Immutables ============

    address public immutable baseVaultImplementation;
    address public immutable allowlistedVaultImplementation;
    address public immutable positionManager;

    // ============ Events ============

    event VaultCreated(
        address indexed vault,
        address indexed creator,
        uint256 indexed tokenId,
        bool allowlisted
    );

    // ============ Errors ============

    error ZeroAddress();

    // ============ Constructor ============

    constructor(address baseVaultImpl_, address allowlistedVaultImpl_, address positionManager_) {
        if (baseVaultImpl_ == address(0)) revert ZeroAddress();
        if (allowlistedVaultImpl_ == address(0)) revert ZeroAddress();
        if (positionManager_ == address(0)) revert ZeroAddress();

        baseVaultImplementation = baseVaultImpl_;
        allowlistedVaultImplementation = allowlistedVaultImpl_;
        positionManager = positionManager_;
    }

    // ============ Factory functions ============

    /// @notice Deploy a new UniswapV3Vault clone wrapping an NFT position.
    /// @dev Caller must have approved this factory for the NFT beforehand.
    /// @param tokenId_ The Uniswap V3 NFT to wrap
    /// @param name_ ERC-20 token name
    /// @param symbol_ ERC-20 token symbol
    /// @param decimals_ ERC-20 decimals (suggested by UI based on liquidity)
    /// @return vault The deployed vault clone address
    function createVault(
        uint256 tokenId_,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_
    ) external returns (address vault) {
        vault = Clones.clone(baseVaultImplementation);

        // Transfer NFT from caller to the new clone (factory has approval)
        INonfungiblePositionManagerMinimal(positionManager).transferFrom(msg.sender, vault, tokenId_);

        // Initialize the clone
        UniswapV3Vault(vault).initialize(positionManager, tokenId_, name_, symbol_, decimals_, msg.sender);

        emit VaultCreated(vault, msg.sender, tokenId_, false);
    }

    /// @notice Deploy a new AllowlistedUniswapV3Vault clone wrapping an NFT position.
    /// @dev Caller must have approved this factory for the NFT beforehand.
    /// @param tokenId_ The Uniswap V3 NFT to wrap
    /// @param name_ ERC-20 token name
    /// @param symbol_ ERC-20 token symbol
    /// @param decimals_ ERC-20 decimals
    /// @param allowlistAdmin_ Address that manages the shareholder allowlist
    /// @return vault The deployed vault clone address
    function createAllowlistedVault(
        uint256 tokenId_,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address allowlistAdmin_
    ) external returns (address vault) {
        vault = Clones.clone(allowlistedVaultImplementation);

        // Transfer NFT from caller to the new clone
        INonfungiblePositionManagerMinimal(positionManager).transferFrom(msg.sender, vault, tokenId_);

        // Initialize the allowlisted clone
        AllowlistedUniswapV3Vault(vault).initialize(
            positionManager, tokenId_, name_, symbol_, decimals_, msg.sender, allowlistAdmin_
        );

        emit VaultCreated(vault, msg.sender, tokenId_, true);
    }
}
