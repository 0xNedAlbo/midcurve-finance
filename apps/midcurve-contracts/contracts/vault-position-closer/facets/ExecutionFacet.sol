// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, SwapDirection, VaultCloseOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3VaultPositionCloserV1} from "../interfaces/IUniswapV3VaultPositionCloserV1.sol";
import {IUniswapV3VaultMinimal} from "../interfaces/IUniswapV3VaultMinimal.sol";
import {IMidcurveSwapRouter} from "../../swap-router/interfaces/IMidcurveSwapRouter.sol";
import {IUniswapV3PoolMinimal} from "../../position-closer/interfaces/IUniswapV3PoolMinimal.sol";
import {BurnParams} from "../../vault/interfaces/IMultiTokenVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ExecutionFacet
/// @notice Facet for executing vault close orders when trigger conditions are met
/// @dev Handles share burning, fee application, and optional post-close swaps via MidcurveSwapRouter
contract ExecutionFacet is Modifiers {
    using SafeERC20 for IERC20;

    // ========================================
    // CONSTANTS
    // ========================================

    bytes32 internal constant UNISWAP_V3_VENUE_ID = keccak256("UniswapV3");

    // ========================================
    // STRUCTS
    // ========================================

    /// @notice Context for close execution (avoids stack too deep)
    struct CloseContext {
        address token0;
        address token1;
        uint256 sharesToClose;
        uint256 preBalance;
        uint256 amount0Out;
        uint256 amount1Out;
    }

    // ========================================
    // EVENTS
    // ========================================

    event OrderExecuted(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address payout,
        int24 executionTick,
        uint256 sharesClosed,
        uint256 amount0Out,
        uint256 amount1Out
    );

    event FeeApplied(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed feeRecipient,
        uint16 feeBps,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    event OrderCancelled(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner
    );

    event SwapExecuted(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    // ========================================
    // EXECUTION
    // ========================================

    /// @notice Execute a vault close order when trigger condition is met
    /// @dev Only the registered operator can execute.
    ///      Withdrawal mins are computed off-chain to avoid sqrtPriceX96 race conditions.
    ///      Swap uses two-phase logic: guaranteed portion through hops, surplus through position's own pool.
    /// @param vault The vault address
    /// @param owner The share holder whose order to execute
    /// @param triggerMode The trigger mode to execute
    /// @param withdrawParams Withdrawal slippage params computed off-chain
    /// @param swapParams Two-phase swap parameters (required if swap was configured)
    /// @param feeParams Operator fee parameters
    function executeOrder(
        address vault,
        address owner,
        TriggerMode triggerMode,
        IUniswapV3VaultPositionCloserV1.WithdrawParams calldata withdrawParams,
        IUniswapV3VaultPositionCloserV1.SwapParams calldata swapParams,
        IUniswapV3VaultPositionCloserV1.FeeParams calldata feeParams
    )
        external
        whenInitialized
        nonReentrant
        orderMustExist(vault, owner, triggerMode)
    {
        AppStorage storage s = LibAppStorage.appStorage();
        bytes32 key = LibAppStorage.orderKey(vault, owner, triggerMode);
        VaultCloseOrder storage order = s.orders[key];

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

        // 6) Determine share amount and snapshot pre-balance
        IUniswapV3VaultMinimal vaultContract = IUniswapV3VaultMinimal(vault);
        CloseContext memory ctx;
        ctx.preBalance = vaultContract.balanceOf(owner);
        ctx.sharesToClose = order.shares == 0 ? ctx.preBalance : order.shares;

        if (ctx.sharesToClose == 0) revert ZeroShares();

        // 7) Validate balance and allowance
        if (ctx.preBalance < ctx.sharesToClose) {
            revert InsufficientShares(owner, ctx.sharesToClose, ctx.preBalance);
        }
        uint256 allowance = vaultContract.allowance(owner, address(this));
        if (allowance < ctx.sharesToClose) {
            revert InsufficientAllowance(owner, ctx.sharesToClose, allowance);
        }

        // 8) Pull shares from owner (ERC-20 transfer)
        bool transferred = vaultContract.transferFrom(owner, address(this), ctx.sharesToClose);
        if (!transferred) revert TransferFailed();

        // 9) Burn shares via vault — closer is now the share holder
        ctx.token0 = vaultContract.token0();
        ctx.token1 = vaultContract.token1();

        uint256[] memory minAmounts = new uint256[](2);
        minAmounts[0] = withdrawParams.amount0Min;
        minAmounts[1] = withdrawParams.amount1Min;

        uint256[] memory tokenAmounts = vaultContract.burn(
            ctx.sharesToClose,
            BurnParams({
                minAmounts: minAmounts,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        ctx.amount0Out = tokenAmounts[0];
        ctx.amount1Out = tokenAmounts[1];

        // 10) Apply optional operator fee
        (uint256 payout0, uint256 payout1) = _applyFees(
            vault, triggerMode, ctx, feeParams.feeRecipient, feeParams.feeBps
        );

        // 11) Execute optional two-phase swap if configured
        if (order.swapDirection != SwapDirection.NONE) {
            (payout0, payout1) = _executeSwap(
                s,
                vault,
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

        // 12) Payout remainder to configured address
        if (payout0 > 0) IERC20(ctx.token0).safeTransfer(order.payout, payout0);
        if (payout1 > 0) IERC20(ctx.token1).safeTransfer(order.payout, payout1);

        emit OrderExecuted(
            vault,
            triggerMode,
            owner,
            order.payout,
            currentTick,
            ctx.sharesToClose,
            ctx.amount0Out,
            ctx.amount1Out
        );

        // 13) Cancel counterpart order on full close
        bool isFullClose = ctx.sharesToClose == ctx.preBalance;
        if (isFullClose) {
            _cancelCounterpartOrder(s, vault, owner, triggerMode);
        }

        // 14) Clean up executed order storage (gas refund)
        delete s.orders[key];
        s.orderExists[vault][owner][triggerMode] = false;
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
            return currentTick <= triggerTick;
        } else {
            return currentTick >= triggerTick;
        }
    }

    /// @dev Cancel the counterpart order (opposite triggerMode) if it exists and is ACTIVE.
    function _cancelCounterpartOrder(
        AppStorage storage s,
        address vault,
        address owner,
        TriggerMode executedTriggerMode
    ) internal {
        TriggerMode oppositeTriggerMode = executedTriggerMode == TriggerMode.LOWER
            ? TriggerMode.UPPER
            : TriggerMode.LOWER;

        if (!s.orderExists[vault][owner][oppositeTriggerMode]) return;

        bytes32 counterpartKey = LibAppStorage.orderKey(vault, owner, oppositeTriggerMode);
        VaultCloseOrder storage counterpart = s.orders[counterpartKey];

        if (counterpart.status != OrderStatus.ACTIVE) return;

        emit OrderCancelled(vault, oppositeTriggerMode, owner);

        delete s.orders[counterpartKey];
        s.orderExists[vault][owner][oppositeTriggerMode] = false;
    }

    /// @dev Apply operator fees and return remaining payout amounts
    function _applyFees(
        address vault,
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

            emit FeeApplied(vault, triggerMode, feeRecipient, feeBps, fee0, fee1);

            payout0 = ctx.amount0Out - fee0;
            payout1 = ctx.amount1Out - fee1;
        }
    }

    /// @dev Execute two-phase post-close swap via MidcurveSwapRouter
    function _executeSwap(
        AppStorage storage s,
        address vault,
        TriggerMode triggerMode,
        SwapDirection direction,
        address pool,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        IUniswapV3VaultPositionCloserV1.SwapParams calldata params
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

        if (amountIn == 0) {
            return (amount0, amount1);
        }

        // Phase 1: Guaranteed swap (route with slippage protection)
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
            emit SwapExecuted(vault, triggerMode, tokenIn, tokenOut, params.guaranteedAmountIn, phase1Out);
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
            emit SwapExecuted(vault, triggerMode, tokenIn, tokenOut, surplus, phase2Out);
        }

        // Compute final amounts from actual balances
        finalAmount0 = IERC20(token0).balanceOf(address(this));
        finalAmount1 = IERC20(token1).balanceOf(address(this));
    }
}
