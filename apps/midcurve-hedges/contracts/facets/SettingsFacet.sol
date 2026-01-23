// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, Modifiers} from "../storage/AppStorage.sol";
import {LibVault} from "../libraries/LibVault.sol";

/// @title SettingsFacet
/// @notice Handles vault configuration and allowlist management
/// @dev Manager-only functions for configuring triggers, slippage, pause, and allowlist
contract SettingsFacet is Modifiers {
    // ============ Events ============

    event TriggerPriceUpperChanged(uint160 oldPrice, uint160 newPrice);
    event TriggerPriceLowerChanged(uint160 oldPrice, uint160 newPrice);
    event PausedChanged(bool paused);
    event ExitPositionSlippageChanged(uint256 oldSlippageBps, uint256 newSlippageBps);
    event EnterPositionSlippageChanged(uint256 oldSlippageBps, uint256 newSlippageBps);
    event DepositSlippageChanged(address indexed shareholder, uint256 oldSlippageBps, uint256 newSlippageBps);
    event WithdrawSlippageChanged(address indexed shareholder, uint256 oldSlippageBps, uint256 newSlippageBps);
    event AllowlistEnabledChanged(bool enabled);
    event AddedToAllowlist(address indexed account);
    event RemovedFromAllowlist(address indexed account);

    // ============ Trigger Price Management ============

    /// @notice Set the upper trigger price
    /// @param price The new upper trigger price (sqrtPriceX96 format)
    function setTriggerPriceUpper(uint160 price) external onlyManager {
        AppStorage storage s = LibAppStorage.appStorage();
        uint160 oldPrice = s.triggerPriceUpper;
        s.triggerPriceUpper = price;
        emit TriggerPriceUpperChanged(oldPrice, price);
    }

    /// @notice Set the lower trigger price
    /// @param price The new lower trigger price (sqrtPriceX96 format)
    function setTriggerPriceLower(uint160 price) external onlyManager {
        AppStorage storage s = LibAppStorage.appStorage();
        uint160 oldPrice = s.triggerPriceLower;
        s.triggerPriceLower = price;
        emit TriggerPriceLowerChanged(oldPrice, price);
    }

    // ============ Pause Management ============

    /// @notice Set the vault pause state
    /// @param _paused True to pause, false to unpause
    function setPaused(bool _paused) external onlyManager {
        AppStorage storage s = LibAppStorage.appStorage();
        s.paused = _paused;
        emit PausedChanged(_paused);
    }

    // ============ Slippage Management (Manager) ============

    /// @notice Set the slippage tolerance for exiting positions
    /// @param slippageBps Slippage in basis points (100 = 1%, max 1000 = 10%)
    function setExitPositionSlippageBps(uint256 slippageBps) external onlyManager {
        require(slippageBps <= 1000, "Slippage too high");
        AppStorage storage s = LibAppStorage.appStorage();
        uint256 oldSlippageBps = s.exitPositionSlippageBps;
        s.exitPositionSlippageBps = slippageBps;
        emit ExitPositionSlippageChanged(oldSlippageBps, slippageBps);
    }

    /// @notice Set the slippage tolerance for entering positions
    /// @param slippageBps Slippage in basis points (100 = 1%, max 1000 = 10%)
    function setEnterPositionSlippageBps(uint256 slippageBps) external onlyManager {
        require(slippageBps <= 1000, "Slippage too high");
        AppStorage storage s = LibAppStorage.appStorage();
        uint256 oldSlippageBps = s.enterPositionSlippageBps;
        s.enterPositionSlippageBps = slippageBps;
        emit EnterPositionSlippageChanged(oldSlippageBps, slippageBps);
    }

    // ============ Slippage Management (Shareholder) ============

    /// @notice Set your deposit slippage tolerance
    /// @param slippageBps Slippage in basis points (1-10000), or 0 to use default
    function setDepositSlippage(uint256 slippageBps) external {
        require(slippageBps <= LibVault.BPS_DENOMINATOR, "Invalid slippage");
        AppStorage storage s = LibAppStorage.appStorage();
        uint256 oldSlippageBps = s.shareholderDepositSlippageBps[msg.sender];
        s.shareholderDepositSlippageBps[msg.sender] = slippageBps;
        emit DepositSlippageChanged(msg.sender, oldSlippageBps, slippageBps);
    }

    /// @notice Set your withdrawal slippage tolerance
    /// @param slippageBps Slippage in basis points (1-10000), or 0 to use default
    function setWithdrawSlippage(uint256 slippageBps) external {
        require(slippageBps <= LibVault.BPS_DENOMINATOR, "Invalid slippage");
        AppStorage storage s = LibAppStorage.appStorage();
        uint256 oldSlippageBps = s.shareholderWithdrawSlippageBps[msg.sender];
        s.shareholderWithdrawSlippageBps[msg.sender] = slippageBps;
        emit WithdrawSlippageChanged(msg.sender, oldSlippageBps, slippageBps);
    }

    // ============ Allowlist Management ============

    /// @notice Enable or disable the allowlist
    /// @param enabled True to enable, false to disable
    function setAllowlistEnabled(bool enabled) external onlyManager {
        AppStorage storage s = LibAppStorage.appStorage();
        s.allowlistEnabled = enabled;
        emit AllowlistEnabledChanged(enabled);
    }

    /// @notice Add addresses to the allowlist
    /// @param accounts Addresses to add
    function addToAllowlist(address[] calldata accounts) external onlyManager {
        AppStorage storage s = LibAppStorage.appStorage();
        for (uint256 i = 0; i < accounts.length; i++) {
            if (!s.allowlist[accounts[i]]) {
                s.allowlist[accounts[i]] = true;
                emit AddedToAllowlist(accounts[i]);
            }
        }
    }

    /// @notice Remove addresses from the allowlist
    /// @param accounts Addresses to remove
    function removeFromAllowlist(address[] calldata accounts) external onlyManager {
        AppStorage storage s = LibAppStorage.appStorage();
        for (uint256 i = 0; i < accounts.length; i++) {
            if (s.allowlist[accounts[i]]) {
                s.allowlist[accounts[i]] = false;
                emit RemovedFromAllowlist(accounts[i]);
            }
        }
    }
}
