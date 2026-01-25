// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC721Minimal} from "./IERC721Minimal.sol";

/// @title INonfungiblePositionManagerMinimal
/// @notice Minimal interface for Uniswap V3 NonfungiblePositionManager
interface INonfungiblePositionManagerMinimal is IERC721Minimal {
    /// @notice Parameters for decreasing liquidity
    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    /// @notice Parameters for collecting tokens
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    /// @notice Returns the position information associated with a given token ID
    /// @param tokenId The ID of the token that represents the position
    /// @return nonce The nonce for permits
    /// @return operator The address that is approved for spending
    /// @return token0 The address of the token0 for a specific pool
    /// @return token1 The address of the token1 for a specific pool
    /// @return fee The fee associated with the pool
    /// @return tickLower The lower end of the tick range for the position
    /// @return tickUpper The higher end of the tick range for the position
    /// @return liquidity The liquidity of the position
    /// @return feeGrowthInside0LastX128 The fee growth of token0 as of the last action
    /// @return feeGrowthInside1LastX128 The fee growth of token1 as of the last action
    /// @return tokensOwed0 The uncollected amount of token0 owed to the position
    /// @return tokensOwed1 The uncollected amount of token1 owed to the position
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    /// @notice Decreases the amount of liquidity in a position and accounts for it to the position
    /// @param params The parameters for decreasing liquidity
    /// @return amount0 The amount of token0 accounted to the position's tokens owed
    /// @return amount1 The amount of token1 accounted to the position's tokens owed
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);

    /// @notice Collects up to a maximum amount of fees owed to a specific position
    /// @param params The parameters for collecting
    /// @return amount0 The amount of fees collected in token0
    /// @return amount1 The amount of fees collected in token1
    function collect(CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);
}
