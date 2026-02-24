// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, SwapDirection, CloseOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3PositionCloserV1} from "../interfaces/IUniswapV3PositionCloserV1.sol";
import {IMidcurveSwapRouter} from "../../swap-router/interfaces/IMidcurveSwapRouter.sol";
import {INonfungiblePositionManagerMinimal} from "../interfaces/INonfungiblePositionManagerMinimal.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ExecutionFacet
/// @notice Facet for executing close orders when trigger conditions are met
/// @dev Handles position closing, fee application, and optional post-close swaps via MidcurveSwapRouter
contract ExecutionFacet is Modifiers {
    using SafeERC20 for IERC20;

    // ========================================
    // CONSTANTS
    // ========================================

    uint16 internal constant MAX_FEE_BPS = 100; // 1% max fee
    bytes32 internal constant UNISWAP_V3_VENUE_ID = keccak256("UniswapV3");

    // ========================================
    // STRUCTS
    // ========================================

    /// @notice Context for close execution (avoids stack too deep)
    struct CloseContext {
        address token0;
        address token1;
        uint128 liquidity;
        uint256 amount0Out;
        uint256 amount1Out;
    }

    // ========================================
    // EVENTS
    // ========================================

    event OrderExecuted(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address payout,
        int24 executionTick,
        uint256 amount0Out,
        uint256 amount1Out
    );

    event FeeApplied(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address indexed feeRecipient,
        uint16 feeBps,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    event OrderCancelled(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address indexed owner
    );

    event SwapExecuted(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    // ========================================
    // EXECUTION
    // ========================================

    /// @notice Execute a close order when trigger condition is met
    /// @dev Only the registered operator can execute.
    ///      Withdrawal mins are computed off-chain to avoid sqrtPriceX96 race conditions.
    ///      Swap uses two-phase logic: guaranteed portion through Paraswap, surplus through position's own pool.
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode to execute
    /// @param withdrawParams Withdrawal slippage params (amount0Min, amount1Min) computed off-chain
    /// @param swapParams Two-phase swap parameters (required if swap was configured)
    /// @param feeParams Operator fee parameters
    function executeOrder(
        uint256 nftId,
        TriggerMode triggerMode,
        IUniswapV3PositionCloserV1.WithdrawParams calldata withdrawParams,
        IUniswapV3PositionCloserV1.SwapParams calldata swapParams,
        IUniswapV3PositionCloserV1.FeeParams calldata feeParams
    )
        external
        whenInitialized
        nonReentrant
        orderMustExist(nftId, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(nftId, triggerMode);
        CloseOrder storage order = s.orders[key];

        // 1) Validate status
        if (order.status != OrderStatus.ACTIVE) {
            revert WrongOrderStatus(OrderStatus.ACTIVE, order.status);
        }

        // 2) Validate operator
        if (msg.sender != order.operator) revert NotOperator();

        // 3) Check expiry
        if (order.validUntil != 0 && block.timestamp > order.validUntil) {
            revert OrderExpired(order.validUntil, block.timestamp);
        }

        // 4) Validate fee
        if (feeParams.feeBps > s.maxFeeBps) revert FeeBpsTooHigh(feeParams.feeBps, s.maxFeeBps);

        // 5) Check trigger condition (tick-based)
        (, int24 currentTick,,,,,) = IUniswapV3PoolMinimal(order.pool).slot0();
        if (!_triggerConditionMet(currentTick, order.triggerTick, triggerMode)) {
            revert TriggerConditionNotMet(currentTick, order.triggerTick, triggerMode);
        }

        // 6) Validate NFT ownership and approval
        _validateNftOwnershipAndApproval(s, order);

        // 7) Pull NFT from owner (atomic close)
        INonfungiblePositionManagerMinimal(s.positionManager).transferFrom(
            order.owner,
            address(this),
            nftId
        );

        // 8) Withdraw liquidity and collect tokens (off-chain computed mins)
        CloseContext memory ctx = _withdrawAndCollect(s, nftId, withdrawParams);

        // 9) Apply optional operator fee
        (uint256 payout0, uint256 payout1) = _applyFees(
            nftId, triggerMode, ctx, feeParams.feeRecipient, feeParams.feeBps
        );

        // 10) Execute optional two-phase swap if configured
        if (order.swapDirection != SwapDirection.NONE) {
            (payout0, payout1) = _executeSwap(
                s,
                nftId,
                triggerMode,
                order.swapDirection,
                order.pool,
                ctx.token0,
                ctx.token1,
                payout0,
                payout1,
                swapParams
            );
        }

        // 11) Payout remainder to configured address
        if (payout0 > 0) IERC20(ctx.token0).safeTransfer(order.payout, payout0);
        if (payout1 > 0) IERC20(ctx.token1).safeTransfer(order.payout, payout1);

        emit OrderExecuted(
            nftId,
            triggerMode,
            order.owner,
            order.payout,
            currentTick,
            ctx.amount0Out,
            ctx.amount1Out
        );

        // 12) Return empty NFT to owner
        INonfungiblePositionManagerMinimal(s.positionManager).transferFrom(
            address(this),
            order.owner,
            nftId
        );

        // 13) Cancel counterpart order on full close
        // Since we always decrease ALL liquidity, every execution is a full close.
        // The opposite trigger mode's order (if active) is now stale and must be cancelled.
        _cancelCounterpartOrder(s, nftId, triggerMode, order.owner);

        // 14) Clean up executed order storage (gas refund)
        // All reads from `order` are complete — safe to delete.
        delete s.orders[key];
        s.orderExists[nftId][triggerMode] = false;
    }

    // ========================================
    // INTERNAL FUNCTIONS
    // ========================================

    /// @dev Check if trigger condition is met based on trigger mode
    function _triggerConditionMet(
        int24 currentTick,
        int24 triggerTick,
        TriggerMode triggerMode
    ) internal pure returns (bool) {
        if (triggerMode == TriggerMode.LOWER) {
            // LOWER triggers when price falls: currentTick <= triggerTick
            return currentTick <= triggerTick;
        } else {
            // UPPER triggers when price rises: currentTick >= triggerTick
            return currentTick >= triggerTick;
        }
    }

    /// @dev Cancel the counterpart order (opposite triggerMode) if it exists and is ACTIVE.
    ///      Called after full position close to prevent stale orders.
    function _cancelCounterpartOrder(
        AppStorage storage s,
        uint256 nftId,
        TriggerMode executedTriggerMode,
        address owner
    ) internal {
        TriggerMode oppositeTriggerMode = executedTriggerMode == TriggerMode.LOWER
            ? TriggerMode.UPPER
            : TriggerMode.LOWER;

        if (!s.orderExists[nftId][oppositeTriggerMode]) return;

        bytes32 counterpartKey = LibAppStorage.orderKey(nftId, oppositeTriggerMode);
        CloseOrder storage counterpart = s.orders[counterpartKey];

        if (counterpart.status != OrderStatus.ACTIVE) return;

        emit OrderCancelled(nftId, oppositeTriggerMode, owner);

        // Delete counterpart from storage (gas refund)
        delete s.orders[counterpartKey];
        s.orderExists[nftId][oppositeTriggerMode] = false;
    }

    /// @dev Validate NFT ownership and approval
    function _validateNftOwnershipAndApproval(
        AppStorage storage s,
        CloseOrder storage order
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

    /// @dev Withdraw liquidity and collect tokens from position
    /// @notice Uses off-chain computed amount0Min/amount1Min to eliminate the sqrtPriceX96 race condition
    function _withdrawAndCollect(
        AppStorage storage s,
        uint256 nftId,
        IUniswapV3PositionCloserV1.WithdrawParams calldata withdrawParams
    ) internal returns (CloseContext memory ctx) {
        INonfungiblePositionManagerMinimal nftManager = INonfungiblePositionManagerMinimal(s.positionManager);

        // Read position data
        (
            ,
            ,
            address token0,
            address token1,
            ,
            ,
            ,
            uint128 liquidity,
            ,
            ,
            ,

        ) = nftManager.positions(nftId);

        ctx.token0 = token0;
        ctx.token1 = token1;
        ctx.liquidity = liquidity;

        // Decrease ALL liquidity using off-chain computed mins
        nftManager.decreaseLiquidity(
            INonfungiblePositionManagerMinimal.DecreaseLiquidityParams({
                tokenId: nftId,
                liquidity: liquidity,
                amount0Min: withdrawParams.amount0Min,
                amount1Min: withdrawParams.amount1Min,
                deadline: block.timestamp
            })
        );

        // Collect everything to this contract
        (ctx.amount0Out, ctx.amount1Out) = nftManager.collect(
            INonfungiblePositionManagerMinimal.CollectParams({
                tokenId: nftId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
    }

    /// @dev Apply operator fees and return remaining payout amounts
    function _applyFees(
        uint256 nftId,
        TriggerMode triggerMode,
        CloseContext memory ctx,
        address feeRecipient,
        uint16 feeBps
    ) internal returns (uint256 payout0, uint256 payout1) {
        payout0 = ctx.amount0Out;
        payout1 = ctx.amount1Out;

        if (feeRecipient != address(0) && feeBps > 0) {
            uint256 fee0 = (ctx.amount0Out * uint256(feeBps)) / 10_000;
            uint256 fee1 = (ctx.amount1Out * uint256(feeBps)) / 10_000;

            if (fee0 > 0) IERC20(ctx.token0).safeTransfer(feeRecipient, fee0);
            if (fee1 > 0) IERC20(ctx.token1).safeTransfer(feeRecipient, fee1);

            emit FeeApplied(nftId, triggerMode, feeRecipient, feeBps, fee0, fee1);

            payout0 = ctx.amount0Out - fee0;
            payout1 = ctx.amount1Out - fee1;
        }
    }

    /// @dev Execute two-phase post-close swap via MidcurveSwapRouter
    /// @notice Phase 1: guaranteed amount through Paraswap hops with minAmountOut protection.
    ///         Phase 2: surplus through the position's own pool (built on-chain, no minAmountOut).
    function _executeSwap(
        AppStorage storage s,
        uint256 nftId,
        TriggerMode triggerMode,
        SwapDirection direction,
        address pool,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        IUniswapV3PositionCloserV1.SwapParams calldata params
    ) internal returns (uint256 finalAmount0, uint256 finalAmount1) {
        // Determine tokenIn/tokenOut/amountIn from direction
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

        // Phase 1: Guaranteed swap (Paraswap route with slippage protection)
        if (params.guaranteedAmountIn > 0 && params.hops.length > 0) {
            if (amountIn < params.guaranteedAmountIn) {
                revert InsufficientAmountForGuaranteed(amountIn, params.guaranteedAmountIn);
            }

            uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));

            IERC20(tokenIn).forceApprove(s.swapRouter, params.guaranteedAmountIn);
            IMidcurveSwapRouter(s.swapRouter).sell(
                tokenIn,
                tokenOut,
                params.guaranteedAmountIn,
                params.minAmountOut,
                address(this),
                params.deadline,
                params.hops
            );
            IERC20(tokenIn).forceApprove(s.swapRouter, 0);

            uint256 phase1Out = IERC20(tokenOut).balanceOf(address(this)) - outBefore;
            emit SwapExecuted(nftId, triggerMode, tokenIn, tokenOut, params.guaranteedAmountIn, phase1Out);
        }

        // Phase 2: Surplus swap through position's own pool (built on-chain)
        uint256 surplus = amountIn - params.guaranteedAmountIn;
        if (surplus > 0) {
            IMidcurveSwapRouter.Hop[] memory surplusPath = new IMidcurveSwapRouter.Hop[](1);
            surplusPath[0] = IMidcurveSwapRouter.Hop({
                venueId: UNISWAP_V3_VENUE_ID,
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                venueData: abi.encode(IUniswapV3PoolMinimal(pool).fee())
            });

            uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));

            IERC20(tokenIn).forceApprove(s.swapRouter, surplus);
            IMidcurveSwapRouter(s.swapRouter).sell(
                tokenIn,
                tokenOut,
                surplus,
                0, // No minAmountOut for surplus (unpredictable amount)
                address(this),
                params.deadline,
                surplusPath
            );
            IERC20(tokenIn).forceApprove(s.swapRouter, 0);

            uint256 phase2Out = IERC20(tokenOut).balanceOf(address(this)) - outBefore;
            emit SwapExecuted(nftId, triggerMode, tokenIn, tokenOut, surplus, phase2Out);
        }

        // Compute final amounts from actual balances
        finalAmount0 = IERC20(token0).balanceOf(address(this));
        finalAmount1 = IERC20(token1).balanceOf(address(this));
    }
}
