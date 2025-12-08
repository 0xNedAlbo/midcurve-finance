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
