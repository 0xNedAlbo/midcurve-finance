// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IBalanceConsumer
 * @notice Interface for strategies that consume token balance updates
 * @dev Implement this interface to receive balance update callbacks from Core
 */
interface IBalanceConsumer {
    /**
     * @notice Called when a token balance is updated
     * @param chainId The chain ID where the token exists
     * @param token The address of the token contract
     * @param balance The current balance of the token
     */
    function onBalanceUpdate(
        uint256 chainId,
        address token,
        uint256 balance
    ) external;
}
