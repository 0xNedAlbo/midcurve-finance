// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, CollectOrderStatus, SwapDirection, CollectOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3FeeCollectorV1} from "../interfaces/IUniswapV3FeeCollectorV1.sol";
import {IMidcurveSwapRouter} from "../../swap-router/interfaces/IMidcurveSwapRouter.sol";
import {INonfungiblePositionManagerMinimal} from "../../position-closer/interfaces/INonfungiblePositionManagerMinimal.sol";
import {IUniswapV3PoolMinimal} from "../../position-closer/interfaces/IUniswapV3PoolMinimal.sol";
import {LibSqrtPrice} from "../../libraries/LibSqrtPrice.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CollectExecutionFacet
/// @notice Facet for executing fee collection when minimum threshold is met
/// @dev Handles fee collection, minimum check via spot price, optional swap, and payout.
///      Orders remain ACTIVE after execution (recurring).
contract CollectExecutionFacet is Modifiers {
    using SafeERC20 for IERC20;

    // ========================================
    // STRUCTS
    // ========================================

    /// @notice Context for collect execution (avoids stack too deep)
    struct CollectContext {
        address token0;
        address token1;
        uint256 amount0;
        uint256 amount1;
    }

    // ========================================
    // EVENTS
    // ========================================

    event CollectExecuted(
        uint256 indexed nftId,
        address indexed payout,
        uint256 amount0Out,
        uint256 amount1Out
    );

    event CollectFeeApplied(
        uint256 indexed nftId,
        address indexed feeRecipient,
        uint16 feeBps,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    event CollectSwapExecuted(
        uint256 indexed nftId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    // ========================================
    // EXECUTION
    // ========================================

    /// @notice Execute fee collection for a position
    /// @dev Only the registered operator can execute.
    ///      Order remains ACTIVE after execution (recurring).
    function executeCollect(
        uint256 nftId,
        IUniswapV3FeeCollectorV1.CollectSwapParams calldata swapParams,
        IUniswapV3FeeCollectorV1.CollectFeeParams calldata feeParams
    )
        external
        whenInitialized
        nonReentrant
        orderMustExist(nftId)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        CollectOrder storage order = s.orders[nftId];

        // 1) Validate status
        if (order.status != CollectOrderStatus.ACTIVE) {
            revert WrongOrderStatus(CollectOrderStatus.ACTIVE, order.status);
        }

        // 2) Validate operator
        if (msg.sender != order.operator) revert NotOperator();

        // 3) Validate NFT still owned by recorded owner and approved
        _validateNftOwnershipAndApproval(s, order);

        // 4) Check expiry
        if (order.validUntil != 0 && block.timestamp > order.validUntil) {
            revert OrderExpired(order.validUntil, block.timestamp);
        }

        // 5) Validate fee
        if (feeParams.feeBps > s.maxFeeBps) revert FeeBpsTooHigh(feeParams.feeBps, s.maxFeeBps);

        // 6) Collect fees from position manager
        CollectContext memory ctx = _collectFees(s, nftId);

        // Ensure something was collected
        if (ctx.amount0 == 0 && ctx.amount1 == 0) revert NoFeesCollected();

        // 7) On-chain minimum check using pool spot price
        _checkMinimumFeeValue(order, ctx);

        // 8) Apply operator fee on both tokens before swap
        (uint256 payout0, uint256 payout1) = _applyFees(
            nftId, ctx, feeParams.feeRecipient, feeParams.feeBps
        );

        // 9) Execute optional swap if configured
        if (order.swapDirection != SwapDirection.NONE) {
            (payout0, payout1) = _executeSwap(
                s,
                nftId,
                order.swapDirection,
                order.pool,
                ctx.token0,
                ctx.token1,
                payout0,
                payout1,
                swapParams
            );
        }

        // 10) Transfer resulting tokens to payout address
        if (payout0 > 0) IERC20(ctx.token0).safeTransfer(order.payout, payout0);
        if (payout1 > 0) IERC20(ctx.token1).safeTransfer(order.payout, payout1);

        // 11) Order stays ACTIVE (no deletion — recurring)
        emit CollectExecuted(nftId, order.payout, payout0, payout1);
    }

    // ========================================
    // INTERNAL FUNCTIONS
    // ========================================

    /// @dev Validate NFT ownership and approval
    function _validateNftOwnershipAndApproval(
        AppStorage storage s,
        CollectOrder storage order
    ) internal view {
        INonfungiblePositionManagerMinimal nftManager = INonfungiblePositionManagerMinimal(s.positionManager);
        address actualOwner = nftManager.ownerOf(order.nftId);

        if (actualOwner != order.owner) {
            revert NftNotOwnedByRecordedOwner(order.owner, actualOwner);
        }

        bool approved = (nftManager.getApproved(order.nftId) == address(this))
            || nftManager.isApprovedForAll(order.owner, address(this));
        if (!approved) {
            revert NftNotApproved(order.owner, order.nftId);
        }
    }

    /// @dev Collect all accrued fees from the position
    function _collectFees(
        AppStorage storage s,
        uint256 nftId
    ) internal returns (CollectContext memory ctx) {
        INonfungiblePositionManagerMinimal nftManager = INonfungiblePositionManagerMinimal(s.positionManager);

        // Read position tokens
        (, , address token0, address token1, , , , , , , ,) = nftManager.positions(nftId);
        ctx.token0 = token0;
        ctx.token1 = token1;

        // Collect all fees to this contract
        (ctx.amount0, ctx.amount1) = nftManager.collect(
            INonfungiblePositionManagerMinimal.CollectParams({
                tokenId: nftId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
    }

    /// @dev Check that collected fees meet the minimum threshold using pool spot price
    function _checkMinimumFeeValue(
        CollectOrder storage order,
        CollectContext memory ctx
    ) internal view {
        if (order.minFeeValue == 0) return;

        (uint160 sqrtPriceX96, , , , , ,) = IUniswapV3PoolMinimal(order.pool).slot0();

        uint256 totalInMinFeeToken;
        if (order.minFeeToken == ctx.token0) {
            // Convert token1 fees to token0 units and add token0 fees
            uint256 amount1AsToken0 = LibSqrtPrice.convertToken1ToToken0(ctx.amount1, sqrtPriceX96);
            totalInMinFeeToken = ctx.amount0 + amount1AsToken0;
        } else {
            // Convert token0 fees to token1 units and add token1 fees
            uint256 amount0AsToken1 = LibSqrtPrice.convertToken0ToToken1(ctx.amount0, sqrtPriceX96);
            totalInMinFeeToken = ctx.amount1 + amount0AsToken1;
        }

        if (totalInMinFeeToken < order.minFeeValue) {
            revert FeeBelowMinimum(totalInMinFeeToken, order.minFeeValue);
        }
    }

    /// @dev Apply operator fees and return remaining payout amounts
    function _applyFees(
        uint256 nftId,
        CollectContext memory ctx,
        address feeRecipient,
        uint16 feeBps
    ) internal returns (uint256 payout0, uint256 payout1) {
        payout0 = ctx.amount0;
        payout1 = ctx.amount1;

        if (feeRecipient != address(0) && feeBps > 0) {
            uint256 fee0 = (ctx.amount0 * uint256(feeBps)) / 10_000;
            uint256 fee1 = (ctx.amount1 * uint256(feeBps)) / 10_000;

            if (fee0 > 0) IERC20(ctx.token0).safeTransfer(feeRecipient, fee0);
            if (fee1 > 0) IERC20(ctx.token1).safeTransfer(feeRecipient, fee1);

            emit CollectFeeApplied(nftId, feeRecipient, feeBps, fee0, fee1);

            payout0 = ctx.amount0 - fee0;
            payout1 = ctx.amount1 - fee1;
        }
    }

    /// @dev Execute post-collect swap via MidcurveSwapRouter
    function _executeSwap(
        AppStorage storage s,
        uint256 nftId,
        SwapDirection direction,
        address,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        IUniswapV3FeeCollectorV1.CollectSwapParams calldata params
    ) internal returns (uint256 finalAmount0, uint256 finalAmount1) {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        if (direction == SwapDirection.TOKEN0_TO_1) {
            tokenIn = token0;
            tokenOut = token1;
            amountIn = amount0;
        } else {
            tokenIn = token1;
            tokenOut = token0;
            amountIn = amount1;
        }

        // Nothing to swap if amountIn is 0
        if (amountIn == 0) {
            return (amount0, amount1);
        }

        uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));

        IERC20(tokenIn).forceApprove(s.swapRouter, amountIn);
        IMidcurveSwapRouter(s.swapRouter).sell(
            tokenIn,
            tokenOut,
            amountIn,
            params.minAmountOut,
            address(this),
            params.deadline,
            params.hops
        );
        IERC20(tokenIn).forceApprove(s.swapRouter, 0);

        uint256 swapOut = IERC20(tokenOut).balanceOf(address(this)) - outBefore;
        emit CollectSwapExecuted(nftId, tokenIn, tokenOut, amountIn, swapOut);

        // Compute final amounts from actual balances
        finalAmount0 = IERC20(token0).balanceOf(address(this));
        finalAmount1 = IERC20(token1).balanceOf(address(this));
    }
}
