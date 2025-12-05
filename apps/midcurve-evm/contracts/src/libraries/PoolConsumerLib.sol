// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISystemRegistry} from "../interfaces/ISystemRegistry.sol";
import {IPoolStore} from "../interfaces/IPoolStore.sol";

/**
 * @title PoolConsumerLib
 * @notice Library for pool subscription management and store access
 * @dev Use with `using PoolConsumerLib for *;` in strategies that implement IPoolConsumer
 */
library PoolConsumerLib {
    /// @notice Emitted when a subscription is requested
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    /// @notice Emitted when an unsubscription is requested
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    /// @notice The subscription type identifier for pool subscriptions
    bytes32 constant SUBSCRIPTION_TYPE = keccak256("Subscription:Pool:v1");

    /// @notice The well-known address of the SystemRegistry
    ISystemRegistry constant REGISTRY = ISystemRegistry(0x0000000000000000000000000000000000001000);

    /**
     * @notice Subscribe to pool state updates
     * @param poolId The pool identifier (use ResourceIds.poolId() to generate)
     */
    function subscribePool(bytes32 poolId) internal {
        emit SubscriptionRequested(SUBSCRIPTION_TYPE, abi.encode(poolId));
    }

    /**
     * @notice Unsubscribe from pool state updates
     * @param poolId The pool identifier
     */
    function unsubscribePool(bytes32 poolId) internal {
        emit UnsubscriptionRequested(SUBSCRIPTION_TYPE, abi.encode(poolId));
    }

    /**
     * @notice Get the PoolStore contract instance
     * @return The PoolStore contract
     */
    function poolStore() internal view returns (IPoolStore) {
        return IPoolStore(REGISTRY.poolStore());
    }
}
