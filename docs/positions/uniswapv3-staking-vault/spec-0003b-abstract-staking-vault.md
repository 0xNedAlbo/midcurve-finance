# SPEC-0003b: Abstract Staking Vault for Uniswap V3 Positions

**Date:** 2026-05-07
**Status:** ready for implementation
**Audience:** Coding agent (Claude Code)
**Note:** Replaces SPEC-0003b (rev 2026-05-06). This rewrite restructures the staking vault into an abstract base contract plus concrete subclasses, and conforms to the Coding-Spec-Konvention in `docs/rfc-process.md`.

## Summary

The staking vault is split into an abstract base class (`AbstractStakingVault`) that defines all owner-side state, owner-only entry points, internal accounting, and views — and concrete subclasses that extend it with permissionless settlement strategies. The base class plus a trivial concrete `ManualStakingVault` (no automation, owner is the only settlement actor) are the subject of this spec. Subclasses with permissionless paths (`KeeperStakingVault`, future `CowStakingVault`) are specified separately.

## Context

The prior SPEC-0003b defined a single concrete contract that bundled owner-only paths and permissionless `flashSwap` / `settle` paths. That coupling makes it impossible to deploy a no-automation vault without dragging in keeper logic, and impossible to add alternative settlement strategies (e.g., ERC-1271-based CoW Protocol orders) without modifying the vault itself. RFC-0003 motivates the split. This spec realizes it.

The owner-side contract — what the protocol guarantees to a position owner — lives entirely in the base. Subclasses extend with strategy-specific permissionless paths but cannot alter the owner-side contract. This spec defines the base contract and the trivial concrete `ManualStakingVault` subclass, which makes the base instantiable without adding any logic.

## Specification

### 1. Architecture

`AbstractStakingVault` is an abstract base contract. It implements all owner-side state, owner-only entry points, internal accounting, and views. It cannot be deployed directly — the abstract `kindLabel()` function (§7.11) enforces this at compile time.

`ManualStakingVault` is a trivial concrete subclass that implements only `kindLabel()`. It adds zero logic. This is the canonical no-automation deployment: the owner is the sole settlement actor, no permissionless settlement paths exist. It also serves as the reference vault for the base test suite.

Future concrete subclasses (`KeeperStakingVault`, `CowStakingVault`) extend `AbstractStakingVault` directly with permissionless settlement strategies. They are parallel siblings, not a chain — there is no Manual → Keeper → Cow inheritance.

```
AbstractStakingVault          (this spec, abstract)
├── ManualStakingVault        (this spec, trivial concrete)
├── KeeperStakingVault        (SPEC-0003c, adds executeSwap/executeSettle)
└── CowStakingVault           (deferred, ERC-1271 + ConditionalOrder)
```

Ownership is non-transferable. The owner address is set once during clone initialization. Once set, it MUST NOT be mutable. No transfer function, no ownership token, no upgrade mechanism that could rebind it.

One vault per UV3 position. A new clone is deployed per `createVault*()` call on the factory; once a vault has minted its UV3 position via `stake()`, that position lives for the vault's lifetime.

The factory deployment model assumes only that the factory deploys clones via EIP-1167 minimal proxy and atomically calls `initialize(owner)` in the same call frame as the clone deployment. The implementation's `initialize()` MUST revert on a second invocation. The factory itself is specified separately in `spec-0003d-vault-implementation-registry.md`.

### 2. Roles

The base spec defines exactly one role:

**Owner** — caller of `initialize()` (via the factory) and the sole authorized caller of all owner-only functions: `stake`, `increaseStake`, `setYieldTarget`, `swap`, `settle`, `unstake`, `claimRewards`. Set as the vault's `owner` for the vault's lifetime.

Permissionless actors (keepers, solvers) are introduced by subclasses via their own `execute*` functions and have no entry points into the base.

### 3. Storage

Per-vault clone state defined by `AbstractStakingVault`:

| Slot | Type | Set by | Mutability |
|---|---|---|---|
| `owner` | `address` | `initialize()` | immutable post-init |
| `pool` | `address` | initial `stake()` | immutable post-stake |
| `tokenId` | `uint256` | initial `stake()` | immutable post-stake |
| `token0`, `token1` | `address` | initial `stake()` | immutable post-stake |
| `tickLower`, `tickUpper` | `int24` | initial `stake()` | immutable post-stake |
| `isToken0Quote` | `bool` | initial `stake()` | immutable post-stake |
| `stakedBase` (= B) | `uint256` | `stake` / `increaseStake` / settlement | additive on stake/increaseStake; subtractive on settlement |
| `stakedQuote` (= Q) | `uint256` | `stake` / `increaseStake` / settlement | additive on stake/increaseStake; subtractive on settlement |
| `yieldTarget` (= T) | `uint256` | `stake` / `setYieldTarget` / `increaseStake` / settlement | scaled on increaseStake; absolute via setter; reduced on settlement |
| `state` | `uint8` | transitions | per state machine |
| `unstakeBufferBase` | `uint256` | settlement paths fill; `unstake` drains | |
| `unstakeBufferQuote` | `uint256` | settlement paths fill; `unstake` drains | |
| `rewardBufferBase` | `uint256` | settlement paths fill; `claimRewards` drains | |
| `rewardBufferQuote` | `uint256` | settlement paths fill; `claimRewards` drains | |

State is `uint8` rather than `enum` to allow subclass extension. The base defines three values as constants:

| Constant | Value |
|---|---|
| `STATE_EMPTY` | 0 |
| `STATE_STAKED` | 1 |
| `STATE_SETTLED` | 2 |

Subclasses may define additional values starting at 3. Storage layout is constrained per §10.

### 4. State machine

Transitions defined by the base:

| From | Trigger | To |
|---|---|---|
| `EMPTY` | `stake()` | `STAKED` |
| `STAKED` | `swap(liquidity < positionLiquidity, ...)` | `STAKED` |
| `STAKED` | `swap(liquidity == positionLiquidity, ...)` | `SETTLED` |
| `STAKED` | `settle(liquidity < positionLiquidity, ...)` | `STAKED` |
| `STAKED` | `settle(liquidity == positionLiquidity, ...)` | `SETTLED` |

The base has no transient states. Subclasses that introduce callback-based permissionless paths add their own transient states (e.g., `STATE_EXECUTE_SWAP_IN_PROGRESS = 3`). Base functions check for `STATE_STAKED` strictly, so subclass transient states naturally block base entry points.

Callability matrix for base functions:

| Function | `EMPTY` | `STAKED` | `SETTLED` |
|---|:---:|:---:|:---:|
| `initialize` | ✓ once | — | — |
| `stake` | ✓ | — | — |
| `increaseStake` | — | ✓ | — |
| `setYieldTarget` | — | ✓ | — |
| `quoteSwap`, `quoteSettle`, `positionLiquidity`, `kindLabel`, `baseToken`, `quoteToken` | always | always | always |
| `swap` | — | ✓ | — |
| `settle` | — | ✓ | — |
| `unstake` | — | ✓ | ✓ |
| `claimRewards` | — | ✓ | ✓ |
| `multicall` | always (composes the above; per-call state checks apply) |

`unstake` and `claimRewards` are explicitly callable in `STAKED` so that mid-lifecycle partial-settlement buffers can be drained without waiting for full close.

### 5. Errors

```
// Initialization and access control
AlreadyInitialized
NotOwner
WrongState
ZeroOwner

// Parameter validation
InvalidLiquidity              // 0 or > positionLiquidity
InvalidRecipient              // address(0)
DeadlineExpired
TokenMismatch                 // tokenIn/tokenOut don't match the case
SlippageExceeded              // amountInMax / amountOutMin breached

// Case-routing errors
UseSettleInsteadOfSwap        // swap() in Case 1
UseSwapInsteadOfSettle        // settle() in Case 2/3
UnderwaterReduceYieldTarget   // swap() or settle() in Case 4

// Buffer drains
NothingToUnstake              // both unstakeBuffer slots zero
NothingToClaim                // both rewardBuffer slots zero

// Pool resolution
PoolResolutionFailed          // factory could not derive pool address

// Yield target
YieldTargetOverflow           // Q + T overflows uint256
```

Subclasses MAY define additional errors for their `execute*` paths but MUST NOT redefine or shadow the errors above.

### 6. Public interface

Function signatures defined by `AbstractStakingVault`, grouped by purpose. Bodies are specified per function in §7. Parameter struct definitions are in §6.1.

```
// Initialization
function initialize(address owner) external

// Identity
function kindLabel() external pure returns (bytes32)

// Owner lifecycle
function stake(StakeParams calldata p, bool isToken0Quote, uint256 yieldTarget)
    external returns (uint256 tokenId)
function increaseStake(IncreaseStakeParams calldata p) external
function setYieldTarget(uint256 newTarget) external

// Views
function positionLiquidity() external view returns (uint128)
function quoteSwap() external view returns (SwapQuote memory)
function quoteSettle() external view
    returns (bool canSettle, uint128 liquidity, uint256 baseSurplus, uint256 quoteSurplus)
function baseToken() external view returns (address)
function quoteToken() external view returns (address)

// Settlement — owner trade (Cases 2, 3)
function swap(
    uint128 liquidity, address tokenIn, uint256 amountInMax,
    address tokenOut, uint256 amountOutMin, address recipient, uint256 deadline
) external returns (uint256 amountIn, uint256 amountOut)

// Settlement — owner no-trade (Case 1)
function settle(uint128 liquidity, uint256 deadline)
    external returns (uint256 baseSurplus, uint256 quoteSurplus)

// Buffer drains
function unstake() external
function claimRewards() external

// Multicall (OpenZeppelin Multicall mixin)
function multicall(bytes[] calldata) external returns (bytes[] memory)
```

#### 6.1 Parameter and view structs

```
struct StakeParams {
    address token0
    address token1
    uint24  fee
    int24   tickLower
    int24   tickUpper
    uint256 amount0Desired
    uint256 amount1Desired
    uint256 amount0Min
    uint256 amount1Min
    uint256 deadline
}

struct IncreaseStakeParams {
    uint256 amount0Desired
    uint256 amount1Desired
    uint256 amount0Min
    uint256 amount1Min
    uint256 deadline
}

enum SwapStatus {
    NotApplicable,   // state != STAKED
    NoSwapNeeded,    // Case 1 — settle() path
    Executable,      // Case 2 or 3 — swap() path
    Underwater       // Case 4 — only when T > 0; reduce T via setYieldTarget()
}

struct SwapQuote {
    SwapStatus status
    uint128    liquidity        // current position liquidity; 0 if NotApplicable
    address    bidToken         // 0 unless Executable
    uint256    bidAmount        // 0 unless Executable; exact at full close
    address    askToken         // 0 unless Executable
    uint256    askAmountMin     // 0 unless Executable; minimum at full close
}
```

#### 6.2 Events

```
Stake(address indexed owner, uint256 baseDelta, uint256 quoteDelta,
      uint256 yieldTargetAfter, uint256 indexed tokenId, uint128 liquidityDelta)

YieldTargetSet(address indexed owner, uint256 oldTarget, uint256 newTarget)

Swap(address indexed caller, address indexed recipient, uint128 liquidityClosed,
     address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut)

Settle(address indexed caller, uint128 liquidityClosed,
       uint256 baseSurplus, uint256 quoteSurplus)

Unstake(address indexed owner, uint256 base, uint256 quote)
ClaimRewards(address indexed owner, uint256 baseAmount, uint256 quoteAmount)
```

`Stake` is emitted by both `stake` and `increaseStake`; the distinguisher is the implicit state transition (`EMPTY → STAKED` for initial; `STAKED → STAKED` for incremental).

### 7. Function behavior

#### 7.1 `initialize(address owner)`

**Caller:** factory (in same call frame as clone deployment).
**State precondition:** never called before on this clone.
**Reentrancy:** none (one-shot).

**Preconditions:**
- `owner != address(0)` else `ZeroOwner`.
- Not previously initialized else `AlreadyInitialized`.

**Effects:**
1. Set `owner` storage slot.
2. Set `state = STATE_EMPTY`.
3. Mark initialized (one-shot guard).

**Events:** none.
**Returns:** none.

#### 7.2 `stake(p, isToken0Quote, yieldTarget) → tokenId`

**Caller:** Owner.
**State precondition:** `STATE_EMPTY`.
**Reentrancy:** `nonReentrant`.

**Preconditions:**
- `msg.sender == owner` else `NotOwner`.
- `state == STATE_EMPTY` else `WrongState`.
- `p.deadline >= block.timestamp` else `DeadlineExpired` (enforced by NFPM but should be checked early).
- Pool can be resolved from `(token0, token1, fee)` else `PoolResolutionFailed`.

**Effects:**
1. Pull `p.amount0Desired` of `p.token0` and `p.amount1Desired` of `p.token1` from owner (skipping zero-amount sides).
2. Approve NFPM for the pulled amounts.
3. Mint UV3 position via NFPM, recipient = vault. Capture returned `(tokenId_, liquidity_, amount0Used, amount1Used)`.
4. Reset NFPM approvals to zero.
5. Refund any unconsumed amounts (`amount*Desired - amount*Used`) to owner.
6. Persist immutable position parameters: `tokenId`, `token0`, `token1`, `tickLower`, `tickUpper`, `isToken0Quote`, `pool`.
7. Set `yieldTarget = yieldTarget`.
8. Set `stakedBase` and `stakedQuote` from consumed amounts according to `isToken0Quote`.
9. Set `state = STATE_STAKED`.
10. Emit `Stake(owner, stakedBase, stakedQuote, yieldTarget, tokenId, liquidity_)`.
11. Invoke `_afterStake(tokenId, liquidity_)`.

**Events:** `Stake`.
**Returns:** `tokenId_`.

**Notes:**
- `(stakedBase, stakedQuote)` is derived from *consumed* amounts (`amount0Used`, `amount1Used`), not desired.
- `yieldTarget == 0` is legitimate (no bonus, fee-folding only).
- `yieldTarget == type(uint256).max` is the "let it run" sentinel.
- `_afterStake` is called *after* state transition and *after* event emission; revert in hook reverts the entire stake call.

#### 7.3 `increaseStake(p)`

**Caller:** Owner.
**State precondition:** `STATE_STAKED`.
**Reentrancy:** `nonReentrant`.

**Preconditions:**
- `msg.sender == owner` else `NotOwner`.
- `state == STATE_STAKED` else `WrongState`.

**Effects:**
1. Pull `p.amount0Desired` of `token0` and `p.amount1Desired` of `token1` from owner (skipping zero-amount sides). Approve NFPM.
2. Call NFPM `increaseLiquidity` for the existing `tokenId`. Capture `(liquidityDelta, amount0Used, amount1Used)`.
3. Reset NFPM approvals to zero.
4. Refund any unconsumed amounts to owner.
5. Compute `baseAdded`, `quoteAdded` from `(amount0Used, amount1Used)` and `isToken0Quote`.
6. If `stakedQuote > 0` and `quoteAdded > 0`, scale yield target: `T_new = ceil(T_old × (Q + quoteAdded) / Q)`. If `T_new != T_old`, set `yieldTarget = T_new` and emit `YieldTargetSet(owner, T_old, T_new)`.
7. Update `stakedBase += baseAdded`, `stakedQuote += quoteAdded`.
8. Emit `Stake(owner, baseAdded, quoteAdded, yieldTarget, tokenId, liquidityDelta)`.
9. Invoke `_afterStake(tokenId, liquidityDelta)`.

**Events:** `Stake`; optionally `YieldTargetSet` if T changes.
**Returns:** none.

**Notes:**
- T-scaling uses ceiling division to avoid downward drift on repeated tiny increases.
- `Q == 0` (initial out-of-range above) leaves T unchanged, regardless of `quoteAdded`.
- `Stake` event in increase mode emits the deltas, not cumulative values.
- `_afterStake` is invoked with `liquidityDelta` (newly added), not cumulative liquidity.

#### 7.4 `setYieldTarget(newT)`

**Caller:** Owner.
**State precondition:** `STATE_STAKED`.
**Reentrancy:** `nonReentrant`.

**Preconditions:**
- `msg.sender == owner` else `NotOwner`.
- `state == STATE_STAKED` else `WrongState`.

**Effects:**
1. Save old `T`.
2. Set `yieldTarget = newT`.
3. Emit `YieldTargetSet(owner, oldT, newT)`.

**Events:** `YieldTargetSet`.
**Returns:** none.

**Notes:**
- Any `uint256` value accepted, including `0` and `type(uint256).max`.
- `T = 0` is the canonical Underwater-escape: converts Case 4 into Case 1, 2, or 3.

#### 7.5 `quoteSwap() → SwapQuote`

**Caller:** anyone.
**State precondition:** any.
**Reentrancy:** view, none.

**Effects:** none (view).

**Returns:** a `SwapQuote` struct populated as follows:
- If `state != STATE_STAKED`: `(NotApplicable, 0, 0, 0, 0, 0)`.
- If `Q + T` overflows `uint256`: `(Underwater, posLiq, 0, 0, 0, 0)`. View does not revert on overflow.
- Otherwise compute `(b, q) = _expectedFreedAmounts(posLiq)`, `targetBase = B`, `targetQuote = Q + T`, then classify (§8) and populate per-case fields.

#### 7.6 `quoteSettle() → (canSettle, liquidity, baseSurplus, quoteSurplus)`

**Caller:** anyone.
**State precondition:** any.
**Reentrancy:** view, none.

**Effects:** none (view).

**Returns:**
- `(false, 0, 0, 0)` if `state != STATE_STAKED`.
- `(false, posLiq, 0, 0)` if `Q + T` overflows.
- `(true, posLiq, b - B, q - (Q + T))` if classification (§8 with `liquidity = posLiq`) is Case 1.
- `(false, posLiq, 0, 0)` otherwise.

The boundary case `b == B AND q == Q + T` returns `(true, posLiq, 0, 0)` — settle would succeed with zero surplus.

For partial-close pre-evaluation, callers compute targets themselves and compare against `_expectedFreedAmounts(partialLiq)`. The base does not provide a partial-quote view.

#### 7.7 `swap(liquidity, tokenIn, amountInMax, tokenOut, amountOutMin, recipient, deadline) → (amountIn, amountOut)`

**Caller:** Owner.
**State precondition:** `STATE_STAKED`.
**Reentrancy:** `nonReentrant`.

**Preconditions:**
- `msg.sender == owner` else `NotOwner`.
- `state == STATE_STAKED` else `WrongState`.
- `deadline >= block.timestamp` else `DeadlineExpired`.
- `recipient != address(0)` else `InvalidRecipient`.
- `0 < liquidity ≤ positionLiquidity` else `InvalidLiquidity`.
- `Q + T` does not overflow else `YieldTargetOverflow`.

**Effects:**
1. Snapshot `preBase`, `preQuote` = vault balances of `baseToken()` and `quoteToken()`.
2. Compute `targetBase = mulDiv(B, liquidity, posLiq)`, `targetQuote = mulDiv(Q + T, liquidity, posLiq)` (floor rounding).
3. Call `_closePartial(liquidity)`.
4. Compute `b`, `q` from balance deltas vs `(preBase, preQuote)`.
5. Classify case from `(b, q)` vs `(targetBase, targetQuote)`:
   - Case 1 (both surpluses): revert `UseSettleInsteadOfSwap`.
   - Case 2 (`b ≥ targetBase`, `q < targetQuote`): expected `tokenIn = quote, tokenOut = base`; `amountIn = targetQuote - q`, `amountOut = b - targetBase`.
   - Case 3 (`q ≥ targetQuote`, `b < targetBase`): expected `tokenIn = base, tokenOut = quote`; `amountIn = targetBase - b`, `amountOut = q - targetQuote`.
   - Case 4 (both deficits): revert `UnderwaterReduceYieldTarget`.
6. Validate `tokenIn` and `tokenOut` against the case's expected pair else `TokenMismatch`.
7. Validate `amountIn ≤ amountInMax` else `SlippageExceeded`.
8. Validate `amountOut ≥ amountOutMin` else `SlippageExceeded`.
9. Pull `amountIn` of `tokenIn` from owner.
10. Push `amountOut` of `tokenOut` to `recipient`.
11. Call `_settleBuffersAndStake(liquidity, posLiq, preBase, preQuote)`.
12. If `liquidity == posLiq`: set `state = STATE_SETTLED`.
13. Emit `Swap(msg.sender, recipient, liquidity, tokenIn, amountIn, tokenOut, amountOut)`.

**Events:** `Swap`.
**Returns:** `(amountIn, amountOut)`.

**Notes:**
- Slippage is enforced at the vault layer via `amountInMax`/`amountOutMin`; the underlying `_closePartial` runs with `amount0Min = amount1Min = 0` at the NFPM level.
- Multicall composition `[swap(small), swap(small), ...]` distributes the close in segments; each call closes its fraction of the current `positionLiquidity` snapshot at call time.

#### 7.8 `settle(liquidity, deadline) → (baseSurplus, quoteSurplus)`

**Caller:** Owner.
**State precondition:** `STATE_STAKED`.
**Reentrancy:** `nonReentrant`.

**Preconditions:**
- `msg.sender == owner` else `NotOwner`.
- `state == STATE_STAKED` else `WrongState`.
- `deadline >= block.timestamp` else `DeadlineExpired`.
- `0 < liquidity ≤ positionLiquidity` else `InvalidLiquidity`.
- `Q + T` does not overflow else `YieldTargetOverflow`.

**Effects:**
1. Snapshot `preBase`, `preQuote`.
2. Compute `targetBase = mulDiv(B, liquidity, posLiq)`, `targetQuote = mulDiv(Q + T, liquidity, posLiq)`.
3. Call `_closePartial(liquidity)`.
4. Compute `b`, `q` from balance deltas.
5. If `b < targetBase` AND `q < targetQuote`: revert `UnderwaterReduceYieldTarget`.
6. If `b < targetBase` OR `q < targetQuote` (but not both): revert `UseSwapInsteadOfSettle`.
7. (Implicit Case 1) Call `_settleBuffersAndStake(liquidity, posLiq, preBase, preQuote)`.
8. Compute `baseSurplus = b - targetBase`, `quoteSurplus = q - targetQuote`.
9. If `liquidity == posLiq`: set `state = STATE_SETTLED`.
10. Emit `Settle(msg.sender, liquidity, baseSurplus, quoteSurplus)`.

**Events:** `Settle`.
**Returns:** `(baseSurplus, quoteSurplus)`.

**Notes:**
- The function does NOT revert if `baseSurplus == 0` and `quoteSurplus == 0` (boundary case `b == targetBase AND q == targetQuote`).
- All freed amounts beyond `(B × frac, Q × frac)` flow into the reward buffers via `_settleBuffersAndStake`. The owner drains via `claimRewards()`.
- Partial settle is supported. Use case: owner harvests accumulated surplus without fully exiting. Each partial settle reduces `B`, `Q`, `T` proportionally via `_settleBuffersAndStake`.

#### 7.9 `unstake()`

**Caller:** Owner.
**State precondition:** `STATE_STAKED` or `STATE_SETTLED`.
**Reentrancy:** `nonReentrant`.

**Preconditions:**
- `msg.sender == owner` else `NotOwner`.
- `state ∈ {STAKED, SETTLED}` else `WrongState`.
- `unstakeBufferBase > 0` OR `unstakeBufferQuote > 0` else `NothingToUnstake`.

**Effects:**
1. Read `ub = unstakeBufferBase`, `uq = unstakeBufferQuote`.
2. Set `unstakeBufferBase = 0`, `unstakeBufferQuote = 0`.
3. Transfer `ub` of `baseToken()` to `owner` (skip if zero).
4. Transfer `uq` of `quoteToken()` to `owner` (skip if zero).
5. Emit `Unstake(owner, ub, uq)`.

**Events:** `Unstake`.
**Returns:** none.

#### 7.10 `claimRewards()`

**Caller:** Owner.
**State precondition:** `STATE_STAKED` or `STATE_SETTLED`.
**Reentrancy:** `nonReentrant`.

**Preconditions:**
- `msg.sender == owner` else `NotOwner`.
- `state ∈ {STAKED, SETTLED}` else `WrongState`.
- `rewardBufferBase > 0` OR `rewardBufferQuote > 0` else `NothingToClaim`.

**Effects:**
1. Read `rb = rewardBufferBase`, `rq = rewardBufferQuote`.
2. Set `rewardBufferBase = 0`, `rewardBufferQuote = 0`.
3. Transfer `rb` of `baseToken()` to `owner` (skip if zero).
4. Transfer `rq` of `quoteToken()` to `owner` (skip if zero).
5. Emit `ClaimRewards(owner, rb, rq)`.

**Events:** `ClaimRewards`.
**Returns:** none.

#### 7.11 `kindLabel()`

**Caller:** anyone.
**State precondition:** any.
**Reentrancy:** pure, none.

**Preconditions:** none.
**Effects:** none (pure).
**Returns:** a `bytes32` identifier. Each concrete subclass MUST implement this to return its unique stable identity matching the registry kind.

Standard identifiers:

| Subclass | `kindLabel()` returns |
|---|---|
| `ManualStakingVault` | `keccak256("manual-staking-vault-v1")` |
| `KeeperStakingVault` | `keccak256("keeper-staking-vault-v1")` |
| `CowStakingVault` (deferred) | `keccak256("cow-staking-vault-v1")` |

The function's abstract declaration in the base ensures `AbstractStakingVault` cannot be deployed directly.

#### 7.12 `_afterStake(tokenId, liquidityDelta)` — virtual hook

**Caller:** internal, invoked by `stake()` and `increaseStake()`.
**State precondition:** `STATE_STAKED` (just transitioned).
**Reentrancy:** runs inside the calling function's `nonReentrant` frame.

**Effects in base:** none. Default implementation is empty.

**Subclass contract:**
- Invoked AFTER `state` transitions to `STATE_STAKED` and AFTER the `Stake` event is emitted.
- `liquidityDelta` is the liquidity newly added by *this* call (initial full liquidity in `stake`; delta-only in `increaseStake`). Subclasses that care about cumulative liquidity read it via `positionLiquidity()`.
- MUST NOT modify base storage slots (`stakedBase`, `stakedQuote`, `yieldTarget`, `state`, buffer slots). Subclass-only slots are fair game.
- MUST NOT make external calls to untrusted contracts that could re-enter the vault. Calls to trusted external registries (e.g., `ERC20.approve`, `composableCow.create`) are acceptable.
- MAY revert. Revert in hook reverts the entire calling function (including the NFPM mint/increase). Use this for hard preconditions like rejecting fee-on-transfer tokens.

**Events:** none from the base hook itself; subclasses MAY emit their own events.

### 8. Case classification

Inputs at the moment of settlement:
- `(B, Q, T)` from storage.
- `(b, q)` derived from the position close (§9.3).
- `liquidity` parameter from caller; `posLiq = positionLiquidity()`.
- `targetBase = mulDiv(B, liquidity, posLiq)` with floor rounding.
- `targetQuote = mulDiv(Q + T, liquidity, posLiq)` with floor rounding.

Classification, applied in priority order (first match wins):

1. If `Q + T` overflows `uint256` → revert `YieldTargetOverflow`.
2. If `b ≥ targetBase` AND `q ≥ targetQuote` → **Case 1: NoSwapNeeded**.
3. If `b ≥ targetBase` (implies `q < targetQuote`) → **Case 2: Executable, base surplus**.
4. If `q ≥ targetQuote` (implies `b < targetBase`) → **Case 3: Executable, quote surplus**.
5. Else (both deficits) → **Case 4: Underwater**.

Per-case quantities for `swap()`:

| Case | bidToken | bidAmount | askToken | askAmountMin | tokenIn (owner pays) | tokenOut (owner receives) |
|---|---|---|---|---|---|---|
| 1 | — | 0 | — | 0 | revert | revert |
| 2 | base | `b - targetBase` | quote | `targetQuote - q` | quote | base |
| 3 | quote | `q - targetQuote` | base | `targetBase - b` | base | quote |
| 4 | — | 0 | — | 0 | revert | revert |

In `quoteSwap()` and `quoteSettle()`, the overflow case returns the Underwater status rather than reverting. The settlement functions revert on overflow so state cannot be corrupted.

### 9. Internal helpers

These are non-virtual `internal` functions used by base entry points. Subclasses MAY call them from their own functions but MUST NOT override them.

#### 9.1 `_closePartial(liquidity)`

Burns `liquidity` units of the position via NFPM `decreaseLiquidity` (with `amount0Min = amount1Min = 0` — slippage is enforced at the vault layer), then collects all uncollected fees via NFPM `collect` with maxima `type(uint128).max` for both tokens, recipient = vault.

UV3's `collect` is all-or-nothing per `tokenId`. A partial close therefore pulls 100% of accumulated fees in addition to the proportional principal share.

#### 9.2 `_settleBuffersAndStake(liquidity, posLiq, preBase, preQuote)`

Updates buffers and active stake after a successful trade or settlement. Inputs are the closed liquidity, the position liquidity at function entry, and the pre-call balances of `baseToken()` and `quoteToken()`.

**Effects:**
1. Compute `newFreeBase` = current `baseToken` balance − `preBase`. Same for `newFreeQuote`.
2. Compute `unstakeBaseDelta = mulDiv(B, liquidity, posLiq)`, `unstakeQuoteDelta = mulDiv(Q, liquidity, posLiq)`.
3. `unstakeBufferBase += unstakeBaseDelta`.
4. `unstakeBufferQuote += unstakeQuoteDelta`.
5. `rewardBufferBase += newFreeBase - unstakeBaseDelta`.
6. `rewardBufferQuote += newFreeQuote - unstakeQuoteDelta`.
7. `stakedBase -= unstakeBaseDelta`.
8. `stakedQuote -= unstakeQuoteDelta`.
9. `yieldTarget -= mulDiv(T, liquidity, posLiq)`.

By case construction (Case 1 with both surpluses; Case 2 with base surplus + topped-up quote; Case 3 symmetric), both `newFreeBase` and `newFreeQuote` are guaranteed `≥ unstake*Delta`.

#### 9.3 `_expectedFreedAmounts(closeLiquidity) → (b, q)`

Computes what `(b, q)` the vault would hold after closing exactly `closeLiquidity` units of the position. Used by `quoteSwap` and `quoteSettle`.

Read NFPM `positions(tokenId)` for liquidity, fee growth, and owed amounts. Read pool `slot0()` for `sqrtPriceX96`. Use `LiquidityAmounts.getAmountsForLiquidity` with the position's tick boundaries to compute the principal portion of the close. Compute uncollected fees from the position state. Sum principal and fees to get `(amount0, amount1)`. Map to `(b, q)` per `isToken0Quote`.

When `closeLiquidity == 0` or current liquidity is zero, the principal portion is zero; only the fees component contributes (which itself may be zero if no fees have accrued).

#### 9.4 `_resolvePool(token0, token1, fee) → address`

Calls `npm.factory().getPool(token0, token1, fee)`. Reverts with `PoolResolutionFailed` if the returned address is zero or the staticcall fails.

### 10. Storage-layout constraint

`AbstractStakingVault` declares its storage slots in the order shown in §3. Subclass-defined slots MUST be appended to this layout, in the order they are declared in the subclass contract. No subclass MAY insert slots before or interleaved with base slots.

Solidity inheritance achieves this by default — base contract slots are laid out first, then subclass slots in declaration order. The constraint is normative because clone deployments per `spec-0003d-vault-implementation-registry.md` MAY share base ABIs across subclass deployments; layout drift would corrupt indexers and cross-vault read paths.

The base does NOT use a storage gap. Per RFC-0003 design, vaults are non-upgradable EIP-1167 clones; storage extensions would require a new base contract version with new subclasses, not in-place additions.

### 11. Subclass extension contract

This section is normative for anyone implementing a new concrete subclass of `AbstractStakingVault`.

#### 11.1 What subclasses MAY add

- New external/public functions (e.g., `executeSwap`, `executeSettle` in `KeeperStakingVault`).
- New events.
- New storage slots (subject to §10).
- New `uint8 state` constants starting at 3.
- New errors with non-colliding selectors.
- An override of `_afterStake` for strategy-specific setup.
- An override of `kindLabel` returning the subclass's stable identity (mandatory for any concrete subclass).

#### 11.2 What subclasses MUST NOT do

- Break the owner-side buffer-fill contract: after any successful owner-initiated settlement, the owner MUST be able to retrieve exactly `(B × frac, Q × frac)` via `unstake()` plus the appropriate surplus via `claimRewards()`.
- Redirect surplus away from the owner in owner functions. Permissionless paths (subclass `execute*`) MAY route surplus to a caller as bounty per their own contract, but owner functions MUST NOT.
- Modify base storage from `_afterStake` (only subclass-only slots are fair game).
- Override or shadow internal helpers (`_closePartial`, `_settleBuffersAndStake`, `_expectedFreedAmounts`, `_resolvePool`).
- Reuse base state constants for different semantics.
- Insert storage slots that shift base slot positions.
- Change the meaning of `STATE_SETTLED`. A vault in `SETTLED` has `positionLiquidity() == 0` and no further settlement of any kind is possible.

These rules are SPEC-level constraints, not contract-enforced. Reviewers and tests must validate them per subclass.

#### 11.3 What subclasses SHOULD do

- Add an `executeQuote` view per `execute*` action so permissionless actors can determine viability before sending a transaction.
- Document the `_afterStake` semantics in the subclass's own spec.
- Keep transient-state windows tight (push → callback → verify).

### 12. Concrete default: `ManualStakingVault`

A trivial concrete subclass that makes the base instantiable without adding any logic. The entire contract is the inheritance declaration plus an override of `kindLabel()` returning `keccak256("manual-staking-vault-v1")`.

**Purpose:**
- **No-automation deployment.** Users who want a UV3-position wrapper with the yield-target accounting and buffer mechanics, without any permissionless settlement logic. They deploy `ManualStakingVault` and act as their own settlement actor.
- **Reference vault for tests.** The base test suite uses `ManualStakingVault` to test all owner-only paths without subclass complexity.
- **Lower bound for subclass capability.** Anything an owner can do via `ManualStakingVault` they can also do via any other concrete subclass — subclasses extend, never restrict.

**Owner exit semantics:**
- Cases 2, 3 → `swap(positionLiquidity, ...)` for full close, or partial via `swap(less, ...)`.
- Case 1 → `settle(positionLiquidity, ...)` for full close, or partial via `settle(less, ...)`.
- Case 4 → `setYieldTarget(0)` (or any low value), then proceed via `swap` / `settle` per the resulting case.

### 13. Future subclasses

Subclasses planned but NOT specified in this document:

**`KeeperStakingVault`** (`spec-0003c-keeper-staking-vault.md`):
- Adds `executeSwap` (Cases 2/3, push-callback-pull, full close).
- Adds `executeSettle` (Case 1, push-callback-pull, full close, structurally symmetric with `executeSwap`).
- Adds `STATE_EXECUTE_SWAP_IN_PROGRESS = 3` and `STATE_EXECUTE_SETTLE_IN_PROGRESS = 4`.
- Adds `IExecuteSwapCallback` and `IExecuteSettleCallback` interfaces.
- `_afterStake` is no-op (no setup needed beyond base).
- Permissionless actors are direct keepers; both functions push surplus tokens to the callback target, and `_settleBuffersAndStake` credits whatever returns to the reward buffer.

**`CowStakingVault`** (deferred):
- Adds `executeSwap` via ERC-1271 signature path, settled by CoW Protocol solvers.
- `_afterStake` does VaultRelayer approvals and ConditionalOrder registration with ComposableCoW.
- Specification deferred until a watch-tower spike validates that the public CoW watch-tower reliably picks up and serves the vault's conditional orders.
- Will be specified in `spec-0003e-cow-staking-vault.md` if the spike succeeds.

The `_afterStake` hook and `uint8`-state extensibility in this base are sized specifically for these planned subclasses.

### 14. Invariants

For all reachable states:

1. `unstakeBufferBase + remainingPositionBase ≥ stakedBase`, where `remainingPositionBase` is the principal still held by the open UV3 position. Analogous for quote.
2. `yieldTarget` is monotonically non-increasing across settlements (T scales down with closures; the only way T grows is via `increaseStake` scaling or `setYieldTarget`).
3. `state == STATE_SETTLED` ⇒ `positionLiquidity() == 0`.
4. `state == STATE_SETTLED` ⇒ no further `swap` / `settle` calls succeed.
5. After `unstake()` completes: `unstakeBufferBase == 0` AND `unstakeBufferQuote == 0` (until refilled).
6. After `claimRewards()` completes: `rewardBufferBase == 0` AND `rewardBufferQuote == 0` (until refilled).
7. **Subclass-storage invariant.** Any deployed subclass clone MUST have base storage slots at the positions defined by §3.
8. **Hook-isolation invariant.** `_afterStake` execution MUST NOT modify any base storage slot; only subclass-defined slots.

## Mandatory Tests

All assertions below SHOULD be implemented against `ManualStakingVault` as the under-test contract, since it is the reference concrete subclass for the base.

### Initialization
- MUST verify that `initialize()` reverts with `AlreadyInitialized` on a second invocation.
- MUST verify that `initialize(address(0))` reverts with `ZeroOwner`.
- MUST verify that the factory's `createVault*` is atomic — clone deployment plus `initialize` cannot be front-run by an external `initialize` call.

### Stake and increase
- MUST verify that `stake()` reverts with `WrongState` when called from `STATE_STAKED` or `STATE_SETTLED`.
- MUST verify that `stake()` refunds unconsumed `amount*Desired - amount*Used` to the owner.
- MUST verify that after `stake()`, `stakedBase` and `stakedQuote` equal the consumed amounts, mapped per `isToken0Quote`.
- MUST verify that `stake()` emits `Stake` with `liquidityDelta` equal to the freshly minted position liquidity, and that the emission happens before `_afterStake` is invoked.
- MUST verify that `increaseStake()` reverts with `WrongState` when called from any state except `STATE_STAKED`.
- MUST verify that `increaseStake()` scales `yieldTarget` by `ceil(T_old × (Q + ΔQ) / Q)` when `Q > 0` and `ΔQ > 0`, and emits `YieldTargetSet` only if T actually changed.
- MUST verify that `increaseStake()` leaves `yieldTarget` unchanged when `stakedQuote == 0` at call entry (initial out-of-range-above stake).
- MUST verify that `_afterStake` is invoked from `stake()` with `liquidityDelta` equal to the freshly minted liquidity.
- MUST verify that `_afterStake` is invoked from `increaseStake()` with `liquidityDelta` equal to the increment, not cumulative liquidity.
- MUST verify that a revert inside `_afterStake` reverts the entire `stake()` or `increaseStake()` call (including the NFPM mint/increase).

### Yield target
- MUST verify that `setYieldTarget()` reverts with `WrongState` when state is not `STATE_STAKED`.
- MUST verify that after `setYieldTarget(0)` from a Case 4 state, `quoteSwap()` returns `Executable` or `quoteSettle()` returns `canSettle = true`.

### Views
- MUST verify that `quoteSwap()` returns `NotApplicable` when `state != STATE_STAKED`.
- MUST verify that `quoteSwap()` returns `Executable` with `bidToken == base, askToken == quote` in Case 2.
- MUST verify that `quoteSwap()` returns `Executable` with `bidToken == quote, askToken == base` in Case 3.
- MUST verify that `quoteSwap()` returns `Underwater` when `Q + T` overflows `uint256` (no revert in view).
- MUST verify that `quoteSettle()` returns `(true, posLiq, 0, 0)` at the boundary `b == B AND q == Q + T`.

### Swap
- MUST verify that `swap()` with `liquidity == positionLiquidity` transitions state to `STATE_SETTLED`.
- MUST verify that `swap()` with `liquidity < positionLiquidity` keeps state at `STATE_STAKED` and reduces `B`, `Q`, `T` proportionally via `_settleBuffersAndStake`.
- MUST verify that `swap()` reverts with `UseSettleInsteadOfSwap` when called in Case 1.
- MUST verify that `swap()` reverts with `UnderwaterReduceYieldTarget` when called in Case 4.
- MUST verify that `swap()` reverts with `TokenMismatch` when `tokenIn` or `tokenOut` does not match the case-derived expected pair.
- MUST verify that `swap()` reverts with `SlippageExceeded` when the case-derived `amountIn` exceeds `amountInMax`.
- MUST verify that `swap()` reverts with `SlippageExceeded` when the case-derived `amountOut` is below `amountOutMin`.
- MUST verify that two consecutive partial `swap()` calls produce `unstakeBuffer*` totals equal to the sum of expected per-call deltas.

### Settle
- MUST verify that `settle()` with `liquidity == positionLiquidity` from Case 1 transitions state to `STATE_SETTLED`, fills `unstakeBufferBase = B`, `unstakeBufferQuote = Q`, and routes the entire surplus including `T` into `rewardBuffer*`.
- MUST verify that `settle()` with `liquidity < positionLiquidity` from Case 1 keeps state at `STATE_STAKED` and reduces `B`, `Q`, `T` proportionally.
- MUST verify that `settle()` returns `(0, 0)` and succeeds at the boundary `b == targetBase AND q == targetQuote`.
- MUST verify that `settle()` reverts with `UseSwapInsteadOfSettle` in Case 2 or Case 3.
- MUST verify that `settle()` reverts with `UnderwaterReduceYieldTarget` in Case 4.

### Buffer drains
- MUST verify that `unstake()` reverts with `NothingToUnstake` when both `unstakeBuffer*` are zero.
- MUST verify that `claimRewards()` reverts with `NothingToClaim` when both `rewardBuffer*` are zero.
- MUST verify that `unstake()` is callable in `STATE_STAKED` mid-lifecycle (after a partial swap or settle) and zeroes `unstakeBuffer*` after the call.
- MUST verify that across a full lifecycle (stake, partial settle, unstake, partial swap, unstake, claimRewards), the owner's net token balance change equals `Σ(stake deposits) + Σ(rewards) − dust`.

### State machine and reentrancy
- MUST verify that `swap()`, `settle()`, `unstake()`, `claimRewards()` all revert with `WrongState` when called in `STATE_EMPTY`.
- MUST verify that `swap()` and `settle()` revert with `WrongState` when called in `STATE_SETTLED`.
- MUST verify that any base entry point reverts when called recursively from within an ERC-777-style transfer hook (covered by `nonReentrant`).

### Identity and subclass
- MUST verify that `ManualStakingVault.kindLabel()` returns `keccak256("manual-staking-vault-v1")`.
- MUST verify that `AbstractStakingVault` cannot be deployed directly (compile-time enforcement via the abstract `kindLabel` declaration; this is a compilation test, not a runtime test).

## Out of Scope

- `executeSwap`, `executeSettle`, or any other permissionless settlement entry point. Specified in subclass specs (`SPEC-0003c` and later).
- Callback interfaces (`IExecuteSwapCallback`, etc.). Subclass concern.
- Transient `*InProgress` states beyond the three base states. Subclass concern.
- Bounty mechanics. Subclass concern (`KeeperStakingVault` via SPEC-0003c).
- Vault-implementation registry / multi-kind factory. Specified in `spec-0003d-vault-implementation-registry.md`.
- CoW Protocol integration in any form (ERC-1271, ConditionalOrder, hooks, helper contracts). Deferred entirely to a future spec contingent on a successful watch-tower spike.
- `cancelStake()` or any path from `STAKED` back to `EMPTY`.
- Ownership transfer of any kind.
- Upgradability, proxy admin, or migration of clones.
- Range adjustment after initial `stake()` (no changes to `tickLower`, `tickUpper`, no reposition). `increaseStake` only adds liquidity to the existing range.
- Fee-only collection without close.
- Multi-position-per-vault.
- Cross-chain logic.
- External price oracle (Chainlink, etc.) or pool TWAP. The vault is fully oracle-free.
- Uniswap V4 hooks.
- NFT burning after settlement.
- Storage gaps. Vaults are non-upgradable; layout extensions require a new base contract version with new subclasses.
