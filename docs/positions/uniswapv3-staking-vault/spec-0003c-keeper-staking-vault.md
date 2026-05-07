# SPEC-0003c: Keeper Staking Vault for Uniswap V3 Positions

**Date:** 2026-05-07
**Status:** ready for implementation
**Audience:** Coding agent (Claude Code)
**Note:** Extends `AbstractStakingVault` from SPEC-0003b. Adds permissionless settlement entry points for keeper-style automation.

## Summary

`KeeperStakingVault` is a concrete subclass of `AbstractStakingVault` that adds two permissionless settlement entry points: `executeSwap` for the trade cases (2 and 3) and `executeSettle` for the no-trade case (1). Both are full-close push-callback-pull functions: the vault closes the position, locks the owner-side floor `(B, Q + T)` into buffers, pushes any surplus to a caller-supplied callback contract, and credits whatever the callback returns to the reward buffer via balance-delta accounting. External actors — keepers, MEV bots, Closer Contracts, automation services — drive both paths and self-finance via flash loans, AMM swaps, or direct surplus retention; the vault is agnostic to how the callback distributes the pushed surplus. The owner-side contract from SPEC-0003b is unchanged. This spec specifies only the additions.

## Context

SPEC-0003b defines the abstract base contract with all owner-side paths but no permissionless settlement. SPEC-0003c is the first concrete subclass that adds permissionless paths via classical keeper patterns: a push-callback-pull mechanism for both trade settlement (`executeSwap`, where a keeper can flash-loan the required `tokenIn` from external liquidity and arbitrage the LVR-implied rate against the market) and no-trade settlement (`executeSettle`, where the surplus is pushed to the callback for distribution by a Closer Contract or simple keeper bot). Both functions use the same push-callback-pull pattern; the asymmetry is parametric (one-token push with minimum return for `executeSwap`; two-token push with no minimum for `executeSettle`).

This is the "no external infrastructure beyond standard DeFi keeper bots" deployment. A future `CowStakingVault` (deferred) will offer the same permissionless settlement via CoW Protocol's solver network instead. Both are parallel siblings of `AbstractStakingVault`.

## Specification

### 1. Architecture

`KeeperStakingVault` inherits from `AbstractStakingVault`. It adds:
- Two permissionless entry points (`executeSwap`, `executeSettle`).
- Two callback interfaces (`IExecuteSwapCallback`, `IExecuteSettleCallback`).
- Two transient states (`STATE_EXECUTE_SWAP_IN_PROGRESS = 3`, `STATE_EXECUTE_SETTLE_IN_PROGRESS = 4`).
- Two additional events for the callback frame initiation (`ExecuteSwapInitiated`, `ExecuteSettleInitiated`).
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

**Executor** — any external address. Calls `executeSwap()` (in Cases 2/3) or `executeSettle()` (in Case 1) when the vault state allows it. Self-selecting; nobody is required to execute. Receives the surplus pushed to the callback target during the call frame; how the callback distributes that surplus (retain externally, return to vault for owner reward, split with a treasury) is entirely the callback contract's concern.

The base **Owner** role is unchanged.

### 3. Storage

`KeeperStakingVault` adds NO new storage slots.

The state slot inherited from the base is reused — the subclass adds two additional `uint8` constants for the transient callback states:

| Constant | Value |
|---|---|
| `STATE_EXECUTE_SWAP_IN_PROGRESS` | 3 |
| `STATE_EXECUTE_SETTLE_IN_PROGRESS` | 4 |

Per SPEC-0003b §10 (storage-layout constraint), since no new slots are added, no layout consideration arises.

### 4. State machine

Additions to the base state machine:

| From | Trigger | To |
|---|---|---|
| `STAKED` | `executeSwap()` entry | `EXECUTE_SWAP_IN_PROGRESS` |
| `EXECUTE_SWAP_IN_PROGRESS` | callback returns successfully | `SETTLED` |
| `EXECUTE_SWAP_IN_PROGRESS` | callback reverts or returns insufficient `tokenIn` | (revert; state-restore via revert) |
| `STAKED` | `executeSettle()` entry | `EXECUTE_SETTLE_IN_PROGRESS` |
| `EXECUTE_SETTLE_IN_PROGRESS` | callback returns | `SETTLED` (no minimum return required) |
| `EXECUTE_SETTLE_IN_PROGRESS` | callback reverts | (revert; state-restore via revert) |

Both `execute*` functions always full-close. The `liquidity` parameter of base `swap`/`settle` is not exposed here — keepers do not get to choose partial close, since partial closes shrink the position's residual yield exposure unilaterally and would violate the owner's expectation that the position runs until fully settle-able.

Updated callability matrix (extends SPEC-0003b §4):

| Function | `EMPTY` | `STAKED` | `EXECUTE_SWAP_IN_PROGRESS` | `EXECUTE_SETTLE_IN_PROGRESS` | `SETTLED` |
|---|:---:|:---:|:---:|:---:|:---:|
| (all base functions per SPEC-0003b §4) | per base | per base | reverts (state != STAKED) | reverts (state != STAKED) | per base |
| `executeSwap` | — | ✓ | — | — | — |
| `executeSettle` | — | ✓ | — | — | — |

Note that during `EXECUTE_SWAP_IN_PROGRESS` and `EXECUTE_SETTLE_IN_PROGRESS`, all base functions revert with `WrongState` because they check for `STATE_STAKED` strictly. This is the intended cross-frame protection.

### 5. Errors

Errors added by `KeeperStakingVault`:

```
// Case-routing errors (executor-side)
UseExecuteSettleInsteadOfExecuteSwap     // executeSwap() in Case 1
UseExecuteSwapInsteadOfExecuteSettle     // executeSettle() in Case 2/3
UnderwaterRequiresOwnerAction            // execute* in Case 4

// Callback validation
InvalidCallbackTarget                    // address(0); used by executeSwap and executeSettle
InsufficientReturn                       // callback returned tokenIn < amountInMin; executeSwap only
```

The subclass MUST NOT redefine or shadow base errors. `executeSettle` does not have an `InsufficientReturn` revert path because no minimum return is required from its callback (the floor `(B, Q + T)` is locked into buffers before the callback is invoked).

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
function executeSettle(
    address callbackTarget, bytes calldata data, uint256 deadline
) external returns (uint256 baseSurplus, uint256 quoteSurplus)
```

#### 6.1 Callback interfaces

```
interface IExecuteSwapCallback {
    function executeSwapCallback(
        address tokenIn, uint256 amountInMin,
        address tokenOut, uint256 amountOut,
        bytes calldata data
    ) external
}

interface IExecuteSettleCallback {
    function executeSettleCallback(
        address baseToken, uint256 baseSurplus,
        address quoteToken, uint256 quoteSurplus,
        bytes calldata data
    ) external
}
```

The two interfaces are kept separate (rather than unified into a single `IExecuteCallback`) because their semantics differ materially: `IExecuteSwapCallback` describes a token bridging contract (one token in, another token out, with a minimum return); `IExecuteSettleCallback` describes a surplus distribution contract (two tokens in, no return required). Compile-time type checking on the callback contract benefits from the explicit distinction.

#### 6.2 Events

```
ExecuteSwapInitiated(
    address indexed caller, address indexed callbackTarget,
    uint128 liquidityClosed,
    address tokenIn, uint256 amountInMin,
    address tokenOut, uint256 amountOut,
    bytes data
)

ExecuteSettleInitiated(
    address indexed caller, address indexed callbackTarget,
    uint128 liquidityClosed,
    uint256 baseSurplus, uint256 quoteSurplus,
    bytes data
)
```

The base `Swap` event is reused for the successful completion of `executeSwap` (after the callback returns and verification passes). The base `Settle` event is reused for the successful completion of `executeSettle` (after the callback returns and `_settleBuffersAndStake` finalizes the buffers). For both, the distinguisher between owner-side and permissionless completions for indexers is the presence of the corresponding `Initiated` event in the same transaction.

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
8. Validate `amountInExpected == amountInMin` else `SlippageExceeded` (caller commits to deliver exactly the case-derived amount based on a recent `quoteSwap()`; pool drift between quote and execute reverts cleanly).
9. Validate `amountOutExpected == amountOut` else `SlippageExceeded`.
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

**Events:** `ExecuteSwapInitiated` (before callback); `Swap` (after verification, reusing the base event).
**Returns:** `(amountIn, amountOut)`.

**Notes:**
- Caller sets `amountInMin == amountInExpected` and `amountOutExpected == amountOut` based on a recent `quoteSwap()` reading. If pool state shifts between quote and execute such that the case math produces different amounts, the function reverts with `SlippageExceeded`. This is exact-match semantics; partial slippage tolerance is not supported in this version.
- Overpayment of `tokenIn` (callback returns more than `amountInExpected`) flows into `rewardBufferBase` (Case 3) or `rewardBufferQuote` (Case 2), captured by `_settleBuffersAndStake`'s balance-delta computation.
- All uncollected fees from the position close are folded into the reward buffer alongside any overpayment.
- Reentrancy protection is layered: `nonReentrant` blocks same-function reentry; the `EXECUTE_SWAP_IN_PROGRESS` state blocks all base entry points and `executeSettle` during the callback frame because those check for `STATE_STAKED`.

#### 7.2 `executeSettle(callbackTarget, data, deadline) → (baseSurplus, quoteSurplus)`

**Caller:** anyone (permissionless).
**State precondition:** `STATE_STAKED`.
**Reentrancy:** `nonReentrant`. Additionally guarded by transient state `EXECUTE_SETTLE_IN_PROGRESS` during the callback frame.

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
   - Case 1 (`b ≥ targetBase` AND `q ≥ targetQuote`): proceed.
   - Case 2 or Case 3: revert `UseExecuteSwapInsteadOfExecuteSettle`.
   - Case 4 (`b < targetBase` AND `q < targetQuote`): revert `UnderwaterRequiresOwnerAction`.
7. Compute `baseSurplus = b - targetBase`, `quoteSurplus = q - targetQuote`.
8. Set `state = STATE_EXECUTE_SETTLE_IN_PROGRESS`.
9. Emit `ExecuteSettleInitiated(msg.sender, callbackTarget, posLiq, baseSurplus, quoteSurplus, data)`.
10. Push `baseSurplus` of `baseToken()` to `callbackTarget` (skip if zero).
11. Push `quoteSurplus` of `quoteToken()` to `callbackTarget` (skip if zero).
12. Snapshot pre-callback reward buffer balances for delta computation: `preRewardBase = rewardBufferBase`, `preRewardQuote = rewardBufferQuote`.
13. Invoke `IExecuteSettleCallback(callbackTarget).executeSettleCallback(baseToken(), baseSurplus, quoteToken(), quoteSurplus, data)`.
14. After callback returns, call `_settleBuffersAndStake(posLiq, posLiq, preBase, preQuote)`.
    - The base helper credits `(B, Q)` to the unstake buffer and the post-callback balance delta beyond that to the reward buffer.
    - The reward buffer always receives at least `(0, T)` because the floor is locked in before the callback (unstake takes B and Q; T is preserved in the vault even if the callback retains all surplus).
    - Any callback overpayment (returned amounts above what was pushed) flows into the reward buffer alongside T.
15. Compute `rewardBaseDelta = rewardBufferBase - preRewardBase`, `rewardQuoteDelta = rewardBufferQuote - preRewardQuote`.
16. Set `state = STATE_SETTLED`.
17. Emit `Settle(msg.sender, posLiq, rewardBaseDelta, rewardQuoteDelta)`.

**Events:** `ExecuteSettleInitiated` (before callback); `Settle` (after settlement, reusing the base event).
**Returns:** `(baseSurplus, quoteSurplus)` — the gross amounts pushed to the callback. Callers compute the netto retained externally as `(baseSurplus - r_base, quoteSurplus - r_quote)` via their own callback's tracking.

**Notes:**
- This function is structurally symmetric to `executeSwap`: both push surplus to a callback and credit balance-delta returns to the reward buffer. The asymmetry is parametric — `executeSwap` pushes one token (one-sided surplus) and demands at least `amountInMin` of the other returned (the deficit must be covered for the floor to be reachable); `executeSettle` pushes both tokens (Case 1 has surpluses on both sides, no deficit) and demands no minimum return (the floor is already in buffers).
- The function does NOT revert if `baseSurplus == 0 AND quoteSurplus == 0` (boundary case `b == B AND q == Q + T`). The position settles; the callback is invoked with zero amounts and no token push happens; the reward buffer receives only T. The caller bears their gas with no surplus distribution, which is their problem to evaluate via `quoteSettle()` before calling.
- The callback MAY return any non-negative amounts of base and quote (including zero, including more than was pushed). Whatever returns lands in the reward buffer via `_settleBuffersAndStake`'s balance-delta computation.
- Always full close. Partial settle is not supported on the permissionless path.
- The owner-side floor `(B, Q + T)` is locked into buffers before the callback runs. The callback cannot break it: even if the callback returns nothing, the unstake buffer holds `(B, Q)` and the reward buffer holds `(0, T)`, totalling the full owner floor.
- The `Settle` event's `baseSurplus` and `quoteSurplus` fields reflect the reward buffer increments from this call (= `r_base` and `T + r_quote` in the §9 buffer-mechanics notation). This matches the semantic of the base owner-side `settle()` `Settle` emission (reward buffer increment), with the distinguisher being the presence of `ExecuteSettleInitiated` in the same transaction.

### 8. Reentrancy and state-lock semantics

#### 8.1 During callback frames

While a callback is executing, the vault state is one of:

- `EXECUTE_SWAP_IN_PROGRESS = 3` (during `executeSwap` callback)
- `EXECUTE_SETTLE_IN_PROGRESS = 4` (during `executeSettle` callback)

Effects on entry-point callability during either transient state:

- All base owner functions (`stake`, `increaseStake`, `setYieldTarget`, `swap`, `settle`, `unstake`, `claimRewards`) check for `state == STATE_STAKED` (or specific states like `STAKED|SETTLED` for drains) and revert with `WrongState`.
- `executeSwap` reverts with `WrongState` if reentered (its own precondition check).
- `executeSettle` reverts with `WrongState` (its own precondition check).
- View functions (`quoteSwap`, `quoteSettle`, `positionLiquidity`, `kindLabel`, etc.) remain callable and return values consistent with the current (transient) state — `quoteSwap` and `quoteSettle` return `NotApplicable` / `false` because state is not `STATE_STAKED`.

#### 8.2 Callback contracts

**`executeSwap` callback** at `callbackTarget` MUST:
- Receive `amountOut` of `tokenOut` from the vault before being called.
- Source `≥ amountInMin` of `tokenIn` (typically via flash loan, AMM swap, market order, owner inventory, etc.).
- Transfer the `tokenIn` to the vault (the vault address is `address(this)` from the callback's perspective).
- Return successfully (no return value required).

The `executeSwap` callback MUST NOT:
- Call any function on the vault during its frame. All such calls revert via the state-lock.
- Hold the funds beyond the callback frame. Anything not transferred back results in `InsufficientReturn`.

The vault verifies post-callback by checking `(tokenIn balance) - preTokenInBalance ≥ amountInMin`.

**`executeSettle` callback** at `callbackTarget`:

- Receives `baseSurplus` of base token and `quoteSurplus` of quote token from the vault before being called (transferred via standard ERC-20 `transfer`; either or both MAY be zero, in which case the corresponding push is skipped).
- MAY use these tokens externally (sell, swap, route to a recipient) within the callback frame.
- MAY return any non-negative amounts of base and/or quote to the vault before completing (via standard `transfer` from the callback contract back to the vault address). No minimum return is required.
- MUST NOT call any function on the vault during its frame. All such calls revert via the state-lock.
- MUST NOT hold the funds beyond the callback frame; tokens not transferred back stay externally and become the callback contract's responsibility (intentional surplus retention is the typical case).

The vault verifies post-callback balance by computing the delta from the pre-close snapshot via `_settleBuffersAndStake`. There is no `InsufficientReturn` revert path because there is no minimum return — the floor is already locked in before the callback.

### 9. Subclass-specific design notes

- `executeSwap` and `executeSettle` are both push-callback-pull. The callback pattern is the standard DeFi keeper integration point: keepers wrap `executeSwap` in a flash-loan callback (e.g., from a UV3 pool's `flash()`, Aave, Balancer's vault) so they don't need pre-funded inventory. `executeSettle` doesn't strictly need a flash loan — Case 1 has both surpluses already present, so the callback can simply route them to a recipient — but the callback pattern is uniform across both functions to give Closer Contract implementations a single integration shape.
- Keeper bots are expected to maintain their own off-chain price/state tracking to determine when `executeSwap` or `executeSettle` is profitable. The vault provides `quoteSwap()` and `quoteSettle()` as the ground-truth for the case math; keepers compute their own profit margin against external markets (or against treasury-fee policies for whitelisted Closer Contracts).
- The base `Swap` event is reused for `executeSwap` completion; the base `Settle` event is reused for `executeSettle` completion. Indexers distinguish via the presence of `ExecuteSwapInitiated` / `ExecuteSettleInitiated` in the same tx.
- The owner-side floor `(B, Q + T)` is structurally inviolable in both `execute*` functions: it is locked into buffers before the callback is invoked, so even an adversarial or buggy callback that returns nothing cannot break the floor. The worst-case outcome of an adversarial callback is that all surplus is forfeited externally (the caller's loss); the owner is unaffected.

### 10. Invariants

In addition to the base invariants from SPEC-0003b §14:

1. `state == EXECUTE_SWAP_IN_PROGRESS` ⇒ all entry points revert except `executeSwap`'s own callback frame internal logic.
2. `state == EXECUTE_SETTLE_IN_PROGRESS` ⇒ all entry points revert except `executeSettle`'s own callback frame internal logic.
3. After successful `executeSwap` completion, the `Swap` event is emitted with `caller = msg.sender` (the executor) and `recipient = callbackTarget`.
4. After successful `executeSettle` completion, the `Settle` event is emitted with `caller = msg.sender` (the executor); the `baseSurplus` and `quoteSurplus` fields of the `Settle` event reflect the amounts credited to the reward buffer from this call (= `r_base` and `T + r_quote` respectively in the §9 buffer-mechanics notation).
5. After successful `executeSettle` completion, `unstakeBufferBase ≥ B_at_call`, `unstakeBufferQuote ≥ Q_at_call`, and `rewardBufferQuote ≥ T_at_call + (any pre-existing reward)`. The owner-side floor is preserved regardless of callback behavior.
6. `executeSwap` and `executeSettle` always result in `state = STATE_SETTLED` on success (no partial close on permissionless paths).
7. The case-classification math used by `executeSwap` and `executeSettle` is identical to the base case-classification (SPEC-0003b §8) at full close (`liquidity = posLiq`).

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
- MUST verify that after a successful `executeSwap()` from Case 2, the owner recovers `(B, Q)` via `unstake()` and `(0, T + overpayment)` via `claimRewards()`, where the quote claim is `≥ T`.
- MUST verify that after a successful `executeSwap()` from Case 3, the owner recovers `(B, Q)` via `unstake()` and `(overpayment, T)` via `claimRewards()`, where the quote claim is `≥ T` and the base claim is `≥ 0`.
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
- MUST verify that `executeSwap()` reverts with `WrongState` when called from `STATE_EMPTY`, `STATE_SETTLED`, `STATE_EXECUTE_SWAP_IN_PROGRESS`, or `STATE_EXECUTE_SETTLE_IN_PROGRESS`.

### executeSwap — Reentrancy and state-lock
- MUST verify that during `EXECUTE_SWAP_IN_PROGRESS`, any attempt by the callback to call any base owner function (`stake`, `swap`, `settle`, `unstake`, `claimRewards`, `setYieldTarget`, `increaseStake`) reverts with `WrongState`.
- MUST verify that during `EXECUTE_SWAP_IN_PROGRESS`, any attempt by the callback to call `executeSwap` reverts with `WrongState`.
- MUST verify that during `EXECUTE_SWAP_IN_PROGRESS`, any attempt by the callback to call `executeSettle` reverts with `WrongState`.
- MUST verify that view functions (`quoteSwap`, `quoteSettle`, `positionLiquidity`, etc.) remain callable during `EXECUTE_SWAP_IN_PROGRESS` and return values consistent with the transient state (e.g., `quoteSwap` returns `NotApplicable` because `state != STAKED`).
- MUST verify that the state is restored to `STAKED → SETTLED` only on successful return; a callback revert leaves the entire transaction reverted (no persisted `EXECUTE_SWAP_IN_PROGRESS` state).

### executeSettle — Case 1 success paths (callback-based)
- MUST verify that `executeSettle()` in Case 1 with a callback that returns nothing transitions state to `SETTLED`, fills `unstakeBufferBase = B`, `unstakeBufferQuote = Q`, `rewardBufferBase = 0`, `rewardBufferQuote = T` (plus any pre-existing reward), and the callback retains both surpluses externally.
- MUST verify that `executeSettle()` in Case 1 with a callback that returns the full surplus (both `baseSurplus` and `quoteSurplus`) transitions state to `SETTLED` and fills `unstakeBufferBase = B`, `unstakeBufferQuote = Q`, `rewardBufferBase = baseSurplus`, `rewardBufferQuote = T + quoteSurplus`.
- MUST verify that `executeSettle()` in Case 1 with a callback that returns partial amounts of each token credits exactly those amounts to the reward buffer above the floor.
- MUST verify that `executeSettle()` in Case 1 with a callback that overpays (returns more than was pushed) credits the overpayment to the reward buffer.
- MUST verify that `executeSettle()` in Case 1 succeeds at the boundary `b == B AND q == Q + T` with `(baseSurplus, quoteSurplus) = (0, 0)` and skips both pushes to the callback (the callback is still invoked with zero amounts).
- MUST verify that after a successful `executeSettle()` from Case 1 with any callback behavior, the owner recovers `(B, Q)` via `unstake()` and at least `(0, T)` via `claimRewards()`.
- MUST verify that the `Settle` event emitted from `executeSettle()` has `baseSurplus` equal to the reward buffer increment for base (= `r_base`) and `quoteSurplus` equal to the reward buffer increment for quote (= `T + r_quote`).

### executeSettle — Floor preservation under adversarial callback
- MUST verify that `executeSettle()` with a callback that returns nothing preserves the owner-side floor `(B, Q + T)` in the buffers (`unstakeBufferBase = B`, `unstakeBufferQuote = Q`, `rewardBufferQuote ≥ T`).
- MUST verify that `executeSettle()` with a callback that returns more quote than was pushed credits the overpayment to `rewardBufferQuote` (above T).
- MUST verify that `executeSettle()` with a callback that returns more base than was pushed credits the overpayment to `rewardBufferBase`.
- MUST verify that across any combination of callback return amounts (zero, partial, full, overpayment), `unstake() + claimRewards()` returns at least `(B, Q + T)` to the owner.

### executeSettle — Reverts and rejections
- MUST verify that `executeSettle()` reverts with `UseExecuteSwapInsteadOfExecuteSettle` when called in Case 2 or Case 3.
- MUST verify that `executeSettle()` reverts with `UnderwaterRequiresOwnerAction` when called in Case 4.
- MUST verify that `executeSettle()` reverts with `InvalidCallbackTarget` when `callbackTarget == address(0)`.
- MUST verify that `executeSettle()` reverts with `DeadlineExpired` when `deadline < block.timestamp`.
- MUST verify that `executeSettle()` reverts with `WrongState` when called from any state except `STATE_STAKED`.
- MUST verify that `executeSettle()` reverts (with the callback's own revert reason) if the callback itself reverts; the entire transaction reverts with no persisted `EXECUTE_SETTLE_IN_PROGRESS` state.

### executeSettle — Reentrancy and state-lock
- MUST verify that during `EXECUTE_SETTLE_IN_PROGRESS`, any attempt by the callback to call any base owner function (`stake`, `swap`, `settle`, `unstake`, `claimRewards`, `setYieldTarget`, `increaseStake`) reverts with `WrongState`.
- MUST verify that during `EXECUTE_SETTLE_IN_PROGRESS`, any attempt by the callback to call `executeSwap` reverts with `WrongState`.
- MUST verify that during `EXECUTE_SETTLE_IN_PROGRESS`, any attempt by the callback to call `executeSettle` reverts with `WrongState`.
- MUST verify that view functions (`quoteSwap`, `quoteSettle`, `positionLiquidity`, etc.) remain callable during `EXECUTE_SETTLE_IN_PROGRESS` and return values consistent with the transient state.
- MUST verify that the state is restored to `STAKED → SETTLED` only on successful return; a callback revert leaves the entire transaction reverted (no persisted `EXECUTE_SETTLE_IN_PROGRESS` state).

### Permissionless access
- MUST verify that `executeSwap()` and `executeSettle()` succeed when called by an arbitrary non-owner address.
- MUST verify that `executeSettle()` accepts any non-zero `callbackTarget` address (the caller's own contract, a third-party Closer Contract, or even the owner's address as a contract).

### Indexer-relevant event semantics
- MUST verify that a successful `executeSwap()` emits both `ExecuteSwapInitiated` (before callback) and `Swap` (after verification) in the same transaction.
- MUST verify that a successful `executeSettle()` emits both `ExecuteSettleInitiated` (before callback) and `Settle` (after settlement) in the same transaction.
- MUST verify that the base `Swap` event from `executeSwap` and the base `Settle` event from `executeSettle` use `caller = msg.sender` (the permissionless executor).

## Out of Scope

- Reference `IExecuteSwapCallback` and `IExecuteSettleCallback` implementations (e.g., a flash-loan-bridged keeper bot, a Closer Contract). External components, separate concerns.
- Flash-loan provider integration (Aave, Balancer, UV3 pool flash) inside the vault. The vault is provider-agnostic — the callback contract handles flash-loan logic.
- Position Closer Contract specification (the canonical Closer Contract implementation that orchestrates `executeSwap` and `executeSettle` with treasury-fee logic and surplus routing). Specified in a future SPEC.
- CoW Protocol or any solver-network adapter. Deferred to a future SPEC contingent on watch-tower spike.
- Partial-close permissionless paths. Always full close on permissionless paths by design.
- Slippage/MEV protection beyond `amountInMin` / `amountOutExpected` exact-match for `executeSwap`. No commit-reveal, no batch auctions, no oracle-based sanity checks. Keepers protect themselves via off-chain quote-then-execute discipline.
- Bounty floors or minimum-surplus checks in `executeSettle`. Caller decides whether the surplus distribution justifies the gas.
- Arbitration or authorization layer over which addresses MAY call the `execute*` functions. Permissionless by design.
- Multi-call composition involving `execute*` functions with owner-side functions in the same transaction. Owner can only act on their own vault; permissionless callers can only act on `STAKED`-state vaults; cross-composition has no use case.
- Vault-implementation registry / multi-kind factory. Specified in `spec-0003d-vault-implementation-registry.md`.
