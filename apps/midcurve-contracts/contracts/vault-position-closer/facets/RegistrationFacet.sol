// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, SwapDirection, VaultCloseOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3VaultPositionCloserV1} from "../interfaces/IUniswapV3VaultPositionCloserV1.sol";
import {IUniswapV3VaultMinimal} from "../interfaces/IUniswapV3VaultMinimal.sol";

/// @title RegistrationFacet
/// @notice Facet for registering and cancelling vault close orders
/// @dev Handles order creation and cancellation with ERC-20 ownership validation
contract RegistrationFacet is Modifiers {
    // ========================================
    // EVENTS
    // ========================================

    event OrderRegistered(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address pool,
        address operator,
        address payout,
        int24 triggerTick,
        uint256 shares,
        uint256 validUntil,
        uint16 slippageBps,
        SwapDirection swapDirection,
        uint16 swapSlippageBps
    );

    event OrderCancelled(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner
    );

    // ========================================
    // REGISTRATION
    // ========================================

    /// @notice Register a new vault close order
    /// @dev Caller must hold vault shares and have approved this contract.
    ///      Allows overwriting orders that are Cancelled or Executed (but not Active).
    /// @param params Registration parameters
    function registerOrder(IUniswapV3VaultPositionCloserV1.RegisterOrderParams calldata params)
        external
        whenInitialized
        nonReentrant
    {
        AppStorage storage s = LibAppStorage.appStorage();

        // Check if order already exists and is active - cannot overwrite active orders
        if (s.orderExists[params.vault][msg.sender][params.triggerMode]) {
            bytes32 existingKey = LibAppStorage.orderKey(params.vault, msg.sender, params.triggerMode);
            VaultCloseOrder storage existingOrder = s.orders[existingKey];
            if (existingOrder.status == OrderStatus.ACTIVE) {
                revert OrderAlreadyExists(params.vault, msg.sender, params.triggerMode);
            }
        }

        // Validate addresses
        if (params.vault == address(0)) revert ZeroAddress();
        if (params.payout == address(0)) revert ZeroAddress();
        if (params.operator == address(0)) revert ZeroAddress();

        // Validate slippage
        if (params.slippageBps > 10000) revert SlippageBpsOutOfRange(params.slippageBps);

        // Validate swap config if enabled
        if (params.swapDirection != SwapDirection.NONE) {
            if (params.swapSlippageBps > 10000) revert SwapSlippageBpsOutOfRange(params.swapSlippageBps);
        }

        // Read pool from vault
        IUniswapV3VaultMinimal vault = IUniswapV3VaultMinimal(params.vault);
        address pool = vault.pool();

        // Verify ownership: caller must hold shares
        uint256 balance = vault.balanceOf(msg.sender);
        if (balance == 0) revert InsufficientShares(msg.sender, 1, 0);
        if (params.shares > 0 && balance < params.shares) {
            revert InsufficientShares(msg.sender, params.shares, balance);
        }

        // Verify approval: caller must have approved this contract
        uint256 allowance = vault.allowance(msg.sender, address(this));
        if (allowance == 0) revert InsufficientAllowance(msg.sender, 1, 0);
        if (params.shares > 0 && allowance < params.shares) {
            revert InsufficientAllowance(msg.sender, params.shares, allowance);
        }

        // Generate order key and create order
        bytes32 key = LibAppStorage.orderKey(params.vault, msg.sender, params.triggerMode);

        s.orders[key] = VaultCloseOrder({
            status: OrderStatus.ACTIVE,
            vault: params.vault,
            owner: msg.sender,
            pool: pool,
            shares: params.shares,
            triggerTick: params.triggerTick,
            payout: params.payout,
            operator: params.operator,
            validUntil: params.validUntil,
            slippageBps: params.slippageBps,
            swapDirection: params.swapDirection,
            swapSlippageBps: params.swapSlippageBps
        });

        s.orderExists[params.vault][msg.sender][params.triggerMode] = true;

        emit OrderRegistered(
            params.vault,
            params.triggerMode,
            msg.sender,
            pool,
            params.operator,
            params.payout,
            params.triggerTick,
            params.shares,
            params.validUntil,
            params.slippageBps,
            params.swapDirection,
            params.swapSlippageBps
        );
    }

    /// @notice Cancel an existing vault close order
    /// @dev Only the order owner (msg.sender) can cancel
    /// @param vault The vault address
    /// @param triggerMode The trigger mode to cancel
    function cancelOrder(address vault, TriggerMode triggerMode)
        external
        whenInitialized
        nonReentrant
        orderMustExist(vault, msg.sender, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, msg.sender, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

        // Only owner can cancel
        if (msg.sender != order.owner) revert NotOwner();

        // Can only cancel ACTIVE orders
        if (order.status != OrderStatus.ACTIVE) {
            revert WrongOrderStatus(OrderStatus.ACTIVE, order.status);
        }

        emit OrderCancelled(vault, triggerMode, msg.sender);

        // Delete from storage (gas refund)
        delete s.orders[key];
        s.orderExists[vault][msg.sender][triggerMode] = false;
    }
}
