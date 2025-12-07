// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FundingLib
 * @notice Library for emitting funding-related events
 * @dev Use with `using FundingLib for *;` in strategies that implement IFunding
 *
 * This library provides helper functions to emit funding events.
 * Strategies should use these functions in their IFunding implementation.
 *
 * Example usage:
 * ```solidity
 * using FundingLib for *;
 *
 * function withdrawErc20(uint256 chainId, address token, uint256 amount)
 *     external
 *     onlyOwner
 *     returns (bytes32 requestId)
 * {
 *     requestId = _nextEffectId();
 *     FundingLib.emitErc20WithdrawRequested(requestId, chainId, token, amount, owner);
 * }
 * ```
 */
library FundingLib {
    /// @notice Sentinel address representing native ETH in BalanceStore
    address constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // ============= Events (duplicated from IFunding for library emission) =============

    /// @notice Emitted when owner requests ERC-20 token withdrawal
    event Erc20WithdrawRequested(
        bytes32 indexed requestId,
        uint256 indexed chainId,
        address indexed token,
        uint256 amount,
        address recipient
    );

    /// @notice Emitted when owner requests native ETH withdrawal
    event EthWithdrawRequested(
        bytes32 indexed requestId,
        uint256 indexed chainId,
        uint256 amount,
        address recipient
    );

    /// @notice Emitted when owner requests ETH balance update
    event EthBalanceUpdateRequested(
        bytes32 indexed requestId,
        uint256 indexed chainId
    );

    /**
     * @notice Emit ERC-20 withdrawal request event
     * @param requestId Unique identifier for tracking this request
     * @param chainId The chain where tokens should be transferred
     * @param token The ERC-20 token address
     * @param amount The amount to withdraw
     * @param recipient The address to receive tokens (should be owner)
     */
    function emitErc20WithdrawRequested(
        bytes32 requestId,
        uint256 chainId,
        address token,
        uint256 amount,
        address recipient
    ) internal {
        emit Erc20WithdrawRequested(
            requestId,
            chainId,
            token,
            amount,
            recipient
        );
    }

    /**
     * @notice Emit ETH withdrawal request event
     * @param requestId Unique identifier for tracking this request
     * @param chainId The chain where ETH should be transferred
     * @param amount The amount to withdraw (in wei)
     * @param recipient The address to receive ETH (should be owner)
     */
    function emitEthWithdrawRequested(
        bytes32 requestId,
        uint256 chainId,
        uint256 amount,
        address recipient
    ) internal {
        emit EthWithdrawRequested(
            requestId,
            chainId,
            amount,
            recipient
        );
    }

    /**
     * @notice Emit ETH balance update request event
     * @param requestId Unique identifier for tracking this request
     * @param chainId The chain to poll ETH balance from
     */
    function emitEthBalanceUpdateRequested(
        bytes32 requestId,
        uint256 chainId
    ) internal {
        emit EthBalanceUpdateRequested(requestId, chainId);
    }
}
