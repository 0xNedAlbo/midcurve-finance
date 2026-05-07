# SPEC-0003c: Keeper Staking Vault for Uniswap V3 Positions

**Date:** 2026-05-07
**Status:** ready for implementation
**Audience:** Coding agent (Claude Code)
**Note:** Extends `AbstractStakingVault` from SPEC-0003b. Adds permissionless settlement entry points for keeper-style automation.

## Summary

`KeeperStakingVault` is a concrete subclass of `AbstractStakingVault` that adds two permissionless settlement entry points: `executeSwap` for the trade cases (2 and 3) and `executeSettle` for the no-trade case (1). External actors — keepers, MEV bots, automation services — drive these paths in exchange for either an LVR-implied trade discount (`executeSwap`) or a direct surplus bounty (`executeSettle`). The owner-side contract from SPEC-0003b is unchanged. This spec specifies only the additions.

## Context

SPEC-0003b defines the abstract base contract with all owner-side paths but no permissionless settlement. SPEC-0003c is the first concrete subclass that adds permissionless paths via classical keeper patterns: a push-callback-pull mechanism for trade settlement (so a keeper can flash-loan the required `tokenIn` from external liquidity and arbitrage the LVR-implied rate against the market), and a surplus-as-bounty mechanism for the no-trade case (so a permissionless caller is compensated for the gas of triggering settlement when no trade is needed).

This is the "no external infrastructure beyond standard DeFi keeper bots" deployment. A future `CowStakingVault` (deferred) will offer the same permissionless settlement via CoW Protocol's solver network instead. Both are parallel siblings of `AbstractStakingVault`.

## Specification

### 1. Architecture

`KeeperStakingVault` inherits from `AbstractStakingVault`. It adds:
- Two permissionless entry points (`executeSwap`, `executeSettle`).
- One callback interface (`IExecuteSwapCallback`).
- One transient state (`STATE_EXECUTE_SWAP_IN_PROGRESS = 3`).
- One additional event for the callback frame initiation.
- Subclass-specific errors.

The subclass does NOT override:
- `_afterStake` (remains no-op from base).
- Any base entry point.
- Any base internal helper.

The subclass MUST override:
- `kindLabel()` to return `keccak256("keeper-staking-vault-v1")`.

The owner-side contract (Sections 2, 3, 4 of SPEC-0003b) is unchanged. All owner functions behave exactly as specified in the base.

### 2. Roles

`KeeperStakingVault` adds one role to the base:

**Executor** — any external address. Calls `executeSwap()` (in Cases 2/3) or `executeSettle()` (in Case 1) when the vault state allows it. Self-selecting; nobody is required to execute. Receives either trade execution at the LVR-implied rate (`executeSwap`) or direct surplus bounty (`executeSettle`).

The base **Owner** role is unchanged.

### 3. Storage

`KeeperStakingVault` adds NO new storage slots.

The state slot inherited from the base is reused — the subclass adds one additional `uint8` constant for the transient callback state:

| Constant | Value |
|---|---|
| `STATE_EXECUTE_SWAP_IN_PROGRESS` | 3 |

Per SPEC-0003b §10 (storage-layout constraint), since no new slots are added, no layout consideration arises.

### 4. State machine

Additions to the base state machine:

| From | Trigger | To |
|---|---|---|
| `STAKED` | `executeSwap()` entry | `EXECUTE_SWAP_IN_PROGRESS` |
| `EXECUTE_SWAP_IN_PROGRESS` | callback returns successfully | `SETTLED` |
| `EXECUTE_SWAP_IN_PROGRESS` | callback reverts or returns insufficient `tokenIn` | (revert; state-restore via revert) |
| `STAKED` | `executeSettle()` | `SETTLED` (always full close, no transient) |

Both `execute*` functions always full-close. The `liquidity` parameter of base `swap`/`settle` is not exposed here — keepers do not get to choose partial close, since partial closes shrink the position's residual yield exposure unilaterally and would violate the owner's expectation that the position runs until fully settle-able.

Updated callability matrix (extends SPEC-0003b §4):

| Function | `EMPTY` | `STAKED` | `EXECUTE_SWAP_IN_PROGRESS` | `SETTLED` |
|---|:---:|:---:|:---:|:---:|
| (all base functions per SPEC-0003b §4) | per base | per base | reverts (state != STAKED) | per base |
| `executeSwap` | — | ✓ | — | — |
| `executeSettle` | — | ✓ | — | — |

Note that during `EXECUTE_SWAP_IN_PROGRESS`, all base functions revert with `WrongState` because they check for `STATE_STAKED` strictly. This is the intended cross-frame protection.

### 5. Errors

Errors added by `KeeperStakingVault`:

```
// Case-routing errors (executor-side)
UseExecuteSettleInsteadOfExecuteSwap     // executeSwap() in Case 1
UseExecuteSwapInsteadOfExecuteSettle     // executeSettle() in Case 2/3
UnderwaterRequiresOwnerAction            // execute* in Case 4

// Callback validation
InvalidCallbackTarget                    // address(0)
InsufficientReturn                       // callback returned tokenIn < amountInMin
```

The subclass MUST NOT redefine or shadow base errors.

### 6. Public interface

Function signatures added by `KeeperStakingVault`:

```
// Settlement — permissionless trade (Cases 2, 3)
function executeSwap(
    address tokenIn, uint256 amountInMin,
    address tokenOut, uint256 amountOutExpected,
    address callbackTarget, bytes calldata data,
    uint256 deadline
) external returns (uint256 amountIn, uint256 amountOut)

// Settlement — permissionless no-trade (Case 1)
function executeSettle(address recipient, uint256 deadline)
    external returns (uint256 baseSurplus, uint256 quoteSurplus)
```

#### 6.1 Callback interface

```
interface IExecuteSwapCallback {
    function executeSwapCallback(
        address tokenIn, uint256 amountInMin,
        address tokenOut, uint256 amountOut,
        bytes calldata data
    ) external
}
```

#### 6.2 Events

```
ExecuteSwapInitiated(
    address indexed caller, address indexed callbackTarget,
    uint128 liquidityClosed,
    address tokenIn, uint256 amountInMin,
    address tokenOut, uint256 amountOut,
    bytes data
)

ExecuteSettle(
    address indexed caller, address indexed recipient,
    uint128 liquidityClosed,
    uint256 baseBounty, uint256 quoteBounty
)
```

The base `Swap` event is reused for the successful completion of `executeSwap` (after the callback returns and verification passes) — the distinguisher between owner-side `swap` and permissionless `executeSwap` for indexers is the presence of `ExecuteSwapInitiated` in the same transaction.

### 7. Function behavior

#### 7.1 `executeSwap(tokenIn, amountInMin, tokenOut, amountOutExpected, callbackTarget, data, deadline) → (amountIn, amountOut)`

**Caller:** anyone (permissionless).
**State precondition:** `STATE_STAKED`.
**Reentrancy:** `nonReentrant`. Additionally guarded by transient state `EXECUTE_SWAP_IN_PROGRESS` during the callback frame.

**Preconditions:**
- `state == STATE_STAKED` else `WrongState`.
- `deadline >= block.timestamp` else `DeadlineExpired`.
- `callbackTarget != address(0)` else `InvalidCallbackTarget`.
- `Q + T` does not overflow else `YieldTargetOverflow`.

**Effects:**
1. Read `posLiq = positionLiquidity()`.
2. Snapshot `preBase`, `preQuote` = vault balances of `baseToken()` and `quoteToken()`.
3. Set `targetBase = B`, `targetQuote = Q + T` (full close, so `frac = 1`).
4. Call `_closePartial(posLiq)`.
5. Compute `b`, `q` from balance deltas vs `(preBase, preQuote)`.
6. Classify case from `(b, q)` vs `(targetBase, targetQuote)`:
   - Case 1 (both surpluses): revert `UseExecuteSettleInsteadOfExecuteSwap`.
   - Case 2 (`b ≥ targetBase`, `q < targetQuote`): expected `tokenIn = quote, tokenOut = base`; `amountInExpected = targetQuote - q`, `amountOut = b - targetBase`.
   - Case 3 (`q ≥ targetQuote`, `b < targetBase`): expected `tokenIn = base, tokenOut = quote`; `amountInExpected = targetBase - b`, `amountOut = q - targetQuote`.
   - Case 4 (both deficits): revert `UnderwaterRequiresOwnerAction`.
7. Validate `tokenIn` and `tokenOut` against the case's expected pair else `TokenMismatch`.
8. Validate `amountInExpected ≤ amountInMin` is not an error condition (caller's lower bound is conservative); the actual `amountInMin` floor used for verification is `amountInExpected`. The caller-supplied `amountInMin` is checked as `amountInExpected ≥ amountInMin` (caller is willing to provide at least `amountInMin`; the case math may demand more). If `amountInExpected > amountInMin` the call still proceeds — the caller has agreed to meet the case's actual demand. This SHOULD be documented in the keeper-bot guidance: callers SHOULD set `amountInMin` to a value they are confident covers the case math at the current pool state, and use a fresh `quoteSwap()` reading to size it.

   *Implementation note*: simpler alternative — treat the `amountInMin` parameter as a slippage *floor* the caller is willing to accept (i.e., the callback must return at least `max(amountInExpected, amountInMin)`). This is the formulation below.
9. Validate `amountOutExpected == amountOut` is NOT enforced — the keeper's view of expected output is informational. The `amountOutExpected` parameter is reserved for future symmetric slippage bounds; in this version it MUST equal `amountOut` else `SlippageExceeded` (giving the keeper protection if the case math at execution time produces a surprisingly large `bidAmount`).

   *Decision*: enforce `amountOutExpected == amountOut`. Rationale: in this version, the keeper commits to a specific size; if pool state has shifted such that the case math produces a different size, the caller wants to revert and re-quote rather than be forced into an unexpected trade.
10. Set `state = STATE_EXECUTE_SWAP_IN_PROGRESS`.
11. Emit `ExecuteSwapInitiated(msg.sender, callbackTarget, posLiq, tokenIn, amountInExpected, tokenOut, amountOut, data)`.
12. Push `amountOut` of `tokenOut` to `callbackTarget`.
13. Snapshot `preTokenInBalance` = vault's current `tokenIn` balance (post-close, pre-callback).
14. Invoke `IExecuteSwapCallback(callbackTarget).executeSwapCallback(tokenIn, amountInExpected, tokenOut, amountOut, data)`.
15. After callback returns, compute `actualAmountIn = (vault tokenIn balance) - preTokenInBalance`.
16. If `actualAmountIn < amountInExpected` revert `InsufficientReturn`.
17. Set `amountIn = actualAmountIn` (may exceed `amountInExpected` — overpayment flows into reward buffer via step 18).
18. Call `_settleBuffersAndStake(posLiq, posLiq, preBase, preQuote)`.
19. Set `state = STATE_SETTLED`.
20. Emit `Swap(msg.sender, callbackTarget, posLiq, tokenIn, amountIn, tokenOut, amountOut)`.

**Events:** `ExecuteSwapInitiated` (before callback); `Swap` (after verification).
**Returns:** `(amountIn, amountOut)`.

**Notes:**
- The `amountInMin` parameter is the *minimum* the caller commits the callback will return. The case math at execution time may demand exactly this (in which case the call passes if the callback returns ≥ this) or more (in which case the call reverts pre-callback before any liquidity is closed; the caller should re-quote and resubmit with a higher `amountInMin`). See clarification §7.1.1 below.
- The `amountOutExpected` parameter is the keeper's claimed output size from a recent quote. If pool state has shifted between quote and execute, the case math may produce a different `amountOut`; the function reverts with `SlippageExceeded` rather than executing at the new size.
- Overpayment of `tokenIn` (callback returns more than `amountInExpected`) flows into `rewardBufferBase` (Case 3) or `rewardBufferQuote` (Case 2), captured by `_settleBuffersAndStake`'s balance-delta computation.
- All uncollected fees from the position close are folded into the reward buffer alongside any overpayment.
- Reentrancy protection is layered: `nonReentrant` blocks same-function reentry; the `EXECUTE_SWAP_IN_PROGRESS` state blocks all base entry points and `executeSettle` during the callback frame because those check for `STATE_STAKED`.

##### 7.1.1 Clarification on `amountInMin` versus case math

Two semantics are conceivable:

**(A) Caller-floor semantic (recommended).** `amountInMin` is the minimum `tokenIn` the caller commits to deliver. The function reverts if the case math produces a higher demand (`amountInExpected > amountInMin`), forcing the caller to re-quote with a higher `amountInMin`. The function also reverts if the callback returns less than `amountInExpected`. The case math always wins; the caller's `amountInMin` is the lower bound at which the caller will accept the trade.

**(B) Caller-cap semantic.** `amountInMin` is the maximum the caller is willing to deliver. The function reverts if case math demands more (caller can't afford this trade). Identical operationally to (A) for the case `amountInExpected > amountInMin` — both revert.

The two semantics converge in practice because both result in revert when the case math demands more than the caller specified, and proceed when it demands ≤ what the caller specified. Use semantic (A) — caller-floor — and document that the function uses `amountInExpected` for verification when the callback returns. The caller-supplied `amountInMin` is a precondition: `amountInExpected ≥ amountInMin` else revert with `SlippageExceeded`.

**Decision for this spec:** `amountInMin` is the caller's lower-bound commitment. The function reverts with `SlippageExceeded` if the case-derived `amountInExpected` is less than `amountInMin` (caller wanted to receive at least this much in `tokenIn` for some reason — degenerate case, but cleanly rejected). The function reverts with `SlippageExceeded` if the case-derived `amountInExpected` is greater than `amountInMin` (caller's offered amount doesn't cover the case demand). The callback verification uses `amountInExpected` as the floor.

In effect: caller MUST set `amountInMin == amountInExpected` based on a recent `quoteSwap()` read. If pool state shifts between quote and execute, the call reverts cleanly. This matches the symmetric `amountOutExpected` semantic in step 9.

#### 7.2 `executeSettle(recipient, deadline) → (baseSurplus, quoteSurplus)`

**Caller:** anyone (permissionless).
**State precondition:** `STATE_STAKED`.
**Reentrancy:** `nonReentrant`. No transient state needed (no callback).

**Preconditions:**
- `state == STATE_STAKED` else `WrongState`.
- `deadline >= block.timestamp` else `DeadlineExpired`.
- `recipient != address(0)` else `InvalidRecipient`.
- `Q + T` does not overflow else `YieldTargetOverflow`.

**Effects:**
1. Read `posLiq = positionLiquidity()`.
2. Snapshot `preBase`, `preQuote`.
3. Set `targetBase = B`, `targetQuote = Q + T` (always full close).
4. Call `_closePartial(posLiq)`.
5. Compute `b`, `q` from balance deltas.
6. If `b < targetBase` AND `q < targetQuote`: revert `UnderwaterRequiresOwnerAction`.
7. If `b < targetBase` OR `q < targetQuote` (but not both): revert `UseExecuteSwapInsteadOfExecuteSettle`.
8. (Implicit Case 1) Fill base `unstakeBuffer*` with exactly `(B, Q)`: `unstakeBufferBase += B`, `unstakeBufferQuote += Q`.
9. Fill `rewardBufferQuote += T` (the yield target portion of the surplus belongs to owner).
10. Compute `baseSurplus = b - B`, `quoteSurplus = q - (Q + T)`.
11. Transfer `baseSurplus` of `baseToken()` to `recipient` (skip if zero).
12. Transfer `quoteSurplus` of `quoteToken()` to `recipient` (skip if zero).
13. Reduce active stake: `stakedBase = 0`, `stakedQuote = 0`, `yieldTarget = 0` (full close).
14. Set `state = STATE_SETTLED`.
15. Emit `ExecuteSettle(msg.sender, recipient, posLiq, baseSurplus, quoteSurplus)`.

**Events:** `ExecuteSettle`.
**Returns:** `(baseSurplus, quoteSurplus)`.

**Notes:**
- This is the explicit difference from owner-side `settle()`: `executeSettle` routes the surplus over `(B, Q+T)` to a permissionless `recipient` as bounty, while owner `settle()` routes it to `rewardBuffer*` for owner claim. Yield target `T` itself always goes to the owner via `rewardBufferQuote`.
- The function does NOT revert if `baseSurplus == 0 AND quoteSurplus == 0` (boundary case where `b == B AND q == Q + T`). The position still settles. The caller bears their gas with no compensation, which is their problem to evaluate via `quoteSettle()` before calling.
- Always full close. Partial settle is not supported on the permissionless path.
- No transient state because no callback. Standard `nonReentrant` is sufficient.

### 8. Reentrancy and state-lock semantics

#### 8.1 During `EXECUTE_SWAP_IN_PROGRESS`

While the callback is executing, the vault state is `EXECUTE_SWAP_IN_PROGRESS = 3`. Effects:

- All base owner functions (`stake`, `increaseStake`, `setYieldTarget`, `swap`, `settle`, `unstake`, `claimRewards`) check for `state == STATE_STAKED` (or specific states like `STAKED|SETTLED` for drains) and revert with `WrongState`.
- `executeSwap` itself reverts with `WrongState` if reentered (its own precondition check).
- `executeSettle` reverts with `WrongState` (precondition is `STATE_STAKED`).
- View functions (`quoteSwap`, `quoteSettle`, `positionLiquidity`, `kindLabel`, etc.) remain callable and return values consistent with the current (transient) state — `quoteSwap` returns `NotApplicable` because state is not `STATE_STAKED`.

#### 8.2 Callback contract

The callback at `callbackTarget` MUST:
- Receive `amountOut` of `tokenOut` from the vault before being called.
- Source `≥ amountInMin` of `tokenIn` (typically via flash loan, AMM swap, market order, owner inventory, etc.).
- Transfer the `tokenIn` to the vault (the vault address is `address(this)` from the callback's perspective).
- Return successfully (no return value required).

The callback MUST NOT:
- Call any function on the vault during its frame. All such calls revert via the state-lock.
- Hold the funds beyond the callback frame. Anything not transferred back results in `InsufficientReturn`.

The vault verifies post-callback by checking `(tokenIn balance) - preTokenInBalance ≥ amountInMin`.

### 9. Subclass-specific design notes

- `executeSwap` is push-callback-pull. The callback pattern is the standard DeFi keeper integration point: keepers wrap the vault's `executeSwap` in a flash-loan callback (e.g., from a UV3 pool's `flash()`, Aave, Balancer's vault) so they don't need pre-funded inventory.
- Keeper bots are expected to maintain their own off-chain price/state tracking to determine when `executeSwap` is profitable. The vault provides `quoteSwap()` as the ground-truth for the case math; keepers compute their own profit margin against external markets.
- `executeSettle` does not need a callback because no token bridging is required — the vault has both surpluses and just hands them to the caller.
- The `Swap` event from the base is intentionally reused for both `swap` (owner) and `executeSwap` (executor) completions. Indexers distinguish via the presence of `ExecuteSwapInitiated` in the same tx.

### 10. Invariants

In addition to the base invariants from SPEC-0003b §14:

1. `state == EXECUTE_SWAP_IN_PROGRESS` ⇒ all entry points revert except `executeSwap`'s own callback frame internal logic.
2. After successful `executeSwap` completion, the `Swap` event is emitted with `caller = msg.sender` (the executor) and `recipient = callbackTarget`.
3. After successful `executeSettle` completion, `unstakeBufferBase == B_at_call`, `unstakeBufferQuote == Q_at_call`, `rewardBufferQuote == T_at_call + (any pre-existing reward)`, and the surplus over `(B, Q+T)` has been transferred out to `recipient`.
4. `executeSwap` and `executeSettle` always result in `state = STATE_SETTLED` on success (no partial close on permissionless paths).
5. The case-classification math used by `executeSwap` and `executeSettle` is identical to the base case-classification (SPEC-0003b §8) at full close (`liquidity = posLiq`).

## Mandatory Tests

All assertions below are tested against `KeeperStakingVault`. The base owner-side behavior (SPEC-0003b §Mandatory Tests) is assumed to pass on `KeeperStakingVault` as well, since the subclass does not override base functions.

### Subclass identity and base inheritance
- MUST verify that `KeeperStakingVault.kindLabel()` returns `keccak256("keeper-staking-vault-v1")`.
- MUST verify that `executeSwap()` and `executeSettle()` both preserve the owner-side floor: `unstake() + claimRewards()` after either successful permissionless path returns at least `(B, Q + T)` to the owner. This is the SPEC-0003b §11.2 buffer-fill contract applied to permissionless paths.
- MUST verify that all owner-side base tests from SPEC-0003b pass against `KeeperStakingVault` unchanged.
- MUST verify that `_afterStake` is invoked from `stake()` and `increaseStake()` and is a no-op (no observable state change beyond what the base defines).

### executeSwap — Case 2 / Case 3 success paths
- MUST verify that `executeSwap()` in Case 2 with a callback that returns exactly `amountInExpected` of quote completes successfully, transitions state to `SETTLED`, and emits `Swap` with `caller = msg.sender`.
- MUST verify that `executeSwap()` in Case 3 with a callback that returns exactly `amountInExpected` of base completes successfully and transitions state to `SETTLED`.
- MUST verify that `executeSwap()` in Case 2 with callback overpayment (returns more than `amountInExpected`) routes the overpayment into `rewardBufferQuote`.
- MUST verify that `executeSwap()` in Case 3 with callback overpayment routes the overpayment into `rewardBufferBase`.
- MUST verify that after a successful `executeSwap()` from Case 2, the owner recovers `(B, Q)` via `unstake()` and `(b - B, q + amountIn - Q)` via `claimRewards()`, where the quote claim is `≥ T`.
- MUST verify that after a successful `executeSwap()` from Case 3, the owner recovers `(B, Q)` via `unstake()` and `(b + amountIn - B, q - Q)` via `claimRewards()`, where the quote claim is `≥ T` and the base claim is `≥ 0`.
- MUST verify that callback overpayment in either case increases the corresponding reward-buffer slot by the overpayment amount.

### executeSwap — Reverts and rejections
- MUST verify that `executeSwap()` reverts with `UseExecuteSettleInsteadOfExecuteSwap` when called in Case 1.
- MUST verify that `executeSwap()` reverts with `UnderwaterRequiresOwnerAction` when called in Case 4.
- MUST verify that `executeSwap()` reverts with `TokenMismatch` when `tokenIn` or `tokenOut` does not match the case-derived expected pair.
- MUST verify that `executeSwap()` reverts with `SlippageExceeded` when the case-derived `amountInExpected` differs from the caller-supplied `amountInMin`.
- MUST verify that `executeSwap()` reverts with `SlippageExceeded` when the case-derived `amountOut` differs from the caller-supplied `amountOutExpected`.
- MUST verify that `executeSwap()` reverts with `InvalidCallbackTarget` when `callbackTarget == address(0)`.
- MUST verify that `executeSwap()` reverts with `DeadlineExpired` when `deadline < block.timestamp`.
- MUST verify that `executeSwap()` reverts with `InsufficientReturn` when the callback returns less than `amountInExpected`.
- MUST verify that `executeSwap()` reverts with `WrongState` when called from `STATE_EMPTY`, `STATE_SETTLED`, or during `STATE_EXECUTE_SWAP_IN_PROGRESS`.

### executeSwap — Reentrancy and state-lock
- MUST verify that during `EXECUTE_SWAP_IN_PROGRESS`, any attempt by the callback to call any base owner function (`stake`, `swap`, `settle`, `unstake`, `claimRewards`, `setYieldTarget`, `increaseStake`) reverts with `WrongState`.
- MUST verify that during `EXECUTE_SWAP_IN_PROGRESS`, any attempt by the callback to call `executeSwap` reverts with `WrongState`.
- MUST verify that during `EXECUTE_SWAP_IN_PROGRESS`, any attempt by the callback to call `executeSettle` reverts with `WrongState`.
- MUST verify that view functions (`quoteSwap`, `quoteSettle`, `positionLiquidity`, etc.) remain callable during `EXECUTE_SWAP_IN_PROGRESS` and return values consistent with the transient state (e.g., `quoteSwap` returns `NotApplicable` because `state != STAKED`).
- MUST verify that the state is restored to `STAKED → SETTLED` only on successful return; a callback revert leaves the entire transaction reverted (no persisted `EXECUTE_SWAP_IN_PROGRESS` state).

### executeSettle — Case 1 success paths
- MUST verify that `executeSettle()` in Case 1 transitions state to `SETTLED`, fills `unstakeBufferBase = B`, `unstakeBufferQuote = Q`, `rewardBufferQuote = T` (plus any pre-existing reward), and transfers `(b - B, q - (Q + T))` to `recipient`.
- MUST verify that `executeSettle()` in Case 1 succeeds at the boundary `b == B AND q == Q + T` with `(baseSurplus, quoteSurplus) = (0, 0)` and no transfers to `recipient`.
- MUST verify that after a successful `executeSettle()` from Case 1, the owner recovers `(B, Q)` via `unstake()` and `(0, T)` via `claimRewards()`, with surplus `(b - B, q - (Q + T))` transferred to the caller-supplied `recipient` as bounty.
- MUST verify that the owner's combined recovery `unstake() + claimRewards()` from `executeSettle()` is exactly `(B, Q + T)` regardless of pool state at execution time.

### executeSettle — Reverts and rejections
- MUST verify that `executeSettle()` reverts with `UseExecuteSwapInsteadOfExecuteSettle` when called in Case 2 or Case 3.
- MUST verify that `executeSettle()` reverts with `UnderwaterRequiresOwnerAction` when called in Case 4.
- MUST verify that `executeSettle()` reverts with `InvalidRecipient` when `recipient == address(0)`.
- MUST verify that `executeSettle()` reverts with `DeadlineExpired` when `deadline < block.timestamp`.
- MUST verify that `executeSettle()` reverts with `WrongState` when called from any state except `STATE_STAKED`.

### Permissionless access
- MUST verify that `executeSwap()` and `executeSettle()` succeed when called by an arbitrary non-owner address.
- MUST verify that `executeSettle()` accepts `recipient = msg.sender` and equally accepts `recipient` set to a third-party address.

### Indexer-relevant event semantics
- MUST verify that a successful `executeSwap()` emits both `ExecuteSwapInitiated` (before callback) and `Swap` (after verification) in the same transaction.
- MUST verify that a successful `executeSettle()` emits exactly `ExecuteSettle` and no `Swap` event.

## Out of Scope

- Reference `IExecuteSwapCallback` implementation (e.g., a flash-loan-bridged keeper bot). External component, separate concern.
- Flash-loan provider integration (Aave, Balancer, UV3 pool flash) inside the vault. The vault is provider-agnostic — the callback contract handles flash-loan logic.
- CoW Protocol or any solver-network adapter. Deferred to a future SPEC contingent on watch-tower spike.
- An `executeSettle` variant that routes surplus to the owner instead of the caller. Owner-side surplus harvesting in Case 1 is already covered by base `settle()` from SPEC-0003b.
- Partial-close permissionless paths. Always full close on permissionless paths by design.
- Slippage/MEV protection beyond `amountInMin`/`amountOutExpected` exact-match. No commit-reveal, no batch auctions, no oracle-based sanity checks. Keepers protect themselves via off-chain quote-then-execute discipline.
- Bounty floors or minimum-surplus checks in `executeSettle`. Caller decides whether the bounty justifies the gas.
- Arbitration or authorization layer over which addresses MAY call the `execute*` functions. Permissionless by design.
- Multi-call composition involving `execute*` functions with owner-side functions in the same transaction. Owner can only act on their own vault; permissionless callers can only act on `STAKED`-state vaults; cross-composition has no use case.
- Vault-implementation registry / multi-kind factory. Specified in `spec-0003d-vault-implementation-registry.md`.
