// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";

import {INonfungiblePositionManagerMinimal} from
    "../interfaces/INonfungiblePositionManagerMinimal.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {LiquidityAmounts} from "../libraries/LiquidityAmounts.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {LibUniswapV3Fees} from "../libraries/LibUniswapV3Fees.sol";

import {IStakingVault, StakeParams, SwapStatus, SwapQuote} from "./interfaces/IStakingVault.sol";
import {IFlashCloseCallback} from "./interfaces/IFlashCloseCallback.sol";

/// @title UniswapV3StakingVault
/// @notice Per-stake vault wrapping a single Uniswap V3 NFT position with a quote-side
///         yield target. Deployed as an EIP-1167 clone via UniswapV3StakingVaultFactory.
/// @dev Implements RFC-0003 (issue #58). Non-transferable owner; one-shot lifecycle.
contract UniswapV3StakingVault is IStakingVault, ReentrancyGuard, Multicall {
    using SafeERC20 for IERC20;

    enum State {
        Empty,
        Staked,
        FlashCloseInProgress,
        Settled
    }

    // ============ Implementation immutables (baked into runtime code) ============

    INonfungiblePositionManagerMinimal public immutable positionManager;

    // ============ Clone-initialized storage ============

    address public owner;

    // Position details cached during stake()
    address public pool;
    uint256 public tokenId;
    address public token0;
    address public token1;
    int24 internal _tickLower;
    int24 internal _tickUpper;

    // Stake terms
    bool public isToken0Quote;
    uint256 public stakedBase;
    uint256 public stakedQuote;
    uint256 public yieldTarget;

    // Lifecycle state
    State internal _state;

    // Settlement-time snapshots
    uint256 public baseReward;
    uint256 public quoteReward;
    bool public principalUnstaked;
    bool public rewardsClaimed;

    // One-shot init guard
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
    error AlreadyConsumed();
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

    // ============ stake ============

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
        address resolvedPool = _resolvePool(positionParams.token0, positionParams.token1, positionParams.fee);
        pool = resolvedPool;

        _state = State.Staked;

        emit Stake(owner, stakedBase, stakedQuote, yieldTarget_, mintedTokenId);
    }

    // ============ setYieldTarget ============

    /// @inheritdoc IStakingVault
    function setYieldTarget(uint256 newTarget)
        external
        override
        onlyOwner
        inState(State.Staked)
    {
        uint256 old = yieldTarget;
        yieldTarget = newTarget;
        emit YieldTargetSet(owner, old, newTarget);
    }

    // ============ quoteSwap ============

    /// @inheritdoc IStakingVault
    function quoteSwap() external view override returns (SwapQuote memory q) {
        if (_state != State.Staked) {
            return SwapQuote({
                status: SwapStatus.NotApplicable,
                tokenIn: address(0),
                minAmountIn: 0,
                tokenOut: address(0),
                amountOut: 0
            });
        }

        // Overflow guard: Q + T
        uint256 Q = stakedQuote;
        uint256 T = yieldTarget;
        unchecked {
            if (Q + T < Q) {
                return SwapQuote({
                    status: SwapStatus.Underwater,
                    tokenIn: address(0),
                    minAmountIn: 0,
                    tokenOut: address(0),
                    amountOut: 0
                });
            }
        }
        uint256 quoteFloor = Q + T;
        uint256 B = stakedBase;

        // Simulate close: principal + uncollected fees
        (uint256 b, uint256 qBal) = _expectedBalancesAfterClose();

        // Classify per spec §10
        if (b >= B && qBal >= quoteFloor) {
            // Case 1
            return SwapQuote({
                status: SwapStatus.NoSwapNeeded,
                tokenIn: address(0),
                minAmountIn: 0,
                tokenOut: address(0),
                amountOut: 0
            });
        }
        if (b > B && qBal < quoteFloor) {
            // Case 2: executor sends quote, receives base
            return SwapQuote({
                status: SwapStatus.Executable,
                tokenIn: quoteToken(),
                minAmountIn: quoteFloor - qBal,
                tokenOut: baseToken(),
                amountOut: b - B
            });
        }
        if (b < B && qBal > quoteFloor) {
            // Case 3: executor sends base, receives quote
            return SwapQuote({
                status: SwapStatus.Executable,
                tokenIn: baseToken(),
                minAmountIn: B - b,
                tokenOut: quoteToken(),
                amountOut: qBal - quoteFloor
            });
        }
        // Case 4
        return SwapQuote({
            status: SwapStatus.Underwater,
            tokenIn: address(0),
            minAmountIn: 0,
            tokenOut: address(0),
            amountOut: 0
        });
    }

    /// @dev Compute (base, quote) the vault would hold after closing the UV3 position
    ///      and collecting fees. Includes BOTH already-snapshotted fees from
    ///      `tokensOwed*` AND not-yet-snapshotted fees living in the pool's
    ///      `feeGrowthInside` state (the only place fees accrue while the NFT
    ///      sits idle in the vault). Without the live component this view would
    ///      report `Underwater`/Case 4 for the entire active life of the
    ///      position whenever the path to settlement runs through fees.
    function _expectedBalancesAfterClose() internal view returns (uint256 b, uint256 q) {
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

        // Principal at current pool price
        uint256 amount0;
        uint256 amount1;
        if (liquidity > 0) {
            (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
            uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(_tickLower);
            uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(_tickUpper);
            (amount0, amount1) =
                LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, liquidity);
        }

        // All uncollected fees: snapshotted (tokensOwed*) + live (feeGrowthInside delta).
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
        // Close UV3 position + collect everything to vault
        _closePosition();

        address baseTok = baseToken();
        address quoteTok = quoteToken();
        uint256 b = IERC20(baseTok).balanceOf(address(this));
        uint256 qBal = IERC20(quoteTok).balanceOf(address(this));

        uint256 B = stakedBase;
        uint256 Q = stakedQuote;
        uint256 T = yieldTarget;

        // Overflow guard: Q + T
        uint256 quoteFloor;
        unchecked {
            quoteFloor = Q + T;
            if (quoteFloor < Q) revert Underwater();
        }

        // Case 1: no-swap settle
        if (b >= B && qBal >= quoteFloor) {
            if (amountIn != 0) revert InsufficientAmountIn(); // amountIn must be zero
            // Tokens may be address(0) for Case 1; do not validate them here.
            baseReward = b - B;
            quoteReward = qBal - Q;
            _state = State.Settled;
            emit Swap(msg.sender, address(0), 0, address(0), 0);
            return 0;
        }

        // Case 2: executor sends quote, receives base
        if (b > B && qBal < quoteFloor) {
            if (tokenIn != quoteTok) revert TokenMismatch();
            if (tokenOut != baseTok) revert TokenMismatch();
            uint256 requiredMin = quoteFloor - qBal;
            if (amountIn < requiredMin) revert InsufficientAmountIn();
            amountOut = b - B;
            if (amountOut < minAmountOut) revert SlippageExceeded();

            IERC20(quoteTok).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(baseTok).safeTransfer(msg.sender, amountOut);

            baseReward = 0;
            quoteReward = (qBal + amountIn) - Q;
            _state = State.Settled;
            emit Swap(msg.sender, tokenIn, amountIn, tokenOut, amountOut);
            return amountOut;
        }

        // Case 3: executor sends base, receives quote
        if (b < B && qBal > quoteFloor) {
            if (tokenIn != baseTok) revert TokenMismatch();
            if (tokenOut != quoteTok) revert TokenMismatch();
            uint256 requiredMin = B - b;
            if (amountIn < requiredMin) revert InsufficientAmountIn();
            amountOut = qBal - quoteFloor;
            if (amountOut < minAmountOut) revert SlippageExceeded();

            IERC20(baseTok).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(quoteTok).safeTransfer(msg.sender, amountOut);

            baseReward = (b + amountIn) - B;
            quoteReward = T;
            _state = State.Settled;
            emit Swap(msg.sender, tokenIn, amountIn, tokenOut, amountOut);
            return amountOut;
        }

        // Case 4
        revert Underwater();
    }

    // ============ unstake / claimRewards ============

    /// @inheritdoc IStakingVault
    function unstake() external override onlyOwner inState(State.Settled) nonReentrant {
        if (principalUnstaked) revert AlreadyConsumed();
        principalUnstaked = true;
        IERC20(baseToken()).safeTransfer(owner, stakedBase);
        IERC20(quoteToken()).safeTransfer(owner, stakedQuote);
        emit Unstake(owner, stakedBase, stakedQuote);
    }

    /// @inheritdoc IStakingVault
    function claimRewards() external override onlyOwner inState(State.Settled) nonReentrant {
        if (rewardsClaimed) revert AlreadyConsumed();
        rewardsClaimed = true;
        uint256 br = baseReward;
        uint256 qr = quoteReward;
        if (br > 0) IERC20(baseToken()).safeTransfer(owner, br);
        if (qr > 0) IERC20(quoteToken()).safeTransfer(owner, qr);
        emit ClaimRewards(owner, br, qr);
    }

    // ============ flashClose ============

    /// @inheritdoc IStakingVault
    function flashClose(address callbackTarget, bytes calldata data)
        external
        override
        onlyOwner
        inState(State.Staked)
        nonReentrant
    {
        // Close the UV3 position
        _closePosition();

        uint256 expectedBase = stakedBase;
        uint256 expectedQuote;
        unchecked {
            expectedQuote = stakedQuote + yieldTarget;
            if (expectedQuote < stakedQuote) revert YieldTargetOverflow();
        }

        // Lock + emit BEFORE callback
        _state = State.FlashCloseInProgress;
        emit FlashCloseInitiated(owner, callbackTarget, data);

        // Push current vault balances to callback target
        address baseTok = baseToken();
        address quoteTok = quoteToken();
        uint256 currentBase = IERC20(baseTok).balanceOf(address(this));
        uint256 currentQuote = IERC20(quoteTok).balanceOf(address(this));
        if (currentBase > 0) IERC20(baseTok).safeTransfer(callbackTarget, currentBase);
        if (currentQuote > 0) IERC20(quoteTok).safeTransfer(callbackTarget, currentQuote);

        // Run helper
        IFlashCloseCallback(callbackTarget).flashCloseCallback(expectedBase, expectedQuote, data);

        // Verify post-balances
        uint256 finalBase = IERC20(baseTok).balanceOf(address(this));
        uint256 finalQuote = IERC20(quoteTok).balanceOf(address(this));
        if (finalBase < expectedBase) revert InsufficientBaseReturned();
        if (finalQuote < expectedQuote) revert InsufficientQuoteReturned();

        // Snapshot rewards
        uint256 br = finalBase - stakedBase;
        uint256 qr = finalQuote - stakedQuote;
        baseReward = br;
        quoteReward = qr;

        _state = State.Settled;

        // Auto-settle: combined unstake + claimRewards
        principalUnstaked = true;
        rewardsClaimed = true;
        IERC20(baseTok).safeTransfer(owner, stakedBase);
        IERC20(quoteTok).safeTransfer(owner, stakedQuote);
        emit Unstake(owner, stakedBase, stakedQuote);
        if (br > 0) IERC20(baseTok).safeTransfer(owner, br);
        if (qr > 0) IERC20(quoteTok).safeTransfer(owner, qr);
        emit ClaimRewards(owner, br, qr);
    }

    // ============ Internal helpers ============

    function _closePosition() internal {
        // Decrease all liquidity (if any), then collect everything to vault.
        (,,,,,,, uint128 liquidity,,,,) = positionManager.positions(tokenId);
        if (liquidity > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManagerMinimal.DecreaseLiquidityParams({
                    tokenId: tokenId,
                    liquidity: liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );
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

    function _resolvePool(address t0, address t1, uint24 fee) internal view returns (address resolved) {
        address uniFactory = positionManager.factory();
        (bool ok, bytes memory ret) = uniFactory.staticcall(
            abi.encodeWithSignature("getPool(address,address,uint24)", t0, t1, fee)
        );
        if (!ok || ret.length < 32) revert PoolResolutionFailed();
        resolved = abi.decode(ret, (address));
        if (resolved == address(0)) revert PoolResolutionFailed();
    }

}
