// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, SwapDirection, VaultCloseOrder, Modifiers} from "../storage/AppStorage.sol";

/// @title OwnerUpdateFacet
/// @notice Facet for updating vault close order parameters
/// @dev Only the order owner (msg.sender) can update order parameters
contract OwnerUpdateFacet is Modifiers {
    // ========================================
    // EVENTS
    // ========================================

    event OrderOperatorUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address oldOperator,
        address newOperator
    );

    event OrderPayoutUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address oldPayout,
        address newPayout
    );

    event OrderTriggerTickUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        int24 oldTick,
        int24 newTick
    );

    event OrderValidUntilUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        uint256 oldValidUntil,
        uint256 newValidUntil
    );

    event OrderSlippageUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        uint16 oldSlippageBps,
        uint16 newSlippageBps
    );

    event OrderSwapIntentUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        SwapDirection oldDirection,
        SwapDirection newDirection,
        uint16 swapSlippageBps
    );

    event OrderSharesUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        uint256 oldShares,
        uint256 newShares
    );

    // ========================================
    // INTERNAL HELPERS
    // ========================================

    /// @dev Validates that caller is the order owner and order is ACTIVE
    function _validateOwnerAndStatus(VaultCloseOrder storage order) internal view {
        if (msg.sender != order.owner) revert NotOwner();
        if (order.status != OrderStatus.ACTIVE) {
            revert WrongOrderStatus(OrderStatus.ACTIVE, order.status);
        }
    }

    // ========================================
    // UPDATE FUNCTIONS
    // ========================================

    /// @notice Update the operator for an order
    function setOperator(address vault, TriggerMode triggerMode, address newOperator)
        external
        whenInitialized
        orderMustExist(vault, msg.sender, triggerMode)
    {
        if (newOperator == address(0)) revert ZeroAddress();

        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, msg.sender, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        address oldOperator = order.operator;
        order.operator = newOperator;

        emit OrderOperatorUpdated(vault, triggerMode, msg.sender, oldOperator, newOperator);
    }

    /// @notice Update the payout address for an order
    function setPayout(address vault, TriggerMode triggerMode, address newPayout)
        external
        whenInitialized
        orderMustExist(vault, msg.sender, triggerMode)
    {
        if (newPayout == address(0)) revert ZeroAddress();

        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, msg.sender, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        address oldPayout = order.payout;
        order.payout = newPayout;

        emit OrderPayoutUpdated(vault, triggerMode, msg.sender, oldPayout, newPayout);
    }

    /// @notice Update the trigger tick for an order
    function setTriggerTick(address vault, TriggerMode triggerMode, int24 newTriggerTick)
        external
        whenInitialized
        orderMustExist(vault, msg.sender, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, msg.sender, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        int24 oldTick = order.triggerTick;
        order.triggerTick = newTriggerTick;

        emit OrderTriggerTickUpdated(vault, triggerMode, msg.sender, oldTick, newTriggerTick);
    }

    /// @notice Update the expiration for an order
    function setValidUntil(address vault, TriggerMode triggerMode, uint256 newValidUntil)
        external
        whenInitialized
        orderMustExist(vault, msg.sender, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, msg.sender, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        uint256 oldValidUntil = order.validUntil;
        order.validUntil = newValidUntil;

        emit OrderValidUntilUpdated(vault, triggerMode, msg.sender, oldValidUntil, newValidUntil);
    }

    /// @notice Update the slippage for an order
    function setSlippage(address vault, TriggerMode triggerMode, uint16 newSlippageBps)
        external
        whenInitialized
        orderMustExist(vault, msg.sender, triggerMode)
    {
        if (newSlippageBps > 10000) revert SlippageBpsOutOfRange(newSlippageBps);

        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, msg.sender, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        uint16 oldSlippageBps = order.slippageBps;
        order.slippageBps = newSlippageBps;

        emit OrderSlippageUpdated(vault, triggerMode, msg.sender, oldSlippageBps, newSlippageBps);
    }

    /// @notice Update the swap configuration for an order
    function setSwapIntent(
        address vault,
        TriggerMode triggerMode,
        SwapDirection direction,
        uint16 swapSlippageBps
    )
        external
        whenInitialized
        orderMustExist(vault, msg.sender, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, msg.sender, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        if (direction != SwapDirection.NONE) {
            if (swapSlippageBps > 10000) revert SwapSlippageBpsOutOfRange(swapSlippageBps);
        }

        SwapDirection oldDirection = order.swapDirection;
        order.swapDirection = direction;
        order.swapSlippageBps = swapSlippageBps;

        emit OrderSwapIntentUpdated(vault, triggerMode, msg.sender, oldDirection, direction, swapSlippageBps);
    }

    /// @notice Update the share amount for an order
    /// @param vault The vault address
    /// @param triggerMode The trigger mode
    /// @param newShares New share amount (0 = close all at execution time)
    function setShares(address vault, TriggerMode triggerMode, uint256 newShares)
        external
        whenInitialized
        orderMustExist(vault, msg.sender, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, msg.sender, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        uint256 oldShares = order.shares;
        order.shares = newShares;

        emit OrderSharesUpdated(vault, triggerMode, msg.sender, oldShares, newShares);
    }
}
