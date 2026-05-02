// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Mirrors INonfungiblePositionManager.MintParams without `recipient`
/// (recipient is always the vault clone itself).
struct StakeParams {
    address token0;
    address token1;
    uint24 fee;
    int24 tickLower;
    int24 tickUpper;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
}

/// @notice Top-up parameters mirror NFPM.IncreaseLiquidityParams without `tokenId`
/// (the vault knows its own position).
struct TopUpParams {
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
}

/// @notice Status of a swap quote returned by `quoteSwap()`.
enum SwapStatus {
    NotApplicable, // state ∉ {Staked} — no swap possible/needed
    NoSwapNeeded, // Case 1 at current effectiveBps; swap() with amountIn = 0 settles
    Executable, // Case 2 or 3 at current effectiveBps
    Underwater // Case 4 at current effectiveBps; swap() reverts; use flashClose()

}

/// @notice Result of `quoteSwap()`. Terminology is from the executor's perspective.
struct SwapQuote {
    SwapStatus status;
    uint16 effectiveBps; // pendingBps if > 0, else 10000 (zero for non-Staked states)
    address tokenIn; // executor's payment token (zero address if not Executable)
    uint256 minAmountIn; // executor must send at least this much
    address tokenOut; // executor's receipt token (zero address if not Executable)
    uint256 amountOut; // exact amount executor will receive
}

/// @title IStakingVault
/// @notice Per-stake vault wrapping a single Uniswap V3 NFT position with a quote-side yield target.
/// @dev See SPEC-0003a (issue #61) for the full state machine and mechanics.
interface IStakingVault {
    // ============ Events ============

    /// @notice Emitted on initial stake (totals) and on top-up (deltas).
    event Stake(
        address indexed owner, uint256 base, uint256 quote, uint256 yieldTarget, uint256 tokenId
    );

    event YieldTargetSet(address indexed owner, uint256 oldTarget, uint256 newTarget);

    event PartialUnstakeBpsSet(address indexed owner, uint16 oldBps, uint16 newBps);

    event Swap(
        address indexed executor,
        address tokenIn, // address(0) in Case 1 (no-swap settle)
        uint256 amountIn, // 0 in Case 1
        address tokenOut, // address(0) in Case 1
        uint256 amountOut, // 0 in Case 1
        uint16 effectiveBps // 1..10000
    );

    event Unstake(address indexed owner, uint256 base, uint256 quote);

    event ClaimRewards(address indexed owner, uint256 baseAmount, uint256 quoteAmount);

    event FlashCloseInitiated(
        address indexed owner, uint16 bps, address indexed callbackTarget, bytes data
    );

    // ============ Initialization ============

    /// @notice Bind this clone to its owner. Called atomically by the factory.
    function initialize(address owner) external;

    // ============ Lifecycle — owner-only ============

    /// @notice Open a fresh UV3 position and stake it. Only valid in `Empty`.
    /// @param positionParams Parameters forwarded to NFPM.mint() (recipient = this clone).
    /// @param isToken0Quote True iff token0 is the quote token (false = token1 is quote).
    /// @param yieldTarget Required quote-side reward floor (T).
    /// @return tokenId The minted NFT id.
    function stake(StakeParams calldata positionParams, bool isToken0Quote, uint256 yieldTarget)
        external
        returns (uint256 tokenId);

    /// @notice Top-up an existing staked position with additional liquidity. Only valid in `Staked`.
    function stakeTopUp(TopUpParams calldata params) external;

    /// @notice Update the yield target. Only valid in `Staked`.
    function setYieldTarget(uint256 newTarget) external;

    /// @notice Set the bps fraction of the position to unstake at the next executor swap.
    function setPartialUnstakeBps(uint16 newBps) external;

    /// @notice Increment `pendingBps` by `bpsToAdd`. Reverts if the result exceeds 10000.
    function increasePartialUnstakeBps(uint16 bpsToAdd) external;

    /// @notice Returns the current `pendingBps` value (0..10000).
    function partialUnstakeBps() external view returns (uint16);

    // ============ Lifecycle — permissionless ============

    /// @notice Returns whether (and how) `swap()` can settle the vault right now.
    function quoteSwap() external view returns (SwapQuote memory);

    /// @notice Settle the vault as the executor. Vault closes its UV3 position by
    ///         `effectiveBps`, takes the executor's `amountIn`, and pays out `amountOut`.
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut)
        external
        returns (uint256 amountOut);

    // ============ Settlement — owner-only ============

    /// @notice Drain accumulated principal from `unstakeBuffer*` to owner. Reverts if both empty.
    function unstake() external;

    /// @notice Drain accumulated rewards from `rewardBuffer*` to owner. Reverts if both empty.
    function claimRewards() external;

    // ============ Convenience — owner-only ============

    /// @notice Owner-driven (partial or full) exit using a flash-loan / external-swap helper.
    /// @param bps Fraction of the active position to close, in basis points (1..10000).
    /// @param callbackTarget Helper contract implementing IFlashCloseCallback.
    /// @param data Opaque calldata forwarded to the callback.
    function flashClose(uint16 bps, address callbackTarget, bytes calldata data) external;

    // OZ `Multicall` mixin (`function multicall(bytes[] calldata) external returns (bytes[] memory)`)
    // is provided directly by the implementation via inheritance — see UniswapV3StakingVault.
}
