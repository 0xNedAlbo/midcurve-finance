// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, SwapDirection, CloseOrder, Modifiers} from "../storage/AppStorage.sol";

/// @title OwnerUpdateFacet
/// @notice Facet for updating close order parameters
/// @dev Only the order owner can update order parameters
contract OwnerUpdateFacet is Modifiers {
    // ========================================
    // EVENTS
    // ========================================

    event OrderOperatorUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address oldOperator,
        address newOperator
    );

    event OrderPayoutUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address oldPayout,
        address newPayout
    );

    event OrderTriggerTickUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        int24 oldTick,
        int24 newTick
    );

    event OrderValidUntilUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        uint256 oldValidUntil,
        uint256 newValidUntil
    );

    event OrderSlippageUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        uint16 oldSlippageBps,
        uint16 newSlippageBps
    );

    event OrderSwapIntentUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        SwapDirection oldDirection,
        SwapDirection newDirection,
        uint16 swapSlippageBps
    );

    // ========================================
    // INTERNAL HELPERS
    // ========================================

    /// @dev Validates that caller is the order owner and order is ACTIVE
    function _validateOwnerAndStatus(CloseOrder storage order) internal view {
        if (msg.sender != order.owner) revert NotOwner();
        if (order.status != OrderStatus.ACTIVE) {
            revert WrongOrderStatus(OrderStatus.ACTIVE, order.status);
        }
    }

    // ========================================
    // UPDATE FUNCTIONS
    // ========================================

    /// @notice Update the operator for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newOperator The new operator address
    function setOperator(uint256 nftId, TriggerMode triggerMode, address newOperator)
        external
        whenInitialized
        orderMustExist(nftId, triggerMode)
    {
        if (newOperator == address(0)) revert ZeroAddress();

        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        address oldOperator = order.operator;
        order.operator = newOperator;

        emit OrderOperatorUpdated(nftId, triggerMode, oldOperator, newOperator);
    }

    /// @notice Update the payout address for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newPayout The new payout address
    function setPayout(uint256 nftId, TriggerMode triggerMode, address newPayout)
        external
        whenInitialized
        orderMustExist(nftId, triggerMode)
    {
        if (newPayout == address(0)) revert ZeroAddress();

        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        address oldPayout = order.payout;
        order.payout = newPayout;

        emit OrderPayoutUpdated(nftId, triggerMode, oldPayout, newPayout);
    }

    /// @notice Update the trigger tick for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newTriggerTick The new trigger tick
    function setTriggerTick(uint256 nftId, TriggerMode triggerMode, int24 newTriggerTick)
        external
        whenInitialized
        orderMustExist(nftId, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        int24 oldTick = order.triggerTick;
        order.triggerTick = newTriggerTick;

        emit OrderTriggerTickUpdated(nftId, triggerMode, oldTick, newTriggerTick);
    }

    /// @notice Update the expiration for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newValidUntil The new expiration timestamp (0 = no expiry)
    function setValidUntil(uint256 nftId, TriggerMode triggerMode, uint256 newValidUntil)
        external
        whenInitialized
        orderMustExist(nftId, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        uint256 oldValidUntil = order.validUntil;
        order.validUntil = newValidUntil;

        emit OrderValidUntilUpdated(nftId, triggerMode, oldValidUntil, newValidUntil);
    }

    /// @notice Update the slippage for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newSlippageBps The new slippage in basis points
    function setSlippage(uint256 nftId, TriggerMode triggerMode, uint16 newSlippageBps)
        external
        whenInitialized
        orderMustExist(nftId, triggerMode)
    {
        if (newSlippageBps > 10000) revert SlippageBpsOutOfRange(newSlippageBps);

        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        uint16 oldSlippageBps = order.slippageBps;
        order.slippageBps = newSlippageBps;

        emit OrderSlippageUpdated(nftId, triggerMode, oldSlippageBps, newSlippageBps);
    }

    /// @notice Update the swap configuration for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param direction The new swap direction (TOKEN0_TO_1 or TOKEN1_TO_0)
    /// @param swapSlippageBps The swap slippage in basis points
    function setSwapIntent(
        uint256 nftId,
        TriggerMode triggerMode,
        SwapDirection direction,
        uint16 swapSlippageBps
    )
        external
        whenInitialized
        orderMustExist(nftId, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        // Validate swap config if enabling
        if (direction != SwapDirection.NONE) {
            if (swapSlippageBps > 10000) revert SwapSlippageBpsOutOfRange(swapSlippageBps);
        }

        SwapDirection oldDirection = order.swapDirection;
        order.swapDirection = direction;
        order.swapSlippageBps = swapSlippageBps;

        emit OrderSwapIntentUpdated(nftId, triggerMode, oldDirection, direction, swapSlippageBps);
    }
}
