// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IUniswapV3Actions
 * @notice Interface for strategies that manage Uniswap V3 positions
 * @dev Implement this interface to receive position updates and action completion callbacks
 */
interface IUniswapV3Actions {
    /**
     * @notice Called when a position's state is updated
     * @param positionId The position identifier (keccak256 of "uniswapv3:{chainId}:{nftTokenId}")
     * @param chainId The chain ID where the position exists
     * @param nftTokenId The NFT token ID of the position
     * @param liquidity The current liquidity in the position
     * @param feeGrowthInside0LastX128 Fee growth inside for token0
     * @param feeGrowthInside1LastX128 Fee growth inside for token1
     * @param tokensOwed0 Uncollected token0 fees
     * @param tokensOwed1 Uncollected token1 fees
     */
    function onPositionUpdate(
        bytes32 positionId,
        uint256 chainId,
        uint256 nftTokenId,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    ) external;

    /**
     * @notice Called when an add liquidity action completes
     * @param effectId The effect ID that was returned when the action was requested
     * @param positionId The position identifier (new or existing)
     * @param chainId The chain ID where the position was created/updated
     * @param nftTokenId The NFT token ID (0 for new positions until minted)
     * @param liquidity The amount of liquidity added
     * @param amount0 The amount of token0 used
     * @param amount1 The amount of token1 used
     * @param success Whether the action succeeded
     * @param errorMessage Error message if the action failed
     */
    function onAddLiquidityComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint256 chainId,
        uint256 nftTokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external;

    /**
     * @notice Called when a remove liquidity action completes
     * @param effectId The effect ID that was returned when the action was requested
     * @param positionId The position identifier
     * @param liquidityRemoved The amount of liquidity removed
     * @param amount0 The amount of token0 received
     * @param amount1 The amount of token1 received
     * @param success Whether the action succeeded
     * @param errorMessage Error message if the action failed
     */
    function onRemoveLiquidityComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint128 liquidityRemoved,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external;

    /**
     * @notice Called when a collect fees action completes
     * @param effectId The effect ID that was returned when the action was requested
     * @param positionId The position identifier
     * @param amount0 The amount of token0 collected
     * @param amount1 The amount of token1 collected
     * @param success Whether the action succeeded
     * @param errorMessage Error message if the action failed
     */
    function onCollectFeesComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external;
}
