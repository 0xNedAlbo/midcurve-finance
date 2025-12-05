// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/CoreControlled.sol";
import "../interfaces/IPositionStore.sol";

/**
 * @title PositionStore
 * @notice Stores Uniswap V3 position state with access control
 * @dev Position data is written by Core and readable only by the owning strategy.
 *      Position IDs are computed off-chain as keccak256(abi.encodePacked(chainId, nftTokenId)).
 */
contract PositionStore is CoreControlled, IPositionStore {
    /// @notice Mapping from position ID to position state
    mapping(bytes32 => PositionState) internal _positions;

    /// @inheritdoc IPositionStore
    function updatePosition(
        bytes32 positionId,
        PositionState calldata state
    ) external override onlyCore {
        _positions[positionId] = state;
        emit PositionUpdated(positionId, state.owner, state.liquidity);
    }

    /// @inheritdoc IPositionStore
    function getPosition(bytes32 positionId) external view override returns (PositionState memory) {
        PositionState memory pos = _positions[positionId];
        if (pos.owner != msg.sender) revert NotPositionOwner();
        return pos;
    }

    /// @inheritdoc IPositionStore
    function isOwner(bytes32 positionId, address strategy) external view override returns (bool) {
        return _positions[positionId].owner == strategy;
    }
}
