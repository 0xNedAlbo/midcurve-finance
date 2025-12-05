// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/CoreControlled.sol";
import "../interfaces/ISystemRegistry.sol";

/**
 * @title SystemRegistry
 * @notice Central registry for all SEMSEE system contracts
 * @dev Deployed at well-known address 0x0000000000000000000000000000000000001000
 *      via genesis allocation. All store addresses are registered here by Core.
 */
contract SystemRegistry is CoreControlled, ISystemRegistry {
    /// @inheritdoc ISystemRegistry
    address public override poolStore;

    /// @inheritdoc ISystemRegistry
    address public override positionStore;

    /// @inheritdoc ISystemRegistry
    address public override balanceStore;

    /// @inheritdoc ISystemRegistry
    address public override ohlcStore;

    /// @inheritdoc ISystemRegistry
    function setPoolStore(address _poolStore) external override onlyCore {
        address oldAddress = poolStore;
        poolStore = _poolStore;
        emit PoolStoreUpdated(oldAddress, _poolStore);
    }

    /// @inheritdoc ISystemRegistry
    function setPositionStore(address _positionStore) external override onlyCore {
        address oldAddress = positionStore;
        positionStore = _positionStore;
        emit PositionStoreUpdated(oldAddress, _positionStore);
    }

    /// @inheritdoc ISystemRegistry
    function setBalanceStore(address _balanceStore) external override onlyCore {
        address oldAddress = balanceStore;
        balanceStore = _balanceStore;
        emit BalanceStoreUpdated(oldAddress, _balanceStore);
    }

    /// @inheritdoc ISystemRegistry
    function setOhlcStore(address _ohlcStore) external override onlyCore {
        address oldAddress = ohlcStore;
        ohlcStore = _ohlcStore;
        emit OhlcStoreUpdated(oldAddress, _ohlcStore);
    }
}
