// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./IERC20.sol";

/**
 * @title ITokenPairVault
 * @notice Interface for a dual-asset vault, similar to ERC4626 but with two assets
 * @dev Manages shares backed by a pair of tokens (asset0 and asset1)
 *      Shares are ERC20 compliant tokens.
 *
 * Key differences from ERC4626:
 * - Two assets instead of one (asset0, asset1)
 * - All asset-related functions use (amount0, amount1) tuples
 * - Deposit/withdraw operations require both token amounts
 */
interface ITokenPairVault is IERC20 {
    // ============ Events ============

    /**
     * @dev Emitted when tokens are deposited into the vault
     * @param sender The address that initiated the deposit
     * @param owner The address that received the shares
     * @param amount0 The amount of asset0 deposited
     * @param amount1 The amount of asset1 deposited
     * @param shares The amount of shares minted
     */
    event Deposit(
        address indexed sender,
        address indexed owner,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );

    /**
     * @dev Emitted when tokens are withdrawn from the vault
     * @param sender The address that initiated the withdrawal
     * @param receiver The address that received the tokens
     * @param owner The address that owned the shares
     * @param amount0 The amount of asset0 withdrawn
     * @param amount1 The amount of asset1 withdrawn
     * @param shares The amount of shares burned
     */
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );

    // ============ Asset Getters ============

    /**
     * @notice Returns the address of the first underlying token
     * @return The address of asset0
     */
    function asset0() external view returns (address);

    /**
     * @notice Returns the address of the second underlying token
     * @return The address of asset1
     */
    function asset1() external view returns (address);

    // ============ Accounting ============

    /**
     * @notice Returns the total amount of underlying assets held by the vault
     * @return amount0 Total amount of asset0
     * @return amount1 Total amount of asset1
     */
    function totalAssets() external view returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Converts token amounts to the equivalent amount of shares
     * @param amount0 The amount of asset0
     * @param amount1 The amount of asset1
     * @return shares The equivalent amount of shares
     */
    function convertToShares(
        uint256 amount0,
        uint256 amount1
    ) external view returns (uint256 shares);

    /**
     * @notice Converts shares to the equivalent amount of tokens
     * @param shares The amount of shares
     * @return amount0 The equivalent amount of asset0
     * @return amount1 The equivalent amount of asset1
     */
    function convertToAssets(
        uint256 shares
    ) external view returns (uint256 amount0, uint256 amount1);

    // ============ Limits ============

    /**
     * @notice Returns the maximum amounts that can be deposited for a receiver
     * @param receiver The address that would receive the shares
     * @return amount0 Maximum depositable amount of asset0
     * @return amount1 Maximum depositable amount of asset1
     */
    function maxDeposit(
        address receiver
    ) external view returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Returns the maximum shares that can be minted for a receiver
     * @param receiver The address that would receive the shares
     * @return shares Maximum mintable shares
     */
    function maxMint(address receiver) external view returns (uint256 shares);

    /**
     * @notice Returns the maximum amounts that can be withdrawn by an owner
     * @param owner The address that owns the shares
     * @return amount0 Maximum withdrawable amount of asset0
     * @return amount1 Maximum withdrawable amount of asset1
     */
    function maxWithdraw(
        address owner
    ) external view returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Returns the maximum shares that can be redeemed by an owner
     * @param owner The address that owns the shares
     * @return shares Maximum redeemable shares
     */
    function maxRedeem(address owner) external view returns (uint256 shares);

    // ============ Previews ============

    /**
     * @notice Simulates the shares that would be minted for a deposit
     * @param amount0 The amount of asset0 to deposit
     * @param amount1 The amount of asset1 to deposit
     * @return shares The amount of shares that would be minted
     */
    function previewDeposit(
        uint256 amount0,
        uint256 amount1
    ) external view returns (uint256 shares);

    /**
     * @notice Simulates the assets required to mint a specific amount of shares
     * @param shares The amount of shares to mint
     * @return amount0 The amount of asset0 required
     * @return amount1 The amount of asset1 required
     */
    function previewMint(
        uint256 shares
    ) external view returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Simulates the shares that would be burned for a withdrawal
     * @param amount0 The amount of asset0 to withdraw
     * @param amount1 The amount of asset1 to withdraw
     * @return shares The amount of shares that would be burned
     */
    function previewWithdraw(
        uint256 amount0,
        uint256 amount1
    ) external view returns (uint256 shares);

    /**
     * @notice Simulates the assets that would be returned for redeeming shares
     * @param shares The amount of shares to redeem
     * @return amount0 The amount of asset0 that would be returned
     * @return amount1 The amount of asset1 that would be returned
     */
    function previewRedeem(
        uint256 shares
    ) external view returns (uint256 amount0, uint256 amount1);

    // ============ Actions ============

    /**
     * @notice Deposits tokens into the vault and mints shares to the receiver
     * @param amount0 The amount of asset0 to deposit
     * @param amount1 The amount of asset1 to deposit
     * @param receiver The address that will receive the shares
     * @return shares The amount of shares minted
     */
    function deposit(
        uint256 amount0,
        uint256 amount1,
        address receiver
    ) external returns (uint256 shares);

    /**
     * @notice Mints exact shares by depositing the required tokens
     * @param shares The exact amount of shares to mint
     * @param receiver The address that will receive the shares
     * @return amount0 The amount of asset0 deposited
     * @return amount1 The amount of asset1 deposited
     */
    function mint(
        uint256 shares,
        address receiver
    ) external returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Withdraws tokens from the vault by burning shares
     * @param amount0 The amount of asset0 to withdraw
     * @param amount1 The amount of asset1 to withdraw
     * @param receiver The address that will receive the tokens
     * @param owner The address that owns the shares
     * @return shares The amount of shares burned
     */
    function withdraw(
        uint256 amount0,
        uint256 amount1,
        address receiver,
        address owner
    ) external returns (uint256 shares);

    /**
     * @notice Redeems shares for tokens
     * @param shares The amount of shares to redeem
     * @param receiver The address that will receive the tokens
     * @param owner The address that owns the shares
     * @return amount0 The amount of asset0 returned
     * @return amount1 The amount of asset1 returned
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256 amount0, uint256 amount1);
}
