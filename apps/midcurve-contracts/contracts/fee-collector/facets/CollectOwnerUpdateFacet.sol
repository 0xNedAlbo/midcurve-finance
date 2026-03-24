// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, CollectOrderStatus, SwapDirection, CollectOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3PoolMinimal} from "../../position-closer/interfaces/IUniswapV3PoolMinimal.sol";

/// @title CollectOwnerUpdateFacet
/// @notice Facet for updating collect order parameters
/// @dev Only the order owner can update order parameters
contract CollectOwnerUpdateFacet is Modifiers {
    // ========================================
    // EVENTS
    // ========================================

    event CollectOperatorUpdated(
        uint256 indexed nftId,
        address oldOperator,
        address newOperator
    );

    event CollectPayoutUpdated(
        uint256 indexed nftId,
        address oldPayout,
        address newPayout
    );

    event CollectValidUntilUpdated(
        uint256 indexed nftId,
        uint256 oldValidUntil,
        uint256 newValidUntil
    );

    event CollectSwapIntentUpdated(
        uint256 indexed nftId,
        SwapDirection oldDirection,
        SwapDirection newDirection,
        uint16 swapSlippageBps
    );

    event CollectMinFeeUpdated(
        uint256 indexed nftId,
        address oldToken,
        address newToken,
        uint256 oldValue,
        uint256 newValue
    );

    // ========================================
    // INTERNAL HELPERS
    // ========================================

    /// @dev Validates that caller is the order owner and order is ACTIVE
    function _validateOwnerAndStatus(CollectOrder storage order) internal view {
        if (msg.sender != order.owner) revert NotOwner();
        if (order.status != CollectOrderStatus.ACTIVE) {
            revert WrongOrderStatus(CollectOrderStatus.ACTIVE, order.status);
        }
    }

    // ========================================
    // UPDATE FUNCTIONS
    // ========================================

    /// @notice Update the operator for a collect order
    function setCollectOperator(uint256 nftId, address newOperator)
        external
        whenInitialized
        orderMustExist(nftId)
    {
        if (newOperator == address(0)) revert ZeroAddress();

        AppStorage storage s = LibAppStorage.appStorage();
        CollectOrder storage order = s.orders[nftId];

        _validateOwnerAndStatus(order);

        address oldOperator = order.operator;
        order.operator = newOperator;

        emit CollectOperatorUpdated(nftId, oldOperator, newOperator);
    }

    /// @notice Update the payout address for a collect order
    function setCollectPayout(uint256 nftId, address newPayout)
        external
        whenInitialized
        orderMustExist(nftId)
    {
        if (newPayout == address(0)) revert ZeroAddress();

        AppStorage storage s = LibAppStorage.appStorage();
        CollectOrder storage order = s.orders[nftId];

        _validateOwnerAndStatus(order);

        address oldPayout = order.payout;
        order.payout = newPayout;

        emit CollectPayoutUpdated(nftId, oldPayout, newPayout);
    }

    /// @notice Update the expiration for a collect order
    function setCollectValidUntil(uint256 nftId, uint256 newValidUntil)
        external
        whenInitialized
        orderMustExist(nftId)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        CollectOrder storage order = s.orders[nftId];

        _validateOwnerAndStatus(order);

        uint256 oldValidUntil = order.validUntil;
        order.validUntil = newValidUntil;

        emit CollectValidUntilUpdated(nftId, oldValidUntil, newValidUntil);
    }

    /// @notice Update the swap configuration for a collect order
    function setCollectSwapIntent(uint256 nftId, SwapDirection direction, uint16 swapSlippageBps)
        external
        whenInitialized
        orderMustExist(nftId)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        CollectOrder storage order = s.orders[nftId];

        _validateOwnerAndStatus(order);

        // Validate swap config if enabling
        if (direction != SwapDirection.NONE) {
            if (swapSlippageBps > 10000) revert SwapSlippageBpsOutOfRange(swapSlippageBps);
        }

        SwapDirection oldDirection = order.swapDirection;
        order.swapDirection = direction;
        order.swapSlippageBps = swapSlippageBps;

        emit CollectSwapIntentUpdated(nftId, oldDirection, direction, swapSlippageBps);
    }

    /// @notice Update the minimum fee threshold for a collect order
    function setCollectMinFee(uint256 nftId, address minFeeToken, uint256 newMinFeeValue)
        external
        whenInitialized
        orderMustExist(nftId)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        CollectOrder storage order = s.orders[nftId];

        _validateOwnerAndStatus(order);

        // Validate minFeeToken is token0 or token1 of the pool
        address token0 = IUniswapV3PoolMinimal(order.pool).token0();
        address token1 = IUniswapV3PoolMinimal(order.pool).token1();
        if (minFeeToken != token0 && minFeeToken != token1) {
            revert InvalidMinFeeToken(minFeeToken, token0, token1);
        }

        address oldToken = order.minFeeToken;
        uint256 oldValue = order.minFeeValue;
        order.minFeeToken = minFeeToken;
        order.minFeeValue = newMinFeeValue;

        emit CollectMinFeeUpdated(nftId, oldToken, minFeeToken, oldValue, newMinFeeValue);
    }
}
