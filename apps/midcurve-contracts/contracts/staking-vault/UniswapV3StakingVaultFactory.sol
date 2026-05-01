// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {IStakingVault} from "./interfaces/IStakingVault.sol";

/// @title UniswapV3StakingVaultFactory
/// @notice Singleton factory that deploys EIP-1167 clones of UniswapV3StakingVault.
/// @dev `createVault()` deploys AND initializes the clone in the same call frame, which
///      defeats the standard EIP-1167 init front-run.
contract UniswapV3StakingVaultFactory {
    address public immutable implementation;
    address public immutable positionManager;

    event VaultCreated(address indexed owner, address indexed vault);

    error ZeroAddress();

    constructor(address implementation_, address positionManager_) {
        if (implementation_ == address(0)) revert ZeroAddress();
        if (positionManager_ == address(0)) revert ZeroAddress();
        implementation = implementation_;
        positionManager = positionManager_;
    }

    /// @notice Deploy a new vault clone bound to msg.sender and initialize it atomically.
    /// @return vault The deployed clone address.
    function createVault() external returns (address vault) {
        vault = Clones.clone(implementation);
        IStakingVault(vault).initialize(msg.sender);
        emit VaultCreated(msg.sender, vault);
    }
}
