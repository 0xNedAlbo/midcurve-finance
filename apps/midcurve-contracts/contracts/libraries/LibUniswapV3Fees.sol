// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";

/// @title LibUniswapV3Fees
/// @notice Compute uncollected fees for a Uniswap V3 position, including BOTH
///         the already-snapshotted component (`tokensOwed0/1` from NFPM) AND
///         the not-yet-snapshotted component derived from current pool
///         `feeGrowthInside` against the position's last checkpoint.
/// @dev    NFPM only updates `feeGrowthInside*LastX128` and `tokensOwed*` when
///         someone calls `mint`/`increaseLiquidity`/`decreaseLiquidity`/`collect`
///         on the position. Between those calls — which can be the entire active
///         life of an unattended NFT — accrued fees live exclusively in the pool.
///         Any fee-aware view function MUST reproduce the pool's inside-fee math
///         to read those fees off-chain.
library LibUniswapV3Fees {
    uint256 internal constant Q128 = 1 << 128;

    /// @notice Total uncollected fees for a UV3 position.
    /// @param pool                       Pool address (IUniswapV3Pool)
    /// @param tickLower                  Lower tick bound of the position
    /// @param tickUpper                  Upper tick bound of the position
    /// @param liquidity                  Current position liquidity (from NFPM.positions())
    /// @param feeGrowthInside0LastX128   Position's last fee-growth checkpoint, token0
    /// @param feeGrowthInside1LastX128   Position's last fee-growth checkpoint, token1
    /// @param tokensOwed0                NFPM's snapshotted owed token0
    /// @param tokensOwed1                NFPM's snapshotted owed token1
    /// @return fees0                     Uncollected fees in token0
    /// @return fees1                     Uncollected fees in token1
    function uncollectedFees(
        address pool,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    ) internal view returns (uint256 fees0, uint256 fees1) {
        fees0 = uint256(tokensOwed0);
        fees1 = uint256(tokensOwed1);

        if (liquidity == 0) {
            return (fees0, fees1);
        }

        IUniswapV3PoolMinimal p = IUniswapV3PoolMinimal(pool);

        (, int24 currentTick,,,,,) = p.slot0();

        uint256 feeGrowthGlobal0 = p.feeGrowthGlobal0X128();
        uint256 feeGrowthGlobal1 = p.feeGrowthGlobal1X128();

        (,, uint256 fgOutsideLower0, uint256 fgOutsideLower1,,,,) = p.ticks(tickLower);
        (,, uint256 fgOutsideUpper0, uint256 fgOutsideUpper1,,,,) = p.ticks(tickUpper);

        unchecked {
            uint256 below0 =
                currentTick >= tickLower ? fgOutsideLower0 : feeGrowthGlobal0 - fgOutsideLower0;
            uint256 below1 =
                currentTick >= tickLower ? fgOutsideLower1 : feeGrowthGlobal1 - fgOutsideLower1;

            uint256 above0 =
                currentTick < tickUpper ? fgOutsideUpper0 : feeGrowthGlobal0 - fgOutsideUpper0;
            uint256 above1 =
                currentTick < tickUpper ? fgOutsideUpper1 : feeGrowthGlobal1 - fgOutsideUpper1;

            uint256 inside0 = feeGrowthGlobal0 - below0 - above0;
            uint256 inside1 = feeGrowthGlobal1 - below1 - above1;

            // Component: (inside - inside_last) * L / Q128 — wraps in uint256 to
            // mirror how the pool itself counts fee growth.
            fees0 += (inside0 - feeGrowthInside0LastX128) * uint256(liquidity) / Q128;
            fees1 += (inside1 - feeGrowthInside1LastX128) * uint256(liquidity) / Q128;
        }
    }
}
