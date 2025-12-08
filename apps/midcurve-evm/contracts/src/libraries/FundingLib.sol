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
 * function updateEthBalance(uint256 chainId)
 *     external
 *     onlyOwner
 *     returns (bytes32 requestId)
 * {
 *     requestId = _nextEffectId();
 *     FundingLib.emitEthBalanceUpdateRequested(requestId, chainId);
 * }
 * ```
 */
library FundingLib {
    /// @notice Sentinel address representing native ETH in BalanceStore
    address constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // ============= Events (duplicated from IFunding for library emission) =============

    /// @notice Emitted when owner requests ETH balance update
    event EthBalanceUpdateRequested(
        bytes32 indexed requestId,
        uint256 indexed chainId
    );

    /// @notice Emitted when a token is added to the watchlist for deposit detection
    event TokenWatchlistAdd(
        uint256 indexed chainId,
        address indexed token
    );

    /// @notice Emitted when a token is removed from the watchlist
    event TokenWatchlistRemove(
        uint256 indexed chainId,
        address indexed token
    );

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

    /**
     * @notice Emit token watchlist add event
     * @dev Core will start watching for Transfer events of this token to automation wallet
     * @param chainId The chain where the token is deployed
     * @param token The ERC-20 token address to watch
     */
    function emitTokenWatchlistAdd(
        uint256 chainId,
        address token
    ) internal {
        emit TokenWatchlistAdd(chainId, token);
    }

    /**
     * @notice Emit token watchlist remove event
     * @dev Core will stop watching for Transfer events of this token
     * @param chainId The chain where the token is deployed
     * @param token The ERC-20 token address to stop watching
     */
    function emitTokenWatchlistRemove(
        uint256 chainId,
        address token
    ) internal {
        emit TokenWatchlistRemove(chainId, token);
    }
}
