// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IBalanceStore
 * @notice Interface for tracking strategy-specific token balances across chains
 */
interface IBalanceStore {
    /// @notice Balance entry data structure
    struct BalanceEntry {
        uint256 chainId;
        address token;
        uint256 balance;
        uint256 lastUpdated;
    }

    /// @notice Updates a strategy's token balance (Core only)
    /// @param strategy The strategy address
    /// @param chainId The chain ID
    /// @param token The token address
    /// @param balance The new balance
    function updateBalance(
        address strategy,
        uint256 chainId,
        address token,
        uint256 balance
    ) external;

    /// @notice Returns the caller's balance for a specific token on a chain
    /// @param chainId The chain ID
    /// @param token The token address
    /// @return The balance
    function getBalance(uint256 chainId, address token) external view returns (uint256);

    /// @notice Returns all of the caller's balances on a specific chain
    /// @param chainId The chain ID
    /// @return Array of balance entries
    function getAllBalances(uint256 chainId) external view returns (BalanceEntry[] memory);

    /// @notice Emitted when a balance is updated
    event BalanceUpdated(
        address indexed strategy,
        uint256 indexed chainId,
        address indexed token,
        uint256 balance
    );
}
