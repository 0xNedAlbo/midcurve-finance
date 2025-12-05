// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISystemRegistry
 * @notice Interface for the central registry of all SEMSEE system contracts
 * @dev Deployed at well-known address 0x0000000000000000000000000000000000001000
 */
interface ISystemRegistry {
    /// @notice Returns the address of the PoolStore contract
    function poolStore() external view returns (address);

    /// @notice Returns the address of the PositionStore contract
    function positionStore() external view returns (address);

    /// @notice Returns the address of the BalanceStore contract
    function balanceStore() external view returns (address);

    /// @notice Sets the PoolStore address (Core only)
    /// @param _poolStore The address of the PoolStore contract
    function setPoolStore(address _poolStore) external;

    /// @notice Sets the PositionStore address (Core only)
    /// @param _positionStore The address of the PositionStore contract
    function setPositionStore(address _positionStore) external;

    /// @notice Sets the BalanceStore address (Core only)
    /// @param _balanceStore The address of the BalanceStore contract
    function setBalanceStore(address _balanceStore) external;

    /// @notice Emitted when the PoolStore address is updated
    event PoolStoreUpdated(address indexed oldAddress, address indexed newAddress);

    /// @notice Emitted when the PositionStore address is updated
    event PositionStoreUpdated(address indexed oldAddress, address indexed newAddress);

    /// @notice Emitted when the BalanceStore address is updated
    event BalanceStoreUpdated(address indexed oldAddress, address indexed newAddress);
}
