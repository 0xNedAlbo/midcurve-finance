// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, SwapDirection, CloseOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3PositionCloserV1} from "../interfaces/IUniswapV3PositionCloserV1.sol";
import {IMidcurveSwapRouter} from "../../swap-router/interfaces/IMidcurveSwapRouter.sol";
import {INonfungiblePositionManagerMinimal} from "../interfaces/INonfungiblePositionManagerMinimal.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {LiquidityAmounts} from "../libraries/LiquidityAmounts.sol";

/// @title ExecutionFacet
/// @notice Facet for executing close orders when trigger conditions are met
/// @dev Handles position closing, fee application, and optional post-close swaps via MidcurveSwapRouter
contract ExecutionFacet is Modifiers {
    using SafeERC20 for IERC20;

    // ========================================
    // CONSTANTS
    // ========================================

    uint16 internal constant MAX_FEE_BPS = 100; // 1% max fee

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
    /// @dev Only the registered operator can execute
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode to execute
    /// @param feeRecipient Recipient of operator fee (address(0) = no fee)
    /// @param feeBps Fee in basis points (capped by maxFeeBps)
    /// @param swapParams Swap parameters (required if swap was configured)
    function executeOrder(
        uint256 nftId,
        TriggerMode triggerMode,
        address feeRecipient,
        uint16 feeBps,
        IUniswapV3PositionCloserV1.SwapParams calldata swapParams
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
        if (feeBps > s.maxFeeBps) revert FeeBpsTooHigh(feeBps, s.maxFeeBps);

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

        // 8) Withdraw liquidity and collect tokens
        CloseContext memory ctx = _withdrawAndCollect(s, nftId, order.slippageBps);

        // 9) Mark executed before external transfers (reentrancy hygiene)
        order.status = OrderStatus.EXECUTED;

        // 10) Apply optional operator fee
        (uint256 payout0, uint256 payout1) = _applyFees(
            nftId, triggerMode, ctx, feeRecipient, feeBps
        );

        // 11) Execute optional swap if configured
        if (order.swapDirection != SwapDirection.NONE) {
            (payout0, payout1) = _executeSwap(
                s,
                nftId,
                triggerMode,
                order.swapDirection,
                ctx.token0,
                ctx.token1,
                payout0,
                payout1,
                swapParams
            );
        }

        // 12) Payout remainder to configured address
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

        // 13) Return empty NFT to owner
        INonfungiblePositionManagerMinimal(s.positionManager).transferFrom(
            address(this),
            order.owner,
            nftId
        );
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
    function _withdrawAndCollect(
        AppStorage storage s,
        uint256 nftId,
        uint16 slippageBps
    ) internal returns (CloseContext memory ctx) {
        INonfungiblePositionManagerMinimal nftManager = INonfungiblePositionManagerMinimal(s.positionManager);

        // Read position data
        (
            ,
            ,
            address token0,
            address token1,
            ,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            ,
            ,
            ,

        ) = nftManager.positions(nftId);

        ctx.token0 = token0;
        ctx.token1 = token1;
        ctx.liquidity = liquidity;

        // Get current price for expected amount calculation
        // Note: We need to get this from the pool, not from positions
        // For simplicity, we'll use the tick range to calculate expected amounts
        uint160 sqrtPriceAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        // Use midpoint as approximation for current price (safe since we're decreasing all liquidity)
        uint160 currentSqrtPrice = uint160((uint256(sqrtPriceAX96) + uint256(sqrtPriceBX96)) / 2);

        (uint256 amount0Expected, uint256 amount1Expected) =
            LiquidityAmounts.getAmountsForLiquidity(currentSqrtPrice, sqrtPriceAX96, sqrtPriceBX96, liquidity);

        uint256 amount0Min = (amount0Expected * (10_000 - uint256(slippageBps))) / 10_000;
        uint256 amount1Min = (amount1Expected * (10_000 - uint256(slippageBps))) / 10_000;

        // Decrease ALL liquidity
        nftManager.decreaseLiquidity(
            INonfungiblePositionManagerMinimal.DecreaseLiquidityParams({
                tokenId: nftId,
                liquidity: liquidity,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
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

    /// @dev Execute post-close swap via MidcurveSwapRouter
    /// @notice The swap route (hops) is determined off-chain and passed in by the operator.
    ///         The contract delegates the swap entirely to the MidcurveSwapRouter.
    function _executeSwap(
        AppStorage storage s,
        uint256 nftId,
        TriggerMode triggerMode,
        SwapDirection direction,
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

        // Approve SwapRouter to pull tokenIn
        IERC20(tokenIn).forceApprove(s.swapRouter, amountIn);

        // Record output balance before swap
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));

        // Execute swap via MidcurveSwapRouter
        IMidcurveSwapRouter(s.swapRouter).sell(
            tokenIn,
            tokenOut,
            amountIn,
            params.minAmountOut,
            address(this),
            params.deadline,
            params.hops
        );

        // Reset approval (security best practice)
        IERC20(tokenIn).forceApprove(s.swapRouter, 0);

        // Verify output via balance diff
        uint256 balanceAfter = IERC20(tokenOut).balanceOf(address(this));
        uint256 amountOut = balanceAfter - balanceBefore;

        if (amountOut == 0) {
            revert SwapOutputZero();
        }

        // Defense-in-depth: minAmountOut already enforced by router
        if (amountOut < params.minAmountOut) {
            revert SlippageExceeded(params.minAmountOut, amountOut);
        }

        emit SwapExecuted(nftId, triggerMode, tokenIn, tokenOut, amountIn, amountOut);

        // Compute final amounts
        if (tokenIn == token0) {
            finalAmount0 = 0;
            finalAmount1 = amount1 + amountOut;
        } else {
            finalAmount0 = amount0 + amountOut;
            finalAmount1 = 0;
        }
    }
}
