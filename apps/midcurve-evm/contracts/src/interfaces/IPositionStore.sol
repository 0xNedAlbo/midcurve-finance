// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPositionStore
 * @notice Interface for storing Uniswap V3 position state with access control
 */
interface IPositionStore {
    /// @notice Position state data structure
    struct PositionState {
        uint256 chainId;
        uint256 nftTokenId;
        bytes32 poolId;
        address owner; // Strategy address that owns this position
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
        uint256 lastUpdated;
    }

    /// @notice Error thrown when a non-owner attempts to access position data
    error NotPositionOwner();

    /// @notice Updates the state of a position (Core only)
    /// @param positionId The unique identifier for the position
    /// @param state The new position state
    function updatePosition(bytes32 positionId, PositionState calldata state) external;

    /// @notice Returns the full state of a position (owner only)
    /// @param positionId The unique identifier for the position
    /// @return The position state
    function getPosition(bytes32 positionId) external view returns (PositionState memory);

    /// @notice Checks if an address is the owner of a position
    /// @param positionId The unique identifier for the position
    /// @param strategy The address to check
    /// @return True if the strategy owns the position
    function isOwner(bytes32 positionId, address strategy) external view returns (bool);

    /// @notice Emitted when a position state is updated
    event PositionUpdated(bytes32 indexed positionId, address indexed owner, uint128 liquidity);
}
