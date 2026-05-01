// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, CollectOrderStatus, SwapDirection, CollectOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3FeeCollectorV1} from "../interfaces/IUniswapV3FeeCollectorV1.sol";
import {INonfungiblePositionManagerMinimal} from "../../interfaces/INonfungiblePositionManagerMinimal.sol";
import {IUniswapV3PoolMinimal} from "../../interfaces/IUniswapV3PoolMinimal.sol";

/// @title CollectRegistrationFacet
/// @notice Facet for registering and cancelling fee collect orders
/// @dev Handles order creation and cancellation with ownership validation
contract CollectRegistrationFacet is Modifiers {
    // ========================================
    // EVENTS
    // ========================================

    event CollectRegistered(
        uint256 indexed nftId,
        address indexed owner,
        address pool,
        address operator,
        address payout,
        uint256 validUntil,
        SwapDirection swapDirection,
        uint16 swapSlippageBps,
        address minFeeToken,
        uint256 minFeeValue
    );

    event CollectCancelled(
        uint256 indexed nftId,
        address indexed owner
    );

    // ========================================
    // REGISTRATION
    // ========================================

    /// @notice Register a new fee collect order
    /// @dev Caller must be the NFT owner and must have approved this contract.
    ///      Allows overwriting orders that are Cancelled (but not Active).
    function registerCollect(IUniswapV3FeeCollectorV1.RegisterCollectParams calldata params)
        external
        whenInitialized
        nonReentrant
    {
        AppStorage storage s = LibAppStorage.appStorage();

        // Check if order already exists and is active - cannot overwrite active orders
        if (s.orderExists[params.nftId]) {
            CollectOrder storage existingOrder = s.orders[params.nftId];
            if (existingOrder.status == CollectOrderStatus.ACTIVE) {
                revert OrderAlreadyExists(params.nftId);
            }
        }

        // Validate addresses
        if (params.payout == address(0)) revert ZeroAddress();
        if (params.operator == address(0)) revert ZeroAddress();
        if (params.pool == address(0)) revert ZeroAddress();

        // Validate swap config if enabled
        if (params.swapDirection != SwapDirection.NONE) {
            if (params.swapSlippageBps > 10000) revert SwapSlippageBpsOutOfRange(params.swapSlippageBps);
        }

        // Validate minFeeToken is token0 or token1 of the pool
        address token0 = IUniswapV3PoolMinimal(params.pool).token0();
        address token1 = IUniswapV3PoolMinimal(params.pool).token1();
        if (params.minFeeToken != token0 && params.minFeeToken != token1) {
            revert InvalidMinFeeToken(params.minFeeToken, token0, token1);
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

        // Create order
        s.orders[params.nftId] = CollectOrder({
            status: CollectOrderStatus.ACTIVE,
            nftId: params.nftId,
            owner: nftOwner,
            pool: params.pool,
            payout: params.payout,
            operator: params.operator,
            validUntil: params.validUntil,
            swapDirection: params.swapDirection,
            swapSlippageBps: params.swapSlippageBps,
            minFeeToken: params.minFeeToken,
            minFeeValue: params.minFeeValue
        });

        s.orderExists[params.nftId] = true;

        emit CollectRegistered(
            params.nftId,
            nftOwner,
            params.pool,
            params.operator,
            params.payout,
            params.validUntil,
            params.swapDirection,
            params.swapSlippageBps,
            params.minFeeToken,
            params.minFeeValue
        );
    }

    /// @notice Cancel an existing collect order
    /// @dev Only the NFT owner can cancel
    function cancelCollect(uint256 nftId)
        external
        whenInitialized
        nonReentrant
        orderMustExist(nftId)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        CollectOrder storage order = s.orders[nftId];

        // Only owner can cancel
        if (msg.sender != order.owner) revert NotOwner();

        // Can only cancel ACTIVE orders
        if (order.status != CollectOrderStatus.ACTIVE) {
            revert WrongOrderStatus(CollectOrderStatus.ACTIVE, order.status);
        }

        address orderOwner = order.owner;

        emit CollectCancelled(nftId, orderOwner);

        // Delete from storage (gas refund)
        delete s.orders[nftId];
        s.orderExists[nftId] = false;
    }
}
