// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISystemRegistry} from "../interfaces/ISystemRegistry.sol";
import {IPositionStore} from "../interfaces/IPositionStore.sol";

/**
 * @title UniswapV3ActionLib
 * @notice Library for Uniswap V3 position management actions and subscriptions
 * @dev Use with `using UniswapV3ActionLib for *;` in strategies that implement IUniswapV3Actions
 */
library UniswapV3ActionLib {
    /// @notice Emitted when a subscription is requested
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    /// @notice Emitted when an unsubscription is requested
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    /// @notice Emitted when an action is requested
    event ActionRequested(bytes32 indexed actionType, bytes payload);

    /// @notice The subscription type identifier for position subscriptions
    bytes32 constant SUBSCRIPTION_TYPE = keccak256("Subscription:Position:v1");

    /// @notice Action type identifiers
    bytes32 constant ACTION_ADD_LIQUIDITY = keccak256("Action:UniswapV3:AddLiquidity:v1");
    bytes32 constant ACTION_REMOVE_LIQUIDITY = keccak256("Action:UniswapV3:RemoveLiquidity:v1");
    bytes32 constant ACTION_COLLECT_FEES = keccak256("Action:UniswapV3:CollectFees:v1");

    /// @notice The well-known address of the SystemRegistry
    ISystemRegistry constant REGISTRY = ISystemRegistry(0x0000000000000000000000000000000000001000);

    /**
     * @notice Subscribe to position state updates
     * @param positionId The position identifier (use ResourceIds.positionId() to generate)
     */
    function subscribePosition(bytes32 positionId) internal {
        emit SubscriptionRequested(SUBSCRIPTION_TYPE, abi.encode(positionId));
    }

    /**
     * @notice Unsubscribe from position state updates
     * @param positionId The position identifier
     */
    function unsubscribePosition(bytes32 positionId) internal {
        emit UnsubscriptionRequested(SUBSCRIPTION_TYPE, abi.encode(positionId));
    }

    /**
     * @notice Request to add liquidity to a position
     * @param effectId The effect ID for tracking this action (use _nextEffectId())
     * @param poolId The pool identifier to add liquidity to
     * @param tickLower The lower tick boundary of the position
     * @param tickUpper The upper tick boundary of the position
     * @param amount0Desired The desired amount of token0 to add
     * @param amount1Desired The desired amount of token1 to add
     */
    function emitAddLiquidity(
        bytes32 effectId,
        bytes32 poolId,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) internal {
        emit ActionRequested(
            ACTION_ADD_LIQUIDITY,
            abi.encode(effectId, poolId, tickLower, tickUpper, amount0Desired, amount1Desired)
        );
    }

    /**
     * @notice Request to remove liquidity from a position
     * @param effectId The effect ID for tracking this action (use _nextEffectId())
     * @param positionId The position identifier to remove liquidity from
     * @param liquidityAmount The amount of liquidity to remove (use type(uint128).max for all)
     */
    function emitRemoveLiquidity(
        bytes32 effectId,
        bytes32 positionId,
        uint128 liquidityAmount
    ) internal {
        emit ActionRequested(
            ACTION_REMOVE_LIQUIDITY,
            abi.encode(effectId, positionId, liquidityAmount)
        );
    }

    /**
     * @notice Request to collect fees from a position
     * @param effectId The effect ID for tracking this action (use _nextEffectId())
     * @param positionId The position identifier to collect fees from
     */
    function emitCollectFees(bytes32 effectId, bytes32 positionId) internal {
        emit ActionRequested(
            ACTION_COLLECT_FEES,
            abi.encode(effectId, positionId)
        );
    }

    /**
     * @notice Get the PositionStore contract instance
     * @return The PositionStore contract
     */
    function positionStore() internal view returns (IPositionStore) {
        return IPositionStore(REGISTRY.positionStore());
    }
}
