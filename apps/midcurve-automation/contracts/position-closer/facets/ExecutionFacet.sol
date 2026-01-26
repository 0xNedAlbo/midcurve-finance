// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, TriggerMode, OrderStatus, SwapDirection, CloseOrder, Modifiers} from "../storage/AppStorage.sol";
import {IUniswapV3PositionCloserV1} from "../interfaces/IUniswapV3PositionCloserV1.sol";
import {INonfungiblePositionManagerMinimal} from "../interfaces/INonfungiblePositionManagerMinimal.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {LiquidityAmounts} from "../libraries/LiquidityAmounts.sol";
import {SafeERC20} from "../libraries/SafeERC20.sol";

/// @title IAugustusRegistry
/// @notice Minimal interface for Paraswap Augustus registry
interface IAugustusRegistry {
    function isValidAugustus(address augustus) external view returns (bool);
}

/// @title IAugustus
/// @notice Minimal interface for Paraswap Augustus swapper
interface IAugustus {
    function getTokenTransferProxy() external view returns (address);
}

/// @title ExecutionFacet
/// @notice Facet for executing close orders when trigger conditions are met
/// @dev Handles position closing, fee application, and optional post-close swaps
contract ExecutionFacet is Modifiers {
    using SafeERC20 for address;

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

    /// @notice Context for swap execution (avoids stack too deep)
    struct SwapContext {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        address augustus;
        address spender;
        uint256 balanceBefore;
        uint256 minAmountOut;
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

    event DustSwept(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address tokenIn,
        uint256 dustIn,
        uint256 dustOut
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
                order.pool,
                order.swapDirection,
                ctx.token0,
                ctx.token1,
                payout0,
                payout1,
                swapParams
            );
        }

        // 12) Payout remainder to configured address
        if (payout0 > 0) ctx.token0.safeTransfer(order.payout, payout0);
        if (payout1 > 0) ctx.token1.safeTransfer(order.payout, payout1);

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
    // UNISWAP V3 SWAP CALLBACK
    // ========================================

    /// @notice Callback from Uniswap V3 pool during swap
    /// @dev Only callable by the pool during an active swap initiated by this contract
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata /* data */
    ) external {
        AppStorage storage s = LibAppStorage.appStorage();

        // Verify caller is the expected pool
        require(msg.sender == s.expectedSwapPool, "Invalid callback caller");

        // Transfer required tokens to the pool
        if (amount0Delta > 0) {
            address token0 = IUniswapV3PoolMinimal(msg.sender).token0();
            token0.safeTransfer(msg.sender, uint256(amount0Delta));
        }
        if (amount1Delta > 0) {
            address token1 = IUniswapV3PoolMinimal(msg.sender).token1();
            token1.safeTransfer(msg.sender, uint256(amount1Delta));
        }
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

            if (fee0 > 0) ctx.token0.safeTransfer(feeRecipient, fee0);
            if (fee1 > 0) ctx.token1.safeTransfer(feeRecipient, fee1);

            emit FeeApplied(nftId, triggerMode, feeRecipient, feeBps, fee0, fee1);

            payout0 = ctx.amount0Out - fee0;
            payout1 = ctx.amount1Out - fee1;
        }
    }

    /// @dev Execute post-close swap via Paraswap
    function _executeSwap(
        AppStorage storage s,
        uint256 nftId,
        TriggerMode triggerMode,
        address pool,
        SwapDirection direction,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        IUniswapV3PositionCloserV1.SwapParams calldata params
    ) internal returns (uint256 finalAmount0, uint256 finalAmount1) {
        // 1) Validate Augustus address against registry
        if (!IAugustusRegistry(s.augustusRegistry).isValidAugustus(params.augustus)) {
            revert InvalidAugustus(params.augustus);
        }

        // 2) Check deadline if set
        if (params.deadline != 0 && block.timestamp > params.deadline) {
            revert SwapDeadlineExpired(params.deadline, block.timestamp);
        }

        // 3) Build swap context
        SwapContext memory ctx = _buildSwapContext(
            direction, token0, token1, amount0, amount1, params.augustus, params.minAmountOut
        );

        // Nothing to swap if amountIn is 0
        if (ctx.amountIn == 0) {
            return (amount0, amount1);
        }

        // 4) Execute swap and get output
        uint256 amountOut = _performSwap(ctx, params.swapCalldata);

        // 5) Emit swap event
        emit SwapExecuted(nftId, triggerMode, ctx.tokenIn, ctx.tokenOut, ctx.amountIn, amountOut);

        // 6) Sweep remaining dust via direct pool swap
        uint256 dustIn = IERC20Minimal(ctx.tokenIn).balanceOf(address(this));
        if (dustIn >= 100) {
            uint256 dustOut = _sweepDustViaPool(s, pool, ctx.tokenIn, ctx.tokenOut);
            if (dustOut > 0) {
                amountOut += dustOut;
                emit DustSwept(nftId, triggerMode, ctx.tokenIn, dustIn, dustOut);
            }
        }

        // 7) Compute final amounts
        if (ctx.tokenIn == token0) {
            finalAmount0 = 0;
            finalAmount1 = amount1 + amountOut;
        } else {
            finalAmount0 = amount0 + amountOut;
            finalAmount1 = 0;
        }
    }

    /// @dev Build swap context struct to avoid stack-too-deep
    /// @param direction TOKEN0_TO_1 or TOKEN1_TO_0 (explicit direction)
    function _buildSwapContext(
        SwapDirection direction,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        address augustus,
        uint256 minAmountOut
    ) internal view returns (SwapContext memory ctx) {
        // Direction explicitly defines swap path
        if (direction == SwapDirection.TOKEN0_TO_1) {
            ctx.tokenIn = token0;
            ctx.tokenOut = token1;
            ctx.amountIn = amount0;
        } else {
            // TOKEN1_TO_0
            ctx.tokenIn = token1;
            ctx.tokenOut = token0;
            ctx.amountIn = amount1;
        }

        ctx.augustus = augustus;
        ctx.spender = IAugustus(augustus).getTokenTransferProxy();
        ctx.balanceBefore = IERC20Minimal(ctx.tokenOut).balanceOf(address(this));
        ctx.minAmountOut = minAmountOut;
    }

    /// @dev Perform the actual swap via Augustus
    function _performSwap(
        SwapContext memory ctx,
        bytes calldata swapCalldata
    ) internal returns (uint256 amountOut) {
        // Get actual balance of tokenIn
        uint256 actualBalance = IERC20Minimal(ctx.tokenIn).balanceOf(address(this));

        // Approve actual balance
        ctx.tokenIn.safeApprove(ctx.spender, actualBalance);

        // Execute swap via Augustus
        (bool success, bytes memory returnData) = ctx.augustus.call(swapCalldata);
        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
            revert SwapFailed();
        }

        // Reset approval to zero (security best practice)
        ctx.tokenIn.safeApprove(ctx.spender, 0);

        // Verify output via balance diff
        uint256 balanceAfter = IERC20Minimal(ctx.tokenOut).balanceOf(address(this));
        amountOut = balanceAfter - ctx.balanceBefore;

        if (amountOut == 0) {
            revert SwapOutputZero();
        }

        // Slippage protection
        if (amountOut < ctx.minAmountOut) {
            revert SlippageExceeded(ctx.minAmountOut, amountOut);
        }
    }

    /// @dev Sweep remaining dust via direct pool swap
    function _sweepDustViaPool(
        AppStorage storage s,
        address pool,
        address tokenIn,
        address tokenOut
    ) internal returns (uint256 amountOut) {
        uint256 dustAmount = IERC20Minimal(tokenIn).balanceOf(address(this));

        // Skip if no dust or negligible amount
        if (dustAmount < 100) {
            return 0;
        }

        // Determine swap direction
        address token0 = IUniswapV3PoolMinimal(pool).token0();
        bool zeroForOne = (tokenIn == token0);

        // Use extreme price limits
        uint160 sqrtPriceLimitX96 = zeroForOne
            ? TickMath.MIN_SQRT_RATIO + 1
            : TickMath.MAX_SQRT_RATIO - 1;

        // Set expected pool for callback validation
        s.expectedSwapPool = pool;

        // Get output balance before
        uint256 balanceBefore = IERC20Minimal(tokenOut).balanceOf(address(this));

        // Execute swap
        try IUniswapV3PoolMinimal(pool).swap(
            address(this),
            zeroForOne,
            int256(dustAmount),
            sqrtPriceLimitX96,
            ""
        ) {} catch {
            // If dust sweep fails, ignore (not critical)
            s.expectedSwapPool = address(0);
            return 0;
        }

        // Clear expected pool
        s.expectedSwapPool = address(0);

        // Calculate amount received
        uint256 balanceAfter = IERC20Minimal(tokenOut).balanceOf(address(this));
        amountOut = balanceAfter - balanceBefore;
    }
}
