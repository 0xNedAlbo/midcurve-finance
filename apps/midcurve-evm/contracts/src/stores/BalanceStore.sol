// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/CoreControlled.sol";
import "../interfaces/IBalanceStore.sol";

/**
 * @title BalanceStore
 * @notice Tracks strategy-specific token balances across chains
 * @dev Balance data is written by Core and readable only by the owning strategy.
 *      Balances are tracked per strategy, per chain, per token.
 */
contract BalanceStore is CoreControlled, IBalanceStore {
    /// @notice Mapping: strategy => chainId => token => balance entry
    mapping(address => mapping(uint256 => mapping(address => BalanceEntry))) internal _balances;

    /// @notice Track tokens per strategy per chain for enumeration
    mapping(address => mapping(uint256 => address[])) internal _tokenLists;

    /// @notice Track if a token exists in the list (to avoid duplicates)
    mapping(address => mapping(uint256 => mapping(address => bool))) internal _tokenExists;

    /// @inheritdoc IBalanceStore
    function updateBalance(
        address strategy,
        uint256 chainId,
        address token,
        uint256 balance
    ) external override onlyCore {
        _balances[strategy][chainId][token] = BalanceEntry({
            chainId: chainId,
            token: token,
            balance: balance,
            lastUpdated: block.timestamp
        });

        // Track token for enumeration if new
        if (!_tokenExists[strategy][chainId][token]) {
            _tokenLists[strategy][chainId].push(token);
            _tokenExists[strategy][chainId][token] = true;
        }

        emit BalanceUpdated(strategy, chainId, token, balance);
    }

    /// @inheritdoc IBalanceStore
    function getBalance(uint256 chainId, address token) external view override returns (uint256) {
        return _balances[msg.sender][chainId][token].balance;
    }

    /// @inheritdoc IBalanceStore
    function getAllBalances(uint256 chainId) external view override returns (BalanceEntry[] memory) {
        address[] memory tokens = _tokenLists[msg.sender][chainId];
        BalanceEntry[] memory entries = new BalanceEntry[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            entries[i] = _balances[msg.sender][chainId][tokens[i]];
        }

        return entries;
    }
}
