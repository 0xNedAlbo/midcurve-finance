// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, SwapDirection, CloseOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3PositionCloserV1} from "../interfaces/IUniswapV3PositionCloserV1.sol";
import {INonfungiblePositionManagerMinimal} from "../interfaces/INonfungiblePositionManagerMinimal.sol";

/// @title RegistrationFacet
/// @notice Facet for registering and cancelling close orders
/// @dev Handles order creation and cancellation with ownership validation
contract RegistrationFacet is Modifiers {
    // ========================================
    // EVENTS (from interface)
    // ========================================

    event OrderRegistered(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address pool,
        address operator,
        address payout,
        int24 triggerTick,
        uint256 validUntil,
        uint16 slippageBps,
        SwapDirection swapDirection,
        uint16 swapSlippageBps
    );

    event OrderCancelled(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address indexed owner
    );

    // ========================================
    // REGISTRATION
    // ========================================

    /// @notice Register a new close order
    /// @dev Caller must be the NFT owner and must have approved this contract.
    ///      Allows overwriting orders that are Cancelled or Executed (but not Active).
    /// @param params Registration parameters
    function registerOrder(IUniswapV3PositionCloserV1.RegisterOrderParams calldata params)
        external
        whenInitialized
        nonReentrant
    {
        AppStorage storage s = LibAppStorage.appStorage();

        // Check if order already exists and is active - cannot overwrite active orders
        if (s.orderExists[params.nftId][params.triggerMode]) {
            bytes32 existingKey = LibAppStorage.orderKey(params.nftId, params.triggerMode);
            CloseOrder storage existingOrder = s.orders[existingKey];
            if (existingOrder.status == OrderStatus.ACTIVE) {
                revert OrderAlreadyExists(params.nftId, params.triggerMode);
            }
            // Order exists but is Cancelled or Executed - allow overwriting
        }

        // Validate addresses
        if (params.payout == address(0)) revert ZeroAddress();
        if (params.operator == address(0)) revert ZeroAddress();
        if (params.pool == address(0)) revert ZeroAddress();

        // Validate slippage
        if (params.slippageBps > 10000) revert SlippageBpsOutOfRange(params.slippageBps);

        // Validate swap config if enabled
        if (params.swapDirection != SwapDirection.NONE) {
            if (params.swapSlippageBps > 10000) revert SwapSlippageBpsOutOfRange(params.swapSlippageBps);
        }

        // Verify ownership and approval
        INonfungiblePositionManagerMinimal nftManager = INonfungiblePositionManagerMinimal(s.positionManager);
        address nftOwner = nftManager.ownerOf(params.nftId);

        if (msg.sender != nftOwner) revert NotOwner();

        // Check NFT is approved for this contract
        address approved = nftManager.getApproved(params.nftId);
        bool isApprovedForAll = nftManager.isApprovedForAll(nftOwner, address(this));
        if (approved != address(this) && !isApprovedForAll) {
            revert NftNotApproved(nftOwner, params.nftId);
        }

        // Generate order key and create order
        bytes32 key = LibAppStorage.orderKey(params.nftId, params.triggerMode);

        s.orders[key] = CloseOrder({
            status: OrderStatus.ACTIVE,
            nftId: params.nftId,
            owner: nftOwner,
            pool: params.pool,
            triggerTick: params.triggerTick,
            payout: params.payout,
            operator: params.operator,
            validUntil: params.validUntil,
            slippageBps: params.slippageBps,
            swapDirection: params.swapDirection,
            swapSlippageBps: params.swapSlippageBps
        });

        s.orderExists[params.nftId][params.triggerMode] = true;

        emit OrderRegistered(
            params.nftId,
            params.triggerMode,
            nftOwner,
            params.pool,
            params.operator,
            params.payout,
            params.triggerTick,
            params.validUntil,
            params.slippageBps,
            params.swapDirection,
            params.swapSlippageBps
        );
    }

    /// @notice Cancel an existing close order
    /// @dev Only the NFT owner can cancel
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode to cancel
    function cancelOrder(uint256 nftId, TriggerMode triggerMode)
        external
        whenInitialized
        nonReentrant
        orderMustExist(nftId, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        CloseOrder storage order = s.orders[key];

        // Only owner can cancel
        if (msg.sender != order.owner) revert NotOwner();

        // Can only cancel ACTIVE orders
        if (order.status != OrderStatus.ACTIVE) {
            revert WrongOrderStatus(OrderStatus.ACTIVE, order.status);
        }

        // Mark as cancelled
        order.status = OrderStatus.CANCELLED;

        emit OrderCancelled(nftId, triggerMode, order.owner);
    }
}
