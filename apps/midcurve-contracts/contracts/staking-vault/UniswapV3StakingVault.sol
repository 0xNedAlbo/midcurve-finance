// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {INonfungiblePositionManagerMinimal} from
    "../interfaces/INonfungiblePositionManagerMinimal.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {LiquidityAmounts} from "../libraries/LiquidityAmounts.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {LibUniswapV3Fees} from "../libraries/LibUniswapV3Fees.sol";

import {
    IStakingVault,
    StakeParams,
    TopUpParams,
    SwapStatus,
    SwapQuote
} from "./interfaces/IStakingVault.sol";
import {IFlashCloseCallback} from "./interfaces/IFlashCloseCallback.sol";

/// @title UniswapV3StakingVault
/// @notice Per-stake vault wrapping a single Uniswap V3 NFT position with a quote-side
///         yield target. Deployed as an EIP-1167 clone via UniswapV3StakingVaultFactory.
/// @dev Implements SPEC-0003a (issue #61). Non-transferable owner; multi-cycle lifecycle
///      with top-up, partial unstake, and fractional flashClose.
contract UniswapV3StakingVault is IStakingVault, ReentrancyGuard, Multicall {
    using SafeERC20 for IERC20;

    enum State {
        Empty,
        Staked,
        FlashCloseInProgress,
        Settled
    }

    uint16 internal constant BPS_DENOM = 10000;

    // ============ Implementation immutables (baked into runtime code) ============

    INonfungiblePositionManagerMinimal public immutable positionManager;

    // ============ Clone-initialized storage ============

    address public owner;

    // Position details cached during initial stake().
    address public pool;
    uint256 public tokenId;
    address public token0;
    address public token1;
    int24 internal _tickLower;
    int24 internal _tickUpper;

    // Stake terms.
    bool public isToken0Quote;
    uint256 public stakedBase;
    uint256 public stakedQuote;
    uint256 public yieldTarget;

    // Partial unstake counter.
    uint16 internal _pendingBps;

    // Lifecycle state.
    State internal _state;

    // Settlement buffers — refilled on each swap()/flashClose(), drained on each
    // unstake()/claimRewards(). All four reset to zero on drain.
    uint256 public unstakeBufferBase;
    uint256 public unstakeBufferQuote;
    uint256 public rewardBufferBase;
    uint256 public rewardBufferQuote;

    // One-shot init guard.
    bool internal _initialized;

    // ============ Errors ============

    error AlreadyInitialized();
    error NotOwner();
    error WrongState();
    error Underwater();
    error YieldTargetOverflow();
    error TokenMismatch();
    error InsufficientAmountIn();
    error SlippageExceeded();
    error InvalidBps();
    error NothingToUnstake();
    error NothingToClaim();
    error InsufficientBaseReturned();
    error InsufficientQuoteReturned();
    error PoolResolutionFailed();
    error ZeroOwner();

    // ============ Constructor ============

    constructor(address positionManager_) {
        positionManager = INonfungiblePositionManagerMinimal(positionManager_);
    }

    // ============ Initialization ============

    /// @inheritdoc IStakingVault
    function initialize(address ownerArg) external override {
        if (_initialized) revert AlreadyInitialized();
        if (ownerArg == address(0)) revert ZeroOwner();
        _initialized = true;
        owner = ownerArg;
        // _state defaults to Empty (enum value 0).
    }

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier inState(State expected) {
        if (_state != expected) revert WrongState();
        _;
    }

    // ============ Views ============

    /// @notice Current lifecycle state.
    function state() external view returns (State) {
        return _state;
    }

    function tickLower() external view returns (int24) {
        return _tickLower;
    }

    function tickUpper() external view returns (int24) {
        return _tickUpper;
    }

    function baseToken() public view returns (address) {
        return isToken0Quote ? token1 : token0;
    }

    function quoteToken() public view returns (address) {
        return isToken0Quote ? token0 : token1;
    }

    /// @inheritdoc IStakingVault
    function partialUnstakeBps() external view override returns (uint16) {
        return _pendingBps;
    }

    // ============ stake — initial mint ============

    /// @inheritdoc IStakingVault
    function stake(
        StakeParams calldata positionParams,
        bool isToken0Quote_,
        uint256 yieldTarget_
    ) external override onlyOwner inState(State.Empty) nonReentrant returns (uint256 mintedTokenId) {
        // Pull desired amounts from caller
        if (positionParams.amount0Desired > 0) {
            IERC20(positionParams.token0).safeTransferFrom(
                msg.sender, address(this), positionParams.amount0Desired
            );
        }
        if (positionParams.amount1Desired > 0) {
            IERC20(positionParams.token1).safeTransferFrom(
                msg.sender, address(this), positionParams.amount1Desired
            );
        }

        // Approve NFPM
        if (positionParams.amount0Desired > 0) {
            IERC20(positionParams.token0).forceApprove(
                address(positionManager), positionParams.amount0Desired
            );
        }
        if (positionParams.amount1Desired > 0) {
            IERC20(positionParams.token1).forceApprove(
                address(positionManager), positionParams.amount1Desired
            );
        }

        uint256 amount0Used;
        uint256 amount1Used;
        (mintedTokenId,, amount0Used, amount1Used) = positionManager.mint(
            INonfungiblePositionManagerMinimal.MintParams({
                token0: positionParams.token0,
                token1: positionParams.token1,
                fee: positionParams.fee,
                tickLower: positionParams.tickLower,
                tickUpper: positionParams.tickUpper,
                amount0Desired: positionParams.amount0Desired,
                amount1Desired: positionParams.amount1Desired,
                amount0Min: positionParams.amount0Min,
                amount1Min: positionParams.amount1Min,
                recipient: address(this),
                deadline: positionParams.deadline
            })
        );

        // Clear approvals
        if (positionParams.amount0Desired > 0) {
            IERC20(positionParams.token0).forceApprove(address(positionManager), 0);
        }
        if (positionParams.amount1Desired > 0) {
            IERC20(positionParams.token1).forceApprove(address(positionManager), 0);
        }

        // Refund unconsumed amounts
        uint256 refund0 = positionParams.amount0Desired - amount0Used;
        uint256 refund1 = positionParams.amount1Desired - amount1Used;
        if (refund0 > 0) {
            IERC20(positionParams.token0).safeTransfer(msg.sender, refund0);
        }
        if (refund1 > 0) {
            IERC20(positionParams.token1).safeTransfer(msg.sender, refund1);
        }

        // Cache position config
        tokenId = mintedTokenId;
        token0 = positionParams.token0;
        token1 = positionParams.token1;
        _tickLower = positionParams.tickLower;
        _tickUpper = positionParams.tickUpper;
        isToken0Quote = isToken0Quote_;
        yieldTarget = yieldTarget_;

        // Map used amounts to (base, quote)
        if (isToken0Quote_) {
            stakedQuote = amount0Used;
            stakedBase = amount1Used;
        } else {
            stakedQuote = amount1Used;
            stakedBase = amount0Used;
        }

        // Resolve pool address via NFPM.factory().getPool(token0, token1, fee)
        pool = _resolvePool(positionParams.token0, positionParams.token1, positionParams.fee);

        _state = State.Staked;

        emit Stake(owner, stakedBase, stakedQuote, yieldTarget_, mintedTokenId);
    }

    // ============ stakeTopUp — additive ============

    /// @inheritdoc IStakingVault
    function stakeTopUp(TopUpParams calldata p)
        external
        override
        onlyOwner
        inState(State.Staked)
        nonReentrant
    {
        address t0 = token0;
        address t1 = token1;

        if (p.amount0Desired > 0) {
            IERC20(t0).safeTransferFrom(msg.sender, address(this), p.amount0Desired);
            IERC20(t0).forceApprove(address(positionManager), p.amount0Desired);
        }
        if (p.amount1Desired > 0) {
            IERC20(t1).safeTransferFrom(msg.sender, address(this), p.amount1Desired);
            IERC20(t1).forceApprove(address(positionManager), p.amount1Desired);
        }

        (, uint256 amount0Used, uint256 amount1Used) = positionManager.increaseLiquidity(
            INonfungiblePositionManagerMinimal.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: p.amount0Desired,
                amount1Desired: p.amount1Desired,
                amount0Min: p.amount0Min,
                amount1Min: p.amount1Min,
                deadline: p.deadline
            })
        );

        if (p.amount0Desired > 0) IERC20(t0).forceApprove(address(positionManager), 0);
        if (p.amount1Desired > 0) IERC20(t1).forceApprove(address(positionManager), 0);

        uint256 refund0 = p.amount0Desired - amount0Used;
        uint256 refund1 = p.amount1Desired - amount1Used;
        if (refund0 > 0) IERC20(t0).safeTransfer(msg.sender, refund0);
        if (refund1 > 0) IERC20(t1).safeTransfer(msg.sender, refund1);

        uint256 baseAdded;
        uint256 quoteAdded;
        if (isToken0Quote) {
            quoteAdded = amount0Used;
            baseAdded = amount1Used;
        } else {
            quoteAdded = amount1Used;
            baseAdded = amount0Used;
        }

        // Scale T proportionally so the implicit yield rate stays constant.
        // T_new = T_old × (Q + ΔQ) / Q, ceil-rounded to avoid downward drift on
        // repeated tiny top-ups. Skip if Q == 0 — no anchor to scale against.
        uint256 oldQ = stakedQuote;
        if (oldQ > 0 && quoteAdded > 0) {
            uint256 oldT = yieldTarget;
            uint256 newT = Math.mulDiv(oldT, oldQ + quoteAdded, oldQ, Math.Rounding.Up);
            if (newT != oldT) {
                yieldTarget = newT;
                emit YieldTargetSet(owner, oldT, newT);
            }
        }

        stakedBase += baseAdded;
        stakedQuote += quoteAdded;

        emit Stake(owner, baseAdded, quoteAdded, yieldTarget, tokenId);
    }

    // ============ setYieldTarget ============

    /// @inheritdoc IStakingVault
    function setYieldTarget(uint256 newTarget)
        external
        override
        onlyOwner
        inState(State.Staked)
        nonReentrant
    {
        uint256 old = yieldTarget;
        yieldTarget = newTarget;
        emit YieldTargetSet(owner, old, newTarget);
    }

    // ============ pendingBps controls ============

    /// @inheritdoc IStakingVault
    function setPartialUnstakeBps(uint16 newBps)
        external
        override
        onlyOwner
        inState(State.Staked)
        nonReentrant
    {
        if (newBps > BPS_DENOM) revert InvalidBps();
        uint16 oldBps = _pendingBps;
        _pendingBps = newBps;
        emit PartialUnstakeBpsSet(owner, oldBps, newBps);
    }

    /// @inheritdoc IStakingVault
    function increasePartialUnstakeBps(uint16 bpsToAdd)
        external
        override
        onlyOwner
        inState(State.Staked)
        nonReentrant
    {
        uint16 oldBps = _pendingBps;
        uint256 candidate = uint256(oldBps) + uint256(bpsToAdd);
        if (candidate > BPS_DENOM) revert InvalidBps();
        // forge-lint: disable-next-line(unsafe-typecast)
        _pendingBps = uint16(candidate);
        emit PartialUnstakeBpsSet(owner, oldBps, _pendingBps);
    }

    // ============ quoteSwap ============

    /// @inheritdoc IStakingVault
    function quoteSwap() external view override returns (SwapQuote memory) {
        if (_state != State.Staked) {
            return SwapQuote({
                status: SwapStatus.NotApplicable,
                effectiveBps: 0,
                tokenIn: address(0),
                minAmountIn: 0,
                tokenOut: address(0),
                amountOut: 0
            });
        }

        uint16 effectiveBps = _effectiveBps();

        // Overflow guard: Q + T
        uint256 Q = stakedQuote;
        uint256 T = yieldTarget;
        unchecked {
            if (Q + T < Q) {
                return SwapQuote({
                    status: SwapStatus.Underwater,
                    effectiveBps: effectiveBps,
                    tokenIn: address(0),
                    minAmountIn: 0,
                    tokenOut: address(0),
                    amountOut: 0
                });
            }
        }
        uint256 B = stakedBase;
        uint256 targetBase = (B * uint256(effectiveBps)) / BPS_DENOM;
        uint256 targetQuote = ((Q + T) * uint256(effectiveBps)) / BPS_DENOM;

        // Simulate partial close: principal × bps + ALL collectable fees (collect is all-or-nothing).
        (uint256 b, uint256 qBal) = _expectedBalancesAfterPartialClose(effectiveBps);

        if (b >= targetBase && qBal >= targetQuote) {
            // Case 1
            return SwapQuote({
                status: SwapStatus.NoSwapNeeded,
                effectiveBps: effectiveBps,
                tokenIn: address(0),
                minAmountIn: 0,
                tokenOut: address(0),
                amountOut: 0
            });
        }
        if (b > targetBase && qBal < targetQuote) {
            // Case 2: executor sends quote, receives base
            return SwapQuote({
                status: SwapStatus.Executable,
                effectiveBps: effectiveBps,
                tokenIn: quoteToken(),
                minAmountIn: targetQuote - qBal,
                tokenOut: baseToken(),
                amountOut: b - targetBase
            });
        }
        if (b < targetBase && qBal > targetQuote) {
            // Case 3: executor sends base, receives quote
            return SwapQuote({
                status: SwapStatus.Executable,
                effectiveBps: effectiveBps,
                tokenIn: baseToken(),
                minAmountIn: targetBase - b,
                tokenOut: quoteToken(),
                amountOut: qBal - targetQuote
            });
        }
        // Case 4
        return SwapQuote({
            status: SwapStatus.Underwater,
            effectiveBps: effectiveBps,
            tokenIn: address(0),
            minAmountIn: 0,
            tokenOut: address(0),
            amountOut: 0
        });
    }

    /// @dev Compute (base, quote) the vault WOULD newly receive from a partial close at `bps`,
    ///      including ALL uncollected fees (`collect` is all-or-nothing). Result is the
    ///      delta that classification compares against `(targetBase, targetQuote)`; existing
    ///      buffer slots are tracked separately and NOT folded into this view.
    function _expectedBalancesAfterPartialClose(uint16 bps)
        internal
        view
        returns (uint256 b, uint256 q)
    {
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 liquidity,
            uint256 fgInside0Last,
            uint256 fgInside1Last,
            uint128 owed0,
            uint128 owed1
        ) = positionManager.positions(tokenId);

        // Principal at current pool price for the partial liquidity burn.
        uint256 amount0;
        uint256 amount1;
        if (liquidity > 0) {
            // forge-lint: disable-next-line(unsafe-typecast)
            uint128 partialLiquidity = uint128((uint256(liquidity) * uint256(bps)) / BPS_DENOM);
            if (partialLiquidity > 0) {
                (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
                uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(_tickLower);
                uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(_tickUpper);
                (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
                    sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, partialLiquidity
                );
            }
        }

        // All uncollected fees (snapshotted + live). NOT pro-rated by bps — collect is all-or-nothing.
        (uint256 fees0, uint256 fees1) = LibUniswapV3Fees.uncollectedFees(
            pool, _tickLower, _tickUpper, liquidity, fgInside0Last, fgInside1Last, owed0, owed1
        );
        amount0 += fees0;
        amount1 += fees1;

        if (isToken0Quote) {
            q = amount0;
            b = amount1;
        } else {
            q = amount1;
            b = amount0;
        }
    }

    // ============ swap ============

    /// @inheritdoc IStakingVault
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut)
        external
        override
        nonReentrant
        inState(State.Staked)
        returns (uint256 amountOut)
    {
        uint16 effectiveBps = _effectiveBps();

        uint256 B = stakedBase;
        uint256 Q = stakedQuote;
        uint256 T = yieldTarget;

        // Overflow guard: Q + T
        uint256 quoteFloorTotal;
        unchecked {
            quoteFloorTotal = Q + T;
            if (quoteFloorTotal < Q) revert Underwater();
        }

        address baseTok = baseToken();
        address quoteTok = quoteToken();

        // Snapshot pre-swap balances so we can compute the delta from this partial close.
        uint256 preBase = IERC20(baseTok).balanceOf(address(this));
        uint256 preQuote = IERC20(quoteTok).balanceOf(address(this));

        _closePartial(effectiveBps);

        uint256 b = IERC20(baseTok).balanceOf(address(this)) - preBase;
        uint256 qBal = IERC20(quoteTok).balanceOf(address(this)) - preQuote;

        uint256 targetBase = (B * uint256(effectiveBps)) / BPS_DENOM;
        uint256 targetQuote = (quoteFloorTotal * uint256(effectiveBps)) / BPS_DENOM;

        // Case classification + execution
        if (b >= targetBase && qBal >= targetQuote) {
            // Case 1: no-swap settle
            if (amountIn != 0) revert InsufficientAmountIn();
            amountOut = 0;
            emit Swap(msg.sender, address(0), 0, address(0), 0, effectiveBps);
        } else if (b > targetBase && qBal < targetQuote) {
            // Case 2: executor sends quote, receives base
            if (tokenIn != quoteTok) revert TokenMismatch();
            if (tokenOut != baseTok) revert TokenMismatch();
            uint256 requiredMin = targetQuote - qBal;
            if (amountIn < requiredMin) revert InsufficientAmountIn();
            amountOut = b - targetBase;
            if (amountOut < minAmountOut) revert SlippageExceeded();
            IERC20(quoteTok).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(baseTok).safeTransfer(msg.sender, amountOut);
            emit Swap(msg.sender, tokenIn, amountIn, tokenOut, amountOut, effectiveBps);
        } else if (b < targetBase && qBal > targetQuote) {
            // Case 3: executor sends base, receives quote
            if (tokenIn != baseTok) revert TokenMismatch();
            if (tokenOut != quoteTok) revert TokenMismatch();
            uint256 requiredMin = targetBase - b;
            if (amountIn < requiredMin) revert InsufficientAmountIn();
            amountOut = qBal - targetQuote;
            if (amountOut < minAmountOut) revert SlippageExceeded();
            IERC20(baseTok).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(quoteTok).safeTransfer(msg.sender, amountOut);
            emit Swap(msg.sender, tokenIn, amountIn, tokenOut, amountOut, effectiveBps);
        } else {
            // Case 4
            revert Underwater();
        }

        // Recompute deltas after executor token movements to fill buffers.
        uint256 newFreeBase = IERC20(baseTok).balanceOf(address(this)) - preBase;
        uint256 newFreeQuote = IERC20(quoteTok).balanceOf(address(this)) - preQuote;

        uint256 unstakeBaseDelta = (B * uint256(effectiveBps)) / BPS_DENOM;
        uint256 unstakeQuoteDelta = (Q * uint256(effectiveBps)) / BPS_DENOM;

        // Buffer increments (case classification guarantees newFree* >= unstake*Delta).
        unstakeBufferBase += unstakeBaseDelta;
        unstakeBufferQuote += unstakeQuoteDelta;
        rewardBufferBase += newFreeBase - unstakeBaseDelta;
        rewardBufferQuote += newFreeQuote - unstakeQuoteDelta;

        // Reduce active stake proportionally.
        stakedBase = B - unstakeBaseDelta;
        stakedQuote = Q - unstakeQuoteDelta;
        yieldTarget = T - ((T * uint256(effectiveBps)) / BPS_DENOM);

        // Clear pending counter and update state if fully closed.
        _pendingBps = 0;
        if (effectiveBps == BPS_DENOM) {
            _state = State.Settled;
        }

        return amountOut;
    }

    // ============ unstake / claimRewards — buffer drain ============

    /// @inheritdoc IStakingVault
    function unstake() external override onlyOwner nonReentrant {
        if (_state != State.Staked && _state != State.Settled) revert WrongState();
        uint256 baseAmt = unstakeBufferBase;
        uint256 quoteAmt = unstakeBufferQuote;
        if (baseAmt == 0 && quoteAmt == 0) revert NothingToUnstake();

        unstakeBufferBase = 0;
        unstakeBufferQuote = 0;

        if (baseAmt > 0) IERC20(baseToken()).safeTransfer(owner, baseAmt);
        if (quoteAmt > 0) IERC20(quoteToken()).safeTransfer(owner, quoteAmt);

        emit Unstake(owner, baseAmt, quoteAmt);
    }

    /// @inheritdoc IStakingVault
    function claimRewards() external override onlyOwner nonReentrant {
        if (_state != State.Staked && _state != State.Settled) revert WrongState();
        uint256 baseAmt = rewardBufferBase;
        uint256 quoteAmt = rewardBufferQuote;
        if (baseAmt == 0 && quoteAmt == 0) revert NothingToClaim();

        rewardBufferBase = 0;
        rewardBufferQuote = 0;

        if (baseAmt > 0) IERC20(baseToken()).safeTransfer(owner, baseAmt);
        if (quoteAmt > 0) IERC20(quoteToken()).safeTransfer(owner, quoteAmt);

        emit ClaimRewards(owner, baseAmt, quoteAmt);
    }

    // ============ flashClose ============

    /// @inheritdoc IStakingVault
    function flashClose(uint16 bps, address callbackTarget, bytes calldata data)
        external
        override
        onlyOwner
        inState(State.Staked)
        nonReentrant
    {
        if (bps == 0 || bps > BPS_DENOM) revert InvalidBps();

        uint256 B = stakedBase;
        uint256 Q = stakedQuote;
        uint256 T = yieldTarget;

        // Overflow guard: Q + T
        uint256 quoteFloorTotal;
        unchecked {
            quoteFloorTotal = Q + T;
            if (quoteFloorTotal < Q) revert YieldTargetOverflow();
        }

        uint256 expectedBase = (B * uint256(bps)) / BPS_DENOM;
        uint256 expectedQuote = (quoteFloorTotal * uint256(bps)) / BPS_DENOM;

        address baseTok = baseToken();
        address quoteTok = quoteToken();

        // Snapshot pre-call balances so we can isolate the freed delta from prior buffers.
        uint256 preBase = IERC20(baseTok).balanceOf(address(this));
        uint256 preQuote = IERC20(quoteTok).balanceOf(address(this));

        _closePartial(bps);

        uint256 freedBase = IERC20(baseTok).balanceOf(address(this)) - preBase;
        uint256 freedQuote = IERC20(quoteTok).balanceOf(address(this)) - preQuote;

        // Lock + emit BEFORE callback. Re-entry into any other vault function
        // reverts via `inState` checks while we're in this state.
        _state = State.FlashCloseInProgress;
        emit FlashCloseInitiated(owner, bps, callbackTarget, data);

        // Push only the freed delta to the callback. Existing buffers stay in the vault.
        if (freedBase > 0) IERC20(baseTok).safeTransfer(callbackTarget, freedBase);
        if (freedQuote > 0) IERC20(quoteTok).safeTransfer(callbackTarget, freedQuote);

        IFlashCloseCallback(callbackTarget).flashCloseCallback(expectedBase, expectedQuote, data);

        // Verify the freed delta returned at least the expected amounts.
        uint256 postBase = IERC20(baseTok).balanceOf(address(this)) - preBase;
        uint256 postQuote = IERC20(quoteTok).balanceOf(address(this)) - preQuote;
        if (postBase < expectedBase) revert InsufficientBaseReturned();
        if (postQuote < expectedQuote) revert InsufficientQuoteReturned();

        // Buffer increments (same accounting as swap()).
        uint256 unstakeBaseDelta = (B * uint256(bps)) / BPS_DENOM;
        uint256 unstakeQuoteDelta = (Q * uint256(bps)) / BPS_DENOM;
        unstakeBufferBase += unstakeBaseDelta;
        unstakeBufferQuote += unstakeQuoteDelta;
        rewardBufferBase += postBase - unstakeBaseDelta;
        rewardBufferQuote += postQuote - unstakeQuoteDelta;

        // Reduce active stake proportionally.
        stakedBase = B - unstakeBaseDelta;
        stakedQuote = Q - unstakeQuoteDelta;
        yieldTarget = T - ((T * uint256(bps)) / BPS_DENOM);

        // Update state. pendingBps is intentionally untouched.
        _state = (bps == BPS_DENOM) ? State.Settled : State.Staked;

        // Auto-drain BOTH buffers (including any pre-existing amounts from prior partial settlements).
        uint256 ub = unstakeBufferBase;
        uint256 uq = unstakeBufferQuote;
        uint256 rb = rewardBufferBase;
        uint256 rq = rewardBufferQuote;

        unstakeBufferBase = 0;
        unstakeBufferQuote = 0;
        rewardBufferBase = 0;
        rewardBufferQuote = 0;

        if (ub > 0) IERC20(baseTok).safeTransfer(owner, ub);
        if (uq > 0) IERC20(quoteTok).safeTransfer(owner, uq);
        emit Unstake(owner, ub, uq);

        if (rb > 0) IERC20(baseTok).safeTransfer(owner, rb);
        if (rq > 0) IERC20(quoteTok).safeTransfer(owner, rq);
        emit ClaimRewards(owner, rb, rq);
    }

    // ============ Internal helpers ============

    /// @dev Effective bps for the next swap: `pendingBps` if set, otherwise full close (10000).
    function _effectiveBps() internal view returns (uint16) {
        uint16 p = _pendingBps;
        return p == 0 ? BPS_DENOM : p;
    }

    /// @dev Decrease `bps` of the position's liquidity (rounded down) and collect everything
    ///      currently owed to the position. `bps` MUST be in [1, 10000]; caller is responsible
    ///      for that bound.
    function _closePartial(uint16 bps) internal {
        (,,,,,,, uint128 liquidity,,,,) = positionManager.positions(tokenId);
        if (liquidity > 0) {
            // forge-lint: disable-next-line(unsafe-typecast)
            uint128 partialLiquidity = uint128((uint256(liquidity) * uint256(bps)) / BPS_DENOM);
            if (partialLiquidity > 0) {
                positionManager.decreaseLiquidity(
                    INonfungiblePositionManagerMinimal.DecreaseLiquidityParams({
                        tokenId: tokenId,
                        liquidity: partialLiquidity,
                        amount0Min: 0,
                        amount1Min: 0,
                        deadline: block.timestamp
                    })
                );
            }
        }
        positionManager.collect(
            INonfungiblePositionManagerMinimal.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
    }

    // Multicall is provided by OZ's `Multicall` mixin (see inheritance list).
    // Per-call state checks remain authoritative — multicall does not bypass them.

    function _resolvePool(address t0, address t1, uint24 fee)
        internal
        view
        returns (address resolved)
    {
        address uniFactory = positionManager.factory();
        (bool ok, bytes memory ret) = uniFactory.staticcall(
            abi.encodeWithSignature("getPool(address,address,uint24)", t0, t1, fee)
        );
        if (!ok || ret.length < 32) revert PoolResolutionFailed();
        resolved = abi.decode(ret, (address));
        if (resolved == address(0)) revert PoolResolutionFailed();
    }
}
