# SPEC-0003b: Staking Vault for Uniswap V3 Positions — Implementation Spec

**Date:** 2026-05-06
**Status:** ready for implementation
**Source:** Derived from local RFC-0003 (rev. 2026-05-06).
**Audience:** Coding agent (Claude Code).

This spec describes *what* to implement. Conceptual rationale and
alternatives live in the RFC. Read the spec for code; consult the RFC
only if a concrete decision in the spec seems ambiguous.

This spec replaces SPEC-0003a in full. The changes are substantive —
different external interface, different settlement-path factoring,
different storage shape — and a clean rewrite is preferable to a
diff-style update.

---

## 1. Architecture

- **`StakingVaultFactory`** — singleton contract per chain. Deploys
  `StakingVault` clones via EIP-1167 minimal proxy.
- **`StakingVault`** — single implementation contract. Each clone wraps
  exactly one Uniswap V3 position and is bound to exactly one owner.
- **Non-transferable ownership.** The owner address is set once during
  clone initialization. Once set, it MUST NOT be mutable. No transfer
  function, no ownership token, no upgrade mechanism that could rebind it.
- **Atomic create-and-initialize.** The factory's `createVault()` MUST
  perform the clone deployment AND initialization atomically in the same
  call frame. This closes the standard EIP-1167 race-condition where a
  third party could front-run an external `initialize()` call. The
  implementation's `initialize()` SHOULD additionally revert on a second
  invocation.
- **One vault per UV3 position.** A new clone is deployed per
  `createVault()` call; once a vault has minted its UV3 position via
  `stake()`, that position lives for the vault's lifetime. Owners create
  multiple positions by deploying multiple vaults; in-vault top-ups apply
  to the existing position only.

## 2. Roles

- **Owner** — caller of the initial `stake()`. Set as the vault's `owner`
  for the vault's lifetime. Sole authorized caller of owner-only
  functions: `stakeTopUp`, `setYieldTarget`, `swap`, `flashSettle`,
  `unstake`, `claimRewards`.
- **Executor** — any external address. Calls `flashSwap()` (Cases 2/3)
  and `settle()` (Case 1) in valid states. Self-selecting; nobody is
  required to execute. Solver-network compatible: the vault offers a
  limit-order-style trade (vault dictates the exact output and a minimum
  input); the executor accepts (calls) or declines (does not call).

## 3. Storage

Per-vault clone state:

| Slot | Type | Set by | Mutability |
|---|---|---|---|
| `owner` | `address` | `initialize()` | immutable post-init |
| `pool` | `address` (IUniswapV3Pool) | initial `stake()` | immutable post-stake |
| `tokenId` | `uint256` (UV3 NFT ID) | initial `stake()` | immutable post-stake |
| `token0`, `token1` | `address` | initial `stake()` | immutable post-stake |
| `tickLower`, `tickUpper` | `int24` | initial `stake()` | immutable post-stake |
| `isToken0Quote` | `bool` | initial `stake()` | immutable post-stake |
| `stakedBase` | `uint256` (= B) | `stake()` / settlement paths | additive on stake; subtractive on settlement |
| `stakedQuote` | `uint256` (= Q) | `stake()` / settlement paths | additive on stake; subtractive on settlement |
| `yieldTarget` | `uint256` (= T) | `stake()` / `setYieldTarget()` / settlement | scaled on top-up; absolute via setter; reduced on settlement |
| `state` | `enum` | transitions | per state machine |
| `unstakeBufferBase` | `uint256` | settlement paths fill; `unstake` drains | |
| `unstakeBufferQuote` | `uint256` | settlement paths fill; `unstake` drains | |
| `rewardBufferBase` | `uint256` | settlement paths fill; `claimRewards` drains | |
| `rewardBufferQuote` | `uint256` | settlement paths fill; `claimRewards` drains | |

The `pendingBps` slot from SPEC-0003a is REMOVED. Partial close is
expressed at call time via an explicit `liquidity` parameter on the
relevant functions.

The state enum:

```solidity
enum State {
    Empty,                   // initial state, before stake()
    Staked,                  // position open
    FlashSwapInProgress,     // transient, set during flashSwap callback
    FlashSettleInProgress,   // transient, set during flashSettle callback
    Settled                  // position fully closed
}
```

## 4. State machine

Transitions:

| From | Trigger | To |
|---|---|---|
| `Empty` | `stake()` | `Staked` |
| `Staked` | `swap(liquidity < positionLiquidity, ...)` | `Staked` |
| `Staked` | `swap(liquidity == positionLiquidity, ...)` | `Settled` |
| `Staked` | `flashSwap(...)` (entry) | `FlashSwapInProgress` |
| `FlashSwapInProgress` | callback returns successfully | `Settled` (always full close) |
| `Staked` | `settle(...)` | `Settled` (always full close) |
| `Staked` | `flashSettle(liquidity, ...)` (entry) | `FlashSettleInProgress` |
| `FlashSettleInProgress` | callback returns successfully (partial) | `Staked` |
| `FlashSettleInProgress` | callback returns successfully (full) | `Settled` |

Callability matrix:

| Function | `Empty` | `Staked` | `FlashSwapInProgress` | `FlashSettleInProgress` | `Settled` |
|---|:---:|:---:|:---:|:---:|:---:|
| `initialize()` | ✓ once | — | — | — | — |
| `stake()` | ✓ | — | — | — | — |
| `stakeTopUp()` | — | ✓ | — | — | — |
| `setYieldTarget()` | — | ✓ | — | — | — |
| `quoteSwap()` (view) | always | always | always | always | always |
| `previewSettle()` (view) | always | always | always | always | always |
| `positionLiquidity()` (view) | always | always | always | always | always |
| `swap()` | — | ✓ | — | — | — |
| `flashSwap()` | — | ✓ | — | — | — |
| `settle()` | — | ✓ | — | — | — |
| `flashSettle()` | — | ✓ | — | — | — |
| `unstake()` | — | ✓ | — | — | ✓ |
| `claimRewards()` | — | ✓ | — | — | ✓ |
| `multicall()` | always (composes the above; subject to per-call state checks) |

`unstake()` and `claimRewards()` are explicitly callable in `Staked` so
that mid-lifecycle partial-settlement buffers can be drained without
waiting for full close.

## 5. Tokens and conventions

- **`base`** — the position's non-quote token. Read via `baseToken()`.
- **`quote`** — the position's quote-denominated token. Read via
  `quoteToken()`. Equals `token0` or `token1` based on
  `isToken0Quote`.
- All amounts (`B`, `Q`, `T`, buffer values, function parameters) are in
  smallest token units (no decimals normalisation).
- The vault never holds either token outside of:
  - the open UV3 position (managed by NFPM),
  - the four buffer slots,
  - the transient frame of a `flashSwap`/`flashSettle` callback (between
    push and verification).

## 6. Errors

```solidity
error AlreadyInitialized();
error NotOwner();
error WrongState();
error ZeroOwner();

error InvalidLiquidity();              // 0 or > positionLiquidity
error InvalidRecipient();              // address(0)
error InvalidCallbackTarget();         // address(0)
error DeadlineExpired();
error TokenMismatch();                 // tokenIn/tokenOut don't match case
error SlippageExceeded();              // amountInMax / amountOutMin breached

error UseSettleInsteadOfSwap();        // swap() in Case 1
error UseFlashSettleInsteadOfSwap();   // swap() in Case 4
error UseSettleInsteadOfFlashSwap();   // flashSwap() in Case 1
error UseFlashSettleInsteadOfFlashSwap(); // flashSwap() in Case 4
error UseSwapInsteadOfSettle();        // settle() in Case 2/3
error UseFlashSettleInsteadOfSettle(); // settle() in Case 4

error InsufficientReturn();            // flashSwap callback returned < amountInMin
error InsufficientBaseReturned();      // flashSettle callback returned < expectedBase
error InsufficientQuoteReturned();     // flashSettle callback returned < expectedQuote

error NothingToUnstake();              // unstakeBuffer* both zero
error NothingToClaim();                // rewardBuffer* both zero

error PoolResolutionFailed();          // factory could not derive pool address
error YieldTargetOverflow();           // Q + T overflows uint256 — would force Underwater
```

## 7. Public interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─── Parameter structs ─────────────────────────────────────────────────

struct StakeParams {
    address token0;
    address token1;
    uint24  fee;
    int24   tickLower;
    int24   tickUpper;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
}

struct TopUpParams {
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
}

// ─── Quote types ───────────────────────────────────────────────────────

enum SwapStatus {
    NotApplicable,  // state ∉ {Staked}
    NoSwapNeeded,   // Case 1 — settle() bounty path
    Executable,     // Case 2 or 3 — swap() / flashSwap() trade path
    Underwater      // Case 4 — only when T > 0; reduce T or use flashSettle()
}

struct SwapQuote {
    SwapStatus status;
    uint128    liquidity;       // current position liquidity; 0 if NotApplicable
    address    bidToken;        // 0 unless Executable; vault offers this token
    uint256    bidAmount;       // 0 unless Executable; exact at full close
    address    askToken;        // 0 unless Executable; vault demands this token
    uint256    askAmountMin;    // 0 unless Executable; minimum at full close
}

// ─── Callback interfaces ───────────────────────────────────────────────

interface IFlashSwapCallback {
    function flashSwapCallback(
        address tokenIn,
        uint256 amountInMin,
        address tokenOut,
        uint256 amountOut,
        bytes calldata data
    ) external;
}

interface IFlashSettleCallback {
    function flashSettleCallback(
        uint256 expectedBase,
        uint256 expectedQuote,
        bytes calldata data
    ) external;
}

// ─── Vault interface ───────────────────────────────────────────────────

interface IStakingVault {

    // ── Events ────────────────────────────────────────────────────────

    event Stake(
        address indexed owner,
        uint256 baseDelta,
        uint256 quoteDelta,
        uint256 yieldTargetAfter,
        uint256 indexed tokenId,
        uint128 liquidityDelta
    );
    event YieldTargetSet(
        address indexed owner,
        uint256 oldTarget,
        uint256 newTarget
    );
    event Swap(
        address indexed caller,
        address indexed recipient,
        uint128 liquidityClosed,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    );
    event FlashSwapInitiated(
        address indexed caller,
        address indexed callbackTarget,
        uint128 liquidityClosed,
        address tokenIn,
        uint256 amountInMin,
        address tokenOut,
        uint256 amountOut,
        bytes data
    );
    event Settle(
        address indexed caller,
        address indexed recipient,
        uint128 liquidityClosed,
        uint256 baseBounty,
        uint256 quoteBounty
    );
    event FlashSettleInitiated(
        address indexed owner,
        uint128 liquidity,
        address indexed callbackTarget,
        bytes data
    );
    event FlashSettle(
        address indexed owner,
        uint128 liquidityClosed,
        uint256 expectedBase,
        uint256 expectedQuote,
        uint256 baseReturned,
        uint256 quoteReturned
    );
    event Unstake(address indexed owner, uint256 base, uint256 quote);
    event ClaimRewards(address indexed owner, uint256 baseAmount, uint256 quoteAmount);

    // ── Initialization ────────────────────────────────────────────────

    function initialize(address owner) external;

    // ── Owner lifecycle ───────────────────────────────────────────────

    function stake(
        StakeParams calldata positionParams,
        bool isToken0Quote,
        uint256 yieldTarget
    ) external returns (uint256 tokenId);

    function stakeTopUp(TopUpParams calldata params) external;

    function setYieldTarget(uint256 newTarget) external;

    // ── Views ─────────────────────────────────────────────────────────

    function positionLiquidity() external view returns (uint128);

    function quoteSwap() external view returns (SwapQuote memory);

    function previewSettle() external view returns (
        bool canSettle,
        uint128 liquidity,
        uint256 baseBounty,
        uint256 quoteBounty
    );

    // ── Settlement — owner trade (Cases 2, 3) ─────────────────────────

    function swap(
        uint128 liquidity,
        address tokenIn,
        uint256 amountInMax,
        address tokenOut,
        uint256 amountOutMin,
        address recipient,
        uint256 deadline
    ) external returns (uint256 amountIn, uint256 amountOut);

    // ── Settlement — permissionless trade (Cases 2, 3) ────────────────

    function flashSwap(
        address tokenIn,
        uint256 amountInMax,
        address tokenOut,
        uint256 amountOutMin,
        address callbackTarget,
        bytes calldata data,
        uint256 deadline
    ) external returns (uint256 amountIn, uint256 amountOut);

    // ── Settlement — permissionless no-trade (Case 1) ─────────────────

    function settle(
        address recipient,
        uint256 deadline
    ) external returns (uint256 baseBounty, uint256 quoteBounty);

    // ── Settlement — owner exit with helper (any case) ────────────────

    function flashSettle(
        uint128 liquidity,
        address callbackTarget,
        bytes calldata data,
        uint256 deadline
    ) external;

    // ── Buffer drains — owner only ────────────────────────────────────

    function unstake() external;

    function claimRewards() external;

    // ── Multicall (provided by OZ Multicall mixin) ────────────────────
    // function multicall(bytes[] calldata) external returns (bytes[] memory);
}
```

## 8. `stake()` — initial mint

Owner-only, `nonReentrant`. State must be `Empty`.

```
function stake(
    StakeParams calldata p,
    bool isToken0Quote_,
    uint256 yieldTarget_
) external onlyOwner nonReentrant returns (uint256 tokenId_) {
    require(state == Empty);

    // Pull desired amounts from caller
    if (p.amount0Desired > 0)
        IERC20(p.token0).safeTransferFrom(msg.sender, this, p.amount0Desired);
    if (p.amount1Desired > 0)
        IERC20(p.token1).safeTransferFrom(msg.sender, this, p.amount1Desired);

    // Approve NFPM (forceApprove for non-zero-only tokens)
    if (p.amount0Desired > 0) IERC20(p.token0).forceApprove(npm, p.amount0Desired);
    if (p.amount1Desired > 0) IERC20(p.token1).forceApprove(npm, p.amount1Desired);

    uint128 liquidity_;
    uint256 amount0Used;
    uint256 amount1Used;
    (tokenId_, liquidity_, amount0Used, amount1Used) = npm.mint(MintParams({
        token0: p.token0, token1: p.token1, fee: p.fee,
        tickLower: p.tickLower, tickUpper: p.tickUpper,
        amount0Desired: p.amount0Desired, amount1Desired: p.amount1Desired,
        amount0Min: p.amount0Min, amount1Min: p.amount1Min,
        recipient: address(this), deadline: p.deadline
    }));

    // Reset approvals
    if (p.amount0Desired > 0) IERC20(p.token0).forceApprove(npm, 0);
    if (p.amount1Desired > 0) IERC20(p.token1).forceApprove(npm, 0);

    // Refund unconsumed
    uint256 r0 = p.amount0Desired - amount0Used;
    uint256 r1 = p.amount1Desired - amount1Used;
    if (r0 > 0) IERC20(p.token0).safeTransfer(msg.sender, r0);
    if (r1 > 0) IERC20(p.token1).safeTransfer(msg.sender, r1);

    // Persist immutable position params
    tokenId       = tokenId_;
    token0        = p.token0;
    token1        = p.token1;
    tickLower     = p.tickLower;
    tickUpper     = p.tickUpper;
    isToken0Quote = isToken0Quote_;
    yieldTarget   = yieldTarget_;

    if (isToken0Quote_) { stakedQuote = amount0Used; stakedBase = amount1Used; }
    else                { stakedQuote = amount1Used; stakedBase = amount0Used; }

    pool  = _resolvePool(p.token0, p.token1, p.fee);
    state = Staked;

    emit Stake(owner, stakedBase, stakedQuote, yieldTarget_, tokenId_, liquidity_);
    return tokenId_;
}
```

Rules:
- `(stakedBase, stakedQuote)` derived from *consumed* amounts, not desired.
- Vault balance after `stake()` exactly matches the open UV3 position;
  all four buffer slots are zero.
- `yieldTarget_ == 0` is legitimate (no bonus, fee-folding only).
- `yieldTarget_ == type(uint256).max` is the "let it run" sentinel that
  effectively disables external execution.
- `_resolvePool` calls `npm.factory().getPool(token0, token1, fee)`;
  reverts with `PoolResolutionFailed` if returned address is zero or
  the staticcall fails.

## 9. `stakeTopUp()` — additive

Owner-only, `nonReentrant`. State must be `Staked`.

```
function stakeTopUp(TopUpParams calldata p) external onlyOwner nonReentrant {
    require(state == Staked);

    if (p.amount0Desired > 0) {
        IERC20(token0).safeTransferFrom(msg.sender, this, p.amount0Desired);
        IERC20(token0).forceApprove(npm, p.amount0Desired);
    }
    if (p.amount1Desired > 0) {
        IERC20(token1).safeTransferFrom(msg.sender, this, p.amount1Desired);
        IERC20(token1).forceApprove(npm, p.amount1Desired);
    }

    (uint128 liquidityDelta, uint256 amount0Used, uint256 amount1Used) =
        npm.increaseLiquidity(IncreaseLiquidityParams({
            tokenId: tokenId,
            amount0Desired: p.amount0Desired,
            amount1Desired: p.amount1Desired,
            amount0Min: p.amount0Min,
            amount1Min: p.amount1Min,
            deadline: p.deadline
        }));

    if (p.amount0Desired > 0) IERC20(token0).forceApprove(npm, 0);
    if (p.amount1Desired > 0) IERC20(token1).forceApprove(npm, 0);

    uint256 r0 = p.amount0Desired - amount0Used;
    uint256 r1 = p.amount1Desired - amount1Used;
    if (r0 > 0) IERC20(token0).safeTransfer(msg.sender, r0);
    if (r1 > 0) IERC20(token1).safeTransfer(msg.sender, r1);

    uint256 baseAdded;
    uint256 quoteAdded;
    if (isToken0Quote) { quoteAdded = amount0Used; baseAdded = amount1Used; }
    else                { quoteAdded = amount1Used; baseAdded = amount0Used; }

    // Scale T proportionally so the implicit yield rate stays constant.
    // T_new = T_old × (Q + ΔQ) / Q, ceil-rounded. Skip if Q == 0.
    uint256 oldQ = stakedQuote;
    if (oldQ > 0 && quoteAdded > 0) {
        uint256 oldT = yieldTarget;
        uint256 newT = mulDivCeil(oldT, oldQ + quoteAdded, oldQ);
        if (newT != oldT) {
            yieldTarget = newT;
            emit YieldTargetSet(owner, oldT, newT);
        }
    }

    stakedBase  += baseAdded;
    stakedQuote += quoteAdded;

    emit Stake(owner, baseAdded, quoteAdded, yieldTarget, tokenId, liquidityDelta);
}
```

Rules:
- T-scaling uses ceiling division to avoid downward drift on repeated
  tiny top-ups.
- `Q == 0` (out-of-range-above initial stake) leaves T unchanged.
- `Stake` event in top-up mode emits the deltas.

## 10. `setYieldTarget()`

Owner-only, `nonReentrant`. State must be `Staked`.

```
function setYieldTarget(uint256 newT) external onlyOwner nonReentrant {
    require(state == Staked);
    uint256 old = yieldTarget;
    yieldTarget = newT;
    emit YieldTargetSet(owner, old, newT);
}
```

Rules:
- Any `uint256` value accepted (including `0` and `type(uint256).max`).
- This is the canonical Underwater-escape: setting `T = 0` (or any
  small enough value) converts Case 4 into Case 1, 2, or 3, making the
  position settleable again.

## 11. Case classification

Inputs at the moment of settlement:
- `(B, Q, T)` from storage.
- `(b, q)` derived from the position close (principal + fees), as
  detailed in §12.
- `frac` = `liquidity / positionLiquidity` for partial; `1` for full.
  Concretely, `targetBase = mulDiv(B, liquidity, positionLiquidity)`,
  `targetQuote = mulDiv(Q + T, liquidity, positionLiquidity)`. Use
  `mulDiv` with floor rounding.

Classification, applied in priority order (first match wins):

```
if (Q + T overflows uint256)
    → revert YieldTargetOverflow

if (b ≥ targetBase AND q ≥ targetQuote)
    → NoSwapNeeded        // Case 1

if (b ≥ targetBase)       // implies q < targetQuote
    → Executable, Case 2  // executor sends quote, receives base

if (q ≥ targetQuote)      // implies b < targetBase
    → Executable, Case 3  // executor sends base, receives quote

else
    → Underwater          // Case 4: both deficits
```

Per-case quantities:

| Case | bidToken | bidAmount | askToken | askAmountMin | tokenIn (executor pays) | tokenOut (executor receives) |
|------|----------|-----------|----------|--------------|--------------------------|-------------------------------|
| 1    | (none)   | 0         | (none)   | 0            | (n/a)                    | (n/a)                         |
| 2    | base     | b − targetBase | quote    | targetQuote − q | quote | base                  |
| 3    | quote    | q − targetQuote | base     | targetBase − b  | base  | quote                 |
| 4    | (none)   | 0         | (none)   | 0            | (revert)                 | (revert)                      |

In `quoteSwap()`, the `Underwater` overflow case returns
`(Underwater, L, 0, 0, 0, 0)` rather than reverting — overflow at view
time is informational. The settlement functions revert on overflow so
the state cannot be corrupted.

## 12. `quoteSwap()` and `previewSettle()`

Both are pure views over current state. They use the same underlying
case classification but expose different fields.

### 12.1 `quoteSwap()`

```
function quoteSwap() external view returns (SwapQuote memory) {
    if (state != Staked) {
        return SwapQuote(NotApplicable, 0, 0, 0, 0, 0);
    }

    uint128 posLiq = positionLiquidity();
    (uint256 b, uint256 q) = _expectedFreedAmounts(posLiq);

    // Q + T overflow guard — view does not revert
    unchecked {
        if (Q + T < Q) {
            return SwapQuote(Underwater, posLiq, 0, 0, 0, 0);
        }
    }

    uint256 targetBase  = B;
    uint256 targetQuote = Q + T;

    if (b >= targetBase && q >= targetQuote) {
        return SwapQuote(NoSwapNeeded, posLiq, 0, 0, 0, 0);
    }
    if (b >= targetBase /* && q < targetQuote */) {
        return SwapQuote(
            Executable, posLiq,
            baseToken(),  b - targetBase,
            quoteToken(), targetQuote - q
        );
    }
    if (q >= targetQuote /* && b < targetBase */) {
        return SwapQuote(
            Executable, posLiq,
            quoteToken(), q - targetQuote,
            baseToken(),  targetBase - b
        );
    }
    return SwapQuote(Underwater, posLiq, 0, 0, 0, 0);
}
```

Rules:
- `liquidity` always equals `positionLiquidity()` for `Staked`-state
  results; zero for `NotApplicable`.
- Bid/ask fields zero in non-`Executable` results.
- View, no state mutation.

### 12.2 `_expectedFreedAmounts(closeLiquidity)`

Internal helper. Computes what `(b, q)` the vault would hold after
closing exactly `closeLiquidity` units of the position. Returns
`(b, q)`.

```
function _expectedFreedAmounts(uint128 closeLiquidity)
    internal view
    returns (uint256 b, uint256 q)
{
    (
        ,,,,,,,
        uint128 liquidity,
        uint256 fgInside0Last,
        uint256 fgInside1Last,
        uint128 owed0,
        uint128 owed1
    ) = npm.positions(tokenId);

    uint256 amount0;
    uint256 amount1;
    if (closeLiquidity > 0 && liquidity > 0) {
        require(closeLiquidity <= liquidity);  // enforced by callers
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        uint160 lo = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 hi = TickMath.getSqrtRatioAtTick(tickUpper);
        (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96, lo, hi, closeLiquidity
        );
    }

    // Add ALL uncollected fees (collect is all-or-nothing, NOT pro-rated)
    (uint256 fees0, uint256 fees1) = LibUniswapV3Fees.uncollectedFees(
        pool, tickLower, tickUpper,
        liquidity, fgInside0Last, fgInside1Last, owed0, owed1
    );
    amount0 += fees0;
    amount1 += fees1;

    if (isToken0Quote) { q = amount0; b = amount1; }
    else                { q = amount1; b = amount0; }
}
```

The all-uncollected-fees behaviour matches SPEC-0003a §11/§13: UV3's
`collect` is all-or-nothing, so a partial close still pulls 100% of
accumulated fees on top of the proportional principal share.

### 12.3 `previewSettle()`

```
function previewSettle() external view returns (
    bool canSettle, uint128 liquidity, uint256 baseBounty, uint256 quoteBounty
) {
    if (state != Staked) return (false, 0, 0, 0);

    uint128 posLiq = positionLiquidity();
    (uint256 b, uint256 q) = _expectedFreedAmounts(posLiq);

    unchecked {
        if (Q + T < Q) return (false, posLiq, 0, 0);
    }

    if (b >= B && q >= Q + T) {
        return (true, posLiq, b - B, q - (Q + T));
    }
    return (false, posLiq, 0, 0);
}
```

Rules:
- Returns `(true, liquidity, baseBounty, quoteBounty)` exactly when
  `settle()` would succeed at this state.
- `baseBounty` and `quoteBounty` may be zero (boundary case
  `b == B AND q == Q + T`).

## 13. `swap()` — owner trade

Owner-only, `nonReentrant`. State must be `Staked`. Reverts in Cases
1 and 4 with case-specific errors.

```
function swap(
    uint128 liquidity_,
    address tokenIn,
    uint256 amountInMax,
    address tokenOut,
    uint256 amountOutMin,
    address recipient,
    uint256 deadline
) external onlyOwner nonReentrant returns (uint256 amountIn, uint256 amountOut) {
    require(state == Staked);
    require(deadline >= block.timestamp, DeadlineExpired);
    require(recipient != address(0), InvalidRecipient);

    uint128 posLiq = positionLiquidity();
    require(liquidity_ > 0 && liquidity_ <= posLiq, InvalidLiquidity);

    unchecked {
        if (Q + T < Q) revert YieldTargetOverflow();
    }

    uint256 targetBase  = mulDiv(B,     liquidity_, posLiq);
    uint256 targetQuote = mulDiv(Q + T, liquidity_, posLiq);

    address baseTok  = baseToken();
    address quoteTok = quoteToken();

    uint256 preBase  = IERC20(baseTok).balanceOf(this);
    uint256 preQuote = IERC20(quoteTok).balanceOf(this);

    _closePartial(liquidity_);

    uint256 b = IERC20(baseTok).balanceOf(this) - preBase;
    uint256 q = IERC20(quoteTok).balanceOf(this) - preQuote;

    if (b >= targetBase && q >= targetQuote) revert UseSettleInsteadOfSwap();

    if (b >= targetBase) {
        // Case 2: caller sends quote, receives base
        require(tokenIn  == quoteTok && tokenOut == baseTok,  TokenMismatch);
        amountIn  = targetQuote - q;
        amountOut = b - targetBase;
    } else if (q >= targetQuote) {
        // Case 3: caller sends base, receives quote
        require(tokenIn  == baseTok && tokenOut == quoteTok, TokenMismatch);
        amountIn  = targetBase - b;
        amountOut = q - targetQuote;
    } else {
        revert UseFlashSettleInsteadOfSwap();
    }

    require(amountIn  <= amountInMax,  SlippageExceeded);
    require(amountOut >= amountOutMin, SlippageExceeded);

    IERC20(tokenIn).safeTransferFrom(msg.sender, this, amountIn);
    IERC20(tokenOut).safeTransfer(recipient, amountOut);

    _settleBuffersAndStake(liquidity_, posLiq, preBase, preQuote);

    if (liquidity_ == posLiq) state = Settled;

    emit Swap(msg.sender, recipient, liquidity_,
              tokenIn, amountIn, tokenOut, amountOut);
    return (amountIn, amountOut);
}
```

Rules:
- `liquidity_` is in NFPM units; partial close reduces position
  proportionally.
- The `_closePartial` helper invokes `npm.decreaseLiquidity` (with
  zero `amount0Min`/`amount1Min` — slippage bound is enforced at the
  vault layer via `amountInMax`/`amountOutMin`) and `npm.collect`
  (all uncollected). See §16.1.
- Multi-call composition is supported: `[swap(small), swap(small),
  ...]` distributes the close in segments. Each call closes its
  fraction of the current `positionLiquidity` snapshot at call time.

## 14. `flashSwap()` — permissionless trade

Permissionless, no `onlyOwner`. State must be `Staked`. Reverts in
Cases 1 and 4 with case-specific errors. Always full close.

```
function flashSwap(
    address tokenIn,
    uint256 amountInMax,
    address tokenOut,
    uint256 amountOutMin,
    address callbackTarget,
    bytes calldata data,
    uint256 deadline
) external nonReentrant returns (uint256 amountIn, uint256 amountOut) {
    require(state == Staked);
    require(deadline >= block.timestamp, DeadlineExpired);
    require(callbackTarget != address(0), InvalidCallbackTarget);

    unchecked {
        if (Q + T < Q) revert YieldTargetOverflow();
    }

    uint128 posLiq = positionLiquidity();
    address baseTok  = baseToken();
    address quoteTok = quoteToken();

    uint256 preBase  = IERC20(baseTok).balanceOf(this);
    uint256 preQuote = IERC20(quoteTok).balanceOf(this);

    _closePartial(posLiq);   // full close

    uint256 b = IERC20(baseTok).balanceOf(this) - preBase;
    uint256 q = IERC20(quoteTok).balanceOf(this) - preQuote;

    uint256 targetBase  = B;
    uint256 targetQuote = Q + T;

    if (b >= targetBase && q >= targetQuote) revert UseSettleInsteadOfFlashSwap();

    address tokenInExpected;
    address tokenOutExpected;
    uint256 amountInMin;

    if (b >= targetBase) {
        // Case 2
        tokenInExpected  = quoteTok;
        tokenOutExpected = baseTok;
        amountInMin      = targetQuote - q;
        amountOut        = b - targetBase;
    } else if (q >= targetQuote) {
        // Case 3
        tokenInExpected  = baseTok;
        tokenOutExpected = quoteTok;
        amountInMin      = targetBase - b;
        amountOut        = q - targetQuote;
    } else {
        revert UseFlashSettleInsteadOfFlashSwap();
    }

    require(tokenIn  == tokenInExpected
         && tokenOut == tokenOutExpected, TokenMismatch);
    require(amountInMin <= amountInMax,  SlippageExceeded);
    require(amountOut   >= amountOutMin, SlippageExceeded);

    // Push tokenOut to callback target
    state = FlashSwapInProgress;
    emit FlashSwapInitiated(
        msg.sender, callbackTarget, posLiq,
        tokenIn, amountInMin, tokenOut, amountOut, data
    );
    IERC20(tokenOut).safeTransfer(callbackTarget, amountOut);

    // Snapshot vault's tokenIn pre-callback balance
    uint256 preTokenIn = (tokenIn == baseTok) ? preBase : preQuote;

    IFlashSwapCallback(callbackTarget).flashSwapCallback(
        tokenIn, amountInMin, tokenOut, amountOut, data
    );

    // Verify
    uint256 postTokenIn = IERC20(tokenIn).balanceOf(this) - preTokenIn;
    if (postTokenIn < amountInMin) revert InsufficientReturn();
    amountIn = postTokenIn;

    _settleBuffersAndStake(posLiq, posLiq, preBase, preQuote);

    state = Settled;
    emit Swap(msg.sender, callbackTarget, posLiq,
              tokenIn, amountIn, tokenOut, amountOut);
}
```

Rules:
- `flashSwap` is always full close. The case-derived `amountOut` is
  pushed before the callback; verification compares post-callback
  vault balance.
- Overpayment of `tokenIn` flows into the reward buffer via
  `_settleBuffersAndStake` (see §16.2).
- The case classification runs *after* the position is closed but
  *before* the token push; the `tokenIn`/`tokenOut` parameters are
  validated against the case-derived expected pair.
- The `nonReentrant` guard plus the `FlashSwapInProgress` state-lock
  jointly prevent any reentrant access. Other vault functions check
  `state == Staked` (or another valid state) and revert during
  `FlashSwapInProgress`.

## 15. `settle()` — permissionless no-trade

Permissionless. State must be `Staked`. Only succeeds in Case 1.

```
function settle(
    address recipient,
    uint256 deadline
) external nonReentrant returns (uint256 baseBounty, uint256 quoteBounty) {
    require(state == Staked);
    require(deadline >= block.timestamp, DeadlineExpired);
    require(recipient != address(0), InvalidRecipient);

    unchecked {
        if (Q + T < Q) revert YieldTargetOverflow();
    }

    uint128 posLiq = positionLiquidity();
    address baseTok  = baseToken();
    address quoteTok = quoteToken();

    uint256 preBase  = IERC20(baseTok).balanceOf(this);
    uint256 preQuote = IERC20(quoteTok).balanceOf(this);

    _closePartial(posLiq);   // full close

    uint256 b = IERC20(baseTok).balanceOf(this) - preBase;
    uint256 q = IERC20(quoteTok).balanceOf(this) - preQuote;

    if (b < B || q < Q + T) {
        // Not Case 1
        if (b < B && q < Q + T) revert UseFlashSettleInsteadOfSettle();
        revert UseSwapInsteadOfSettle();
    }

    // Buffer fill: exact (B, Q) → unstake; exact (0, T) → reward.
    unstakeBufferBase  += B;
    unstakeBufferQuote += Q;
    rewardBufferQuote  += T;

    // Bounty = surplus over (B, Q+T)
    baseBounty  = b - B;
    quoteBounty = q - (Q + T);

    if (baseBounty  > 0) IERC20(baseTok).safeTransfer(recipient, baseBounty);
    if (quoteBounty > 0) IERC20(quoteTok).safeTransfer(recipient, quoteBounty);

    // Reduce active stake to zero (full close)
    stakedBase  = 0;
    stakedQuote = 0;
    yieldTarget = 0;

    state = Settled;
    emit Settle(msg.sender, recipient, posLiq, baseBounty, quoteBounty);
}
```

Rules:
- Always full close. Partial settle is not supported.
- The function does NOT revert if `baseBounty == 0 && quoteBounty == 0`
  (boundary case where `b == B AND q == Q + T`); the position still
  settles and the caller just doesn't profit.
- The bounty mechanism replaces the SPEC-0003a "Case 3 with 5%
  discount" logic. Surplus over `(B, Q+T)` goes to the caller as
  bounty rather than to the owner via reward buffer.

## 16. `flashSettle()` — owner exit with helper

Owner-only, `nonReentrant`. State must be `Staked`. Helper receives
the freed `(b, q)` and must return at least `(B × frac, (Q+T) × frac)`.

```
function flashSettle(
    uint128 liquidity_,
    address callbackTarget,
    bytes calldata data,
    uint256 deadline
) external onlyOwner nonReentrant {
    require(state == Staked);
    require(deadline >= block.timestamp, DeadlineExpired);
    require(callbackTarget != address(0), InvalidCallbackTarget);

    uint128 posLiq = positionLiquidity();
    require(liquidity_ > 0 && liquidity_ <= posLiq, InvalidLiquidity);

    unchecked {
        if (Q + T < Q) revert YieldTargetOverflow();
    }

    uint256 expectedBase  = mulDiv(B,     liquidity_, posLiq);
    uint256 expectedQuote = mulDiv(Q + T, liquidity_, posLiq);

    address baseTok  = baseToken();
    address quoteTok = quoteToken();

    uint256 preBase  = IERC20(baseTok).balanceOf(this);
    uint256 preQuote = IERC20(quoteTok).balanceOf(this);

    _closePartial(liquidity_);

    uint256 freedBase  = IERC20(baseTok).balanceOf(this)  - preBase;
    uint256 freedQuote = IERC20(quoteTok).balanceOf(this) - preQuote;

    state = FlashSettleInProgress;
    emit FlashSettleInitiated(owner, liquidity_, callbackTarget, data);

    if (freedBase  > 0) IERC20(baseTok).safeTransfer(callbackTarget,  freedBase);
    if (freedQuote > 0) IERC20(quoteTok).safeTransfer(callbackTarget, freedQuote);

    IFlashSettleCallback(callbackTarget).flashSettleCallback(
        expectedBase, expectedQuote, data
    );

    uint256 postBase  = IERC20(baseTok).balanceOf(this)  - preBase;
    uint256 postQuote = IERC20(quoteTok).balanceOf(this) - preQuote;

    if (postBase  < expectedBase)  revert InsufficientBaseReturned();
    if (postQuote < expectedQuote) revert InsufficientQuoteReturned();

    // Buffer fill — same accounting pattern as the trade paths.
    uint256 unstakeBaseDelta  = mulDiv(B, liquidity_, posLiq);
    uint256 unstakeQuoteDelta = mulDiv(Q, liquidity_, posLiq);

    unstakeBufferBase  += unstakeBaseDelta;
    unstakeBufferQuote += unstakeQuoteDelta;
    rewardBufferBase   += postBase  - unstakeBaseDelta;
    rewardBufferQuote  += postQuote - unstakeQuoteDelta;

    stakedBase  -= unstakeBaseDelta;
    stakedQuote -= unstakeQuoteDelta;
    yieldTarget -= mulDiv(T, liquidity_, posLiq);

    state = (liquidity_ == posLiq) ? Settled : Staked;

    emit FlashSettle(owner, liquidity_,
                     expectedBase, expectedQuote,
                     postBase, postQuote);
}
```

Rules:
- The freed `(b, q)` from the close are pushed to the callback. The
  callback returns at least `(expectedBase, expectedQuote)`. Any
  overpayment flows to `rewardBuffer*` and is owed to the owner via
  `claimRewards()`.
- This is NOT a swap. The helper might internally swap, top up, or
  do nothing depending on the case. The vault interface only sees
  push and verification.
- No auto-drain. Owner calls `unstake()` and `claimRewards()`
  separately. Multicall composition is supported for one-tx
  ergonomics.
- `liquidity_ == posLiq` transitions to `Settled`. Otherwise back to
  `Staked` with reduced principal and target.

### 16.1 `_closePartial(liquidity)`

Internal helper used by all four settlement paths. Burns `liquidity`
units of the position and collects all uncollected fees.

```
function _closePartial(uint128 liquidity_) internal {
    require(liquidity_ > 0);
    npm.decreaseLiquidity(DecreaseLiquidityParams({
        tokenId: tokenId,
        liquidity: liquidity_,
        amount0Min: 0,
        amount1Min: 0,
        deadline: block.timestamp
    }));
    npm.collect(CollectParams({
        tokenId: tokenId,
        recipient: address(this),
        amount0Max: type(uint128).max,
        amount1Max: type(uint128).max
    }));
}
```

Rules:
- Pool slippage at the NFPM level is intentionally unprotected
  (`amount0Min = amount1Min = 0`); slippage is enforced at the vault
  layer via the function's `amountInMax`/`amountOutMin` parameters or
  (for `flashSettle`) via the helper's own logic.
- `collect` always pulls all owed amounts; the vault then classifies
  on the freed delta.

### 16.2 `_settleBuffersAndStake(liquidity_, posLiq, preBase, preQuote)`

Internal helper used by `swap()` and `flashSwap()` to fill buffers
and reduce active stake after a successful trade.

```
function _settleBuffersAndStake(
    uint128 liquidity_,
    uint128 posLiq,
    uint256 preBase,
    uint256 preQuote
) internal {
    address baseTok  = baseToken();
    address quoteTok = quoteToken();

    uint256 newFreeBase  = IERC20(baseTok).balanceOf(this)  - preBase;
    uint256 newFreeQuote = IERC20(quoteTok).balanceOf(this) - preQuote;

    uint256 unstakeBaseDelta  = mulDiv(B, liquidity_, posLiq);
    uint256 unstakeQuoteDelta = mulDiv(Q, liquidity_, posLiq);

    unstakeBufferBase  += unstakeBaseDelta;
    unstakeBufferQuote += unstakeQuoteDelta;
    rewardBufferBase   += newFreeBase  - unstakeBaseDelta;
    rewardBufferQuote  += newFreeQuote - unstakeQuoteDelta;

    stakedBase  -= unstakeBaseDelta;
    stakedQuote -= unstakeQuoteDelta;
    yieldTarget -= mulDiv(T, liquidity_, posLiq);
}
```

Rules:
- `newFreeBase` and `newFreeQuote` are the post-trade deltas, after
  the executor's `tokenIn` has been pulled in and `tokenOut` has been
  paid out. By case construction, both increments are
  `≥ unstake*Delta`.
- The reward-buffer increments may include executor overpayment in
  Case 2 (extra quote) or Case 3 (extra base), plus all uncollected
  fees from the position close.

## 17. `unstake()` and `claimRewards()`

Owner-only, `nonReentrant`. State must be `Staked` or `Settled`.

```
function unstake() external onlyOwner nonReentrant {
    require(state == Staked || state == Settled);
    uint256 ub = unstakeBufferBase;
    uint256 uq = unstakeBufferQuote;
    require(ub > 0 || uq > 0, NothingToUnstake);

    unstakeBufferBase  = 0;
    unstakeBufferQuote = 0;

    if (ub > 0) IERC20(baseToken()).safeTransfer(owner, ub);
    if (uq > 0) IERC20(quoteToken()).safeTransfer(owner, uq);
    emit Unstake(owner, ub, uq);
}

function claimRewards() external onlyOwner nonReentrant {
    require(state == Staked || state == Settled);
    uint256 rb = rewardBufferBase;
    uint256 rq = rewardBufferQuote;
    require(rb > 0 || rq > 0, NothingToClaim);

    rewardBufferBase  = 0;
    rewardBufferQuote = 0;

    if (rb > 0) IERC20(baseToken()).safeTransfer(owner, rb);
    if (rq > 0) IERC20(quoteToken()).safeTransfer(owner, rq);
    emit ClaimRewards(owner, rb, rq);
}
```

Rules:
- Both follow checks-effects-interactions (zero buffers before
  transfer).
- Both can be called multiple times across the vault's lifetime,
  once per fill cycle.

## 18. `multicall()`

Use OpenZeppelin's `Multicall` mixin (existing project dependency). No
modifications. Per-function state checks remain authoritative — the
multicall layer does not bypass them.

**Implementation note for EIP-1167 clones.** OZ `Multicall` uses
`address(this).delegatecall(...)`. With a minimal proxy, this means:
outer call → clone delegatecalls implementation → multicall does
`address(this).delegatecall` on the inner data, which hits the clone
(again), which delegatecalls implementation. Each inner call thus
incurs an additional delegatecall hop. Functionally correct but
slightly more gas per inner call than non-proxied multicall.

Useful compositions:
- `[stakeTopUp, setYieldTarget]` — owner adds capital and re-anchors
  the yield rate atomically.
- `[swap, swap]` — owner partial-closes in segments.
- `[flashSettle, unstake, claimRewards]` — owner exits with helper
  and immediately drains.
- `[swap, unstake, claimRewards]` — owner self-executes a swap and
  immediately drains.

## 19. Event order summary

For each settlement path, the canonical event sequence within a
successful single-tx call:

| Path | Events |
|------|--------|
| `swap()` | `Swap` |
| `flashSwap()` | `FlashSwapInitiated` → (callback runs) → `Swap` |
| `settle()` | `Settle` |
| `flashSettle()` | `FlashSettleInitiated` → (callback runs) → `FlashSettle` |
| `unstake()` | `Unstake` |
| `claimRewards()` | `ClaimRewards` |

`Swap` is shared between `swap()` and `flashSwap()`. The
distinguisher for indexers is the presence of `FlashSwapInitiated` in
the same tx for the flashSwap path.

## 20. Invariants

For all reachable states:

1. `unstakeBufferBase + remainingPositionBase ≥ stakedBase`
   (where `remainingPositionBase` is the principal still held by the
   open UV3 position).
2. Analogously for quote.
3. `yieldTarget` is monotonically non-increasing across settlements
   (T scales down with closures; the only way T grows is via top-up
   or `setYieldTarget`).
4. `state == Settled` ⇒ `positionLiquidity() == 0`.
5. `state == Settled` ⇒ no further `swap`/`flashSwap`/`settle`/
   `flashSettle` calls possible.
6. `state ∈ {FlashSwapInProgress, FlashSettleInProgress}` ⇒ all
   non-callback-completion entry points revert.
7. `unstakeBufferBase + unstakeBufferQuote == 0` immediately after
   `unstake()` completes (until refilled).
8. `rewardBufferBase + rewardBufferQuote == 0` immediately after
   `claimRewards()` completes (until refilled).

## 21. Out of scope (do not implement)

- No `cancelStake()` or any path from `Staked` back to `Empty`.
- No ownership transfer of any kind.
- No upgradability / proxy admin / migration of clones.
- No range adjustment after initial `stake()` (no changes to
  `tickLower`, `tickUpper`, no reposition). Top-up only adds liquidity
  to the existing range.
- No fee-only collection without close (fees are absorbed into
  settlement; no separate `harvest()`).
- No multi-position-per-vault.
- No cross-chain logic. Single chain per deployment.
- No external price oracle (Chainlink, etc.); no pool TWAP either —
  the swap mechanic uses no oracle at all.
- No 5%-discount Case-3 mechanic from SPEC-0003a (replaced by
  bounty in `settle()`).
- No two-step swap mechanic from SPEC-0003a (no `PrincipalSwapped`
  state, no persisted `t_base`).
- No `pendingBps` slot from SPEC-0003a.
- No Uniswap V4 hooks.
- No NFT burning after settlement.
- No CoW / solver-network adapter — handled by a separate downstream
  contract that wraps `flashSwap()`.
- No automatic yield-rate re-anchoring on `setYieldTarget`.

## 22. Testing — coverage targets

### Initialization and stake
- `initialize()` reverts on second call.
- `initialize(address(0))` reverts.
- Factory `createVault()` is atomic (cannot be front-run between
  deploy and initialize).
- `stake()` from non-`Empty` state reverts.
- `stake()` from non-owner reverts.
- `stake()` refunds unconsumed amounts.
- Initial-stake `Stake` event includes correct `liquidityDelta`
  matching the freshly-minted position liquidity.

### Top-up
- `stakeTopUp()` from `Empty` reverts.
- `stakeTopUp()` adds correctly to `(B, Q)`.
- T scales correctly: `T_new ≈ T_old × (Q + ΔQ) / Q`, with ceiling
  rounding.
- Top-up with `Q == 0` (initial out-of-range above) leaves T
  unchanged.
- Top-up out-of-range: one side fully refunded.
- Top-up `Stake` event has `liquidityDelta` equal to the increase,
  not the cumulative.

### setYieldTarget
- Settable in `Staked`; reverts in any other state.
- Setting `T = 0` converts an Underwater position back to a
  settle-able case (Case 1, 2, or 3).

### quoteSwap / previewSettle
- `state != Staked` returns `NotApplicable` / `(false, ...)`.
- Case 1 → `NoSwapNeeded` / `(true, L, baseBounty, quoteBounty)`.
- Case 2 → `Executable` with `bidToken == base, askToken == quote`.
- Case 3 → `Executable` with `bidToken == quote, askToken == base`.
- Case 4 → `Underwater` / `(false, L, 0, 0)`.
- `Q + T` overflow → `Underwater` / `(false, L, 0, 0)`.
- Boundary: `b == B && q == Q + T` → Case 1 with zero bounty.
- Liquidity field always equals `positionLiquidity()` for any
  Staked-state result.

### swap (Cases 2, 3)
- Case 2 with `liquidity == positionLiquidity` → `Settled`.
- Case 2 with `liquidity < positionLiquidity` → `Staked` with
  reduced `(B, Q, T)` and `positionLiquidity()` reduced by exactly
  `liquidity`.
- Case 3 analogously.
- `tokenIn`/`tokenOut` mismatch → `TokenMismatch`.
- `amountInMax` exceeded → `SlippageExceeded`.
- `amountOutMin` not met → `SlippageExceeded`.
- `recipient == address(0)` → `InvalidRecipient`.
- `liquidity == 0` → `InvalidLiquidity`.
- `liquidity > positionLiquidity()` → `InvalidLiquidity`.
- `deadline` expired → `DeadlineExpired`.
- Case 1 → `UseSettleInsteadOfSwap`.
- Case 4 → `UseFlashSettleInsteadOfSwap`.
- Two consecutive partial swaps yield correctly summed buffers.
- Non-owner caller → `NotOwner`.

### flashSwap (Cases 2, 3)
- Case 2 success: callback returns `≥ amountInMin`, vault settles,
  state → `Settled`, `Swap` event emitted.
- Case 3 success analogously.
- Callback returns < `amountInMin` → `InsufficientReturn`.
- Callback reverts → outer revert.
- Callback tries to call back into vault → revert (via state-lock
  AND `nonReentrant`).
- `tokenIn`/`tokenOut` mismatch → `TokenMismatch`.
- `amountInMax` ≥ amountInMin enforced at boundary.
- `callbackTarget == address(0)` → `InvalidCallbackTarget`.
- Case 1 → `UseSettleInsteadOfFlashSwap`.
- Case 4 → `UseFlashSettleInsteadOfFlashSwap`.
- Permissionless: any address can call.
- Overpayment flows to `rewardBuffer{quoteIfCase2,baseIfCase3}`.

### settle (Case 1)
- Case 1 success: bounty paid to recipient, buffers filled with
  exact `(B, Q, T)`, state → `Settled`.
- Boundary case `b == B && q == Q + T` succeeds with zero bounty.
- Case 2 → `UseSwapInsteadOfSettle`.
- Case 3 → `UseSwapInsteadOfSettle`.
- Case 4 → `UseFlashSettleInsteadOfSettle`.
- `recipient == address(0)` → `InvalidRecipient`.
- `deadline` expired → `DeadlineExpired`.
- Permissionless: any address can call.
- `previewSettle()` agrees with what `settle()` would do.

### flashSettle (any case)
- Case 1: callback may return exactly `(B × frac, (Q+T) × frac)`;
  surplus flows to reward buffer.
- Case 2: callback receives base-heavy freed amount, returns
  expected target; quote deficit covered from external source.
- Case 3: callback receives quote-heavy freed amount, returns
  expected target; base deficit covered from external source.
- Case 4: callback receives below-target freed amount, must cover
  both deficits.
- Overpayment in any case flows to `rewardBuffer*`.
- Underpayment on base → `InsufficientBaseReturned`.
- Underpayment on quote → `InsufficientQuoteReturned`.
- `liquidity == 0` or `> positionLiquidity()` → `InvalidLiquidity`.
- `callbackTarget == address(0)` → `InvalidCallbackTarget`.
- `liquidity == positionLiquidity()` transitions to `Settled`.
- `liquidity < positionLiquidity()` returns to `Staked` with
  reduced state.
- Reentrancy: callback that re-enters vault → revert.
- No auto-drain: buffers remain filled after `flashSettle` returns.
- Non-owner caller → `NotOwner`.

### Buffer drain
- `unstake()` drains `unstakeBuffer*` and zeroes the slots.
- `claimRewards()` drains `rewardBuffer*` and zeroes the slots.
- Both callable in `Staked` (mid-lifecycle) and `Settled`.
- Both revert if the relevant buffer is empty.
- Both can be called multiple times across the lifecycle.
- Owner sums to `Σ(stake deposits) + Σ(rewards)` minus
  dust/rounding.

### Reentrancy and token quirks
- `nonReentrant` blocks re-entry into the same function.
- All vault functions revert when called during
  `FlashSwapInProgress` or `FlashSettleInProgress`.
- ERC-777 / fee-on-transfer reentrancy attempt against any function
  reverts.

### Multicall
- `[stakeTopUp, setYieldTarget]` works atomically.
- `[swap, swap]` partial-segments work.
- `[flashSettle, unstake, claimRewards]` works atomically.
- `[swap, unstake, claimRewards]` works atomically.
- Per-call state checks NOT bypassed by multicall.

### Underwater scenarios
- Case 4 (`b < B AND q < Q + T`) classified correctly.
- Setting `T = 0` from Underwater converts to Case 1, 2, or 3.
- `flashSettle` from Underwater succeeds with adequate helper
  funding.

---

**End of spec.** Reach back to RFC-0003 only for clarification on the
*why* of a decision; the *what* is fully specified here.
