// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, OrderType, OrderStatus, SwapDirection, CloseOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";

/// @title OwnerUpdateFacet
/// @notice Facet for updating close order parameters
/// @dev Only the order owner can update order parameters
contract OwnerUpdateFacet is Modifiers {
    // ========================================
    // EVENTS
    // ========================================

    event OrderOperatorUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        address oldOperator,
        address newOperator
    );

    event OrderPayoutUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        address oldPayout,
        address newPayout
    );

    event OrderTriggerTickUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        int24 oldTick,
        int24 newTick
    );

    event OrderValidUntilUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        uint256 oldValidUntil,
        uint256 newValidUntil
    );

    event OrderSlippageUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        uint16 oldSlippageBps,
        uint16 newSlippageBps
    );

    event OrderSwapIntentUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        SwapDirection oldDirection,
        SwapDirection newDirection
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
    /// @param orderType The order type
    /// @param newOperator The new operator address
    function setOperator(uint256 nftId, OrderType orderType, address newOperator)
        external
        whenInitialized
        orderMustExist(nftId, orderType)
    {
        if (newOperator == address(0)) revert ZeroAddress();

        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, orderType);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        address oldOperator = order.operator;
        order.operator = newOperator;

        emit OrderOperatorUpdated(nftId, orderType, oldOperator, newOperator);
    }

    /// @notice Update the payout address for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param newPayout The new payout address
    function setPayout(uint256 nftId, OrderType orderType, address newPayout)
        external
        whenInitialized
        orderMustExist(nftId, orderType)
    {
        if (newPayout == address(0)) revert ZeroAddress();

        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, orderType);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        address oldPayout = order.payout;
        order.payout = newPayout;

        emit OrderPayoutUpdated(nftId, orderType, oldPayout, newPayout);
    }

    /// @notice Update the trigger tick for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param newTriggerTick The new trigger tick
    function setTriggerTick(uint256 nftId, OrderType orderType, int24 newTriggerTick)
        external
        whenInitialized
        orderMustExist(nftId, orderType)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, orderType);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        int24 oldTick = order.triggerTick;
        order.triggerTick = newTriggerTick;

        emit OrderTriggerTickUpdated(nftId, orderType, oldTick, newTriggerTick);
    }

    /// @notice Update the expiration for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param newValidUntil The new expiration timestamp (0 = no expiry)
    function setValidUntil(uint256 nftId, OrderType orderType, uint256 newValidUntil)
        external
        whenInitialized
        orderMustExist(nftId, orderType)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, orderType);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        uint256 oldValidUntil = order.validUntil;
        order.validUntil = newValidUntil;

        emit OrderValidUntilUpdated(nftId, orderType, oldValidUntil, newValidUntil);
    }

    /// @notice Update the slippage for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param newSlippageBps The new slippage in basis points
    function setSlippage(uint256 nftId, OrderType orderType, uint16 newSlippageBps)
        external
        whenInitialized
        orderMustExist(nftId, orderType)
    {
        if (newSlippageBps > 10000) revert SlippageBpsOutOfRange(newSlippageBps);

        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, orderType);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        uint16 oldSlippageBps = order.slippageBps;
        order.slippageBps = newSlippageBps;

        emit OrderSlippageUpdated(nftId, orderType, oldSlippageBps, newSlippageBps);
    }

    /// @notice Update the swap configuration for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param direction The new swap direction
    /// @param quoteToken The quote token address
    /// @param swapSlippageBps The swap slippage in basis points
    function setSwapIntent(
        uint256 nftId,
        OrderType orderType,
        SwapDirection direction,
        address quoteToken,
        uint16 swapSlippageBps
    )
        external
        whenInitialized
        orderMustExist(nftId, orderType)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, orderType);
        CloseOrder storage order = s.orders[key];

        _validateOwnerAndStatus(order);

        // Validate swap config if enabling
        if (direction != SwapDirection.NONE) {
            if (quoteToken == address(0)) revert ZeroAddress();
            if (swapSlippageBps > 10000) revert SwapSlippageBpsOutOfRange(swapSlippageBps);

            // Validate quote token is token0 or token1
            address token0 = IUniswapV3PoolMinimal(order.pool).token0();
            address token1 = IUniswapV3PoolMinimal(order.pool).token1();
            if (quoteToken != token0 && quoteToken != token1) {
                revert InvalidQuoteToken(quoteToken, token0, token1);
            }
        }

        SwapDirection oldDirection = order.swapDirection;
        order.swapDirection = direction;
        order.swapQuoteToken = quoteToken;
        order.swapSlippageBps = swapSlippageBps;

        emit OrderSwapIntentUpdated(nftId, orderType, oldDirection, direction);
    }
}
