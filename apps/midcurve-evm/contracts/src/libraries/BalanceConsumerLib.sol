// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISystemRegistry} from "../interfaces/ISystemRegistry.sol";
import {IBalanceStore} from "../interfaces/IBalanceStore.sol";

/**
 * @title BalanceConsumerLib
 * @notice Library for balance subscription management and store access
 * @dev Use with `using BalanceConsumerLib for *;` in strategies that implement IBalanceConsumer
 */
library BalanceConsumerLib {
    /// @notice Emitted when a subscription is requested
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    /// @notice Emitted when an unsubscription is requested
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    /// @notice The subscription type identifier for balance subscriptions
    bytes32 constant SUBSCRIPTION_TYPE = keccak256("Subscription:Balance:v1");

    /// @notice The well-known address of the SystemRegistry
    ISystemRegistry constant REGISTRY = ISystemRegistry(0x0000000000000000000000000000000000001000);

    /**
     * @notice Subscribe to balance updates for a token on a chain
     * @param chainId The chain ID where the token exists
     * @param token The address of the token contract
     */
    function subscribeBalance(uint256 chainId, address token) internal {
        emit SubscriptionRequested(SUBSCRIPTION_TYPE, abi.encode(chainId, token));
    }

    /**
     * @notice Unsubscribe from balance updates for a token on a chain
     * @param chainId The chain ID where the token exists
     * @param token The address of the token contract
     */
    function unsubscribeBalance(uint256 chainId, address token) internal {
        emit UnsubscriptionRequested(SUBSCRIPTION_TYPE, abi.encode(chainId, token));
    }

    /**
     * @notice Get the BalanceStore contract instance
     * @return The BalanceStore contract
     */
    function balanceStore() internal view returns (IBalanceStore) {
        return IBalanceStore(REGISTRY.balanceStore());
    }
}
