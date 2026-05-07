# SPEC-0003f: UniswapV3StakingVaultCloser

**Date:** 2026-05-07
**Status:** ready for implementation
**Audience:** Coding agent (Claude Code)
**Note:** Implementation of `IExecuteSwapCallback` and `IExecuteSettleCallback` from SPEC-0003c. This is the canonical Closer Contract referenced in SPEC-0003c §"Out of Scope". Reuses the conversion swap pattern (main + dust) and `IMidcurveSwapRouter` integration established by the existing `apps/midcurve-contracts/contracts/position-closer/facets/ExecutionFacet.sol`, but in a single-contract topology rather than a Diamond.

## Summary

`UniswapV3StakingVaultCloser` is a single Solidity contract that orchestrates permissionless settlement of `KeeperStakingVault` instances (SPEC-0003c). It exposes two permissionless trigger entry points (`triggerSwap`, `triggerSettle`) that wrap the vault's `executeSwap` and `executeSettle` calls, and implements both callback interfaces (`IExecuteSwapCallback`, `IExecuteSettleCallback`) that the vault invokes during the call frame. For Cases 2 and 3 (one-sided surplus), the closer bridges the deficit token via a two-stage conversion: a main conversion swap (off-chain quoted, slippage-protected, typically Paraswap-routed) plus a residual dust conversion swap through the vault's own pool. For Case 1 (both surpluses), the closer simply distributes both surpluses. After each successful trigger, the closer applies a governance-set treasury fee in basis points to the gross profit and pays the remainder to a caller-supplied bounty recipient. The contract holds no per-vault state; all routing parameters arrive per-call from the trigger caller.

## Context

SPEC-0003c §"Out of Scope" explicitly defers the Closer Contract specification:

> Position Closer Contract specification (the canonical Closer Contract implementation that orchestrates `executeSwap` and `executeSettle` with treasury-fee logic and surplus routing). Specified in a future SPEC.

This SPEC fills that gap. The contract is intended as the production-default closer for any keeper bot that integrates with `KeeperStakingVault` instances. Off-chain components (the keeper bot, the watcher, the Paraswap quoter) are out of scope and specified separately as part of the off-chain keeper infrastructure.

The two-stage conversion pattern — main conversion swap through Paraswap with `minAmountOut` protection, plus a residual dust conversion swap through the vault's own pool with no slippage protection — is reused verbatim from the existing `position-closer/ExecutionFacet`. The associated swap-router infrastructure (`IMidcurveSwapRouter`, the venue adapter pattern) is reused as-is. The order-storage and tick-trigger infrastructure of the existing closer is NOT reused: the vault itself is the source of truth for whether a trigger is valid (via `quoteSwap` / `quoteSettle`), and the keeper bot is the source of truth for whether a trigger is profitable.

## Specification

### 1. Architecture

`UniswapV3StakingVaultCloser` is a single concrete contract. It is NOT a Diamond. It inherits from:

- `Ownable` (OpenZeppelin) for admin control of treasury parameters.
- `ReentrancyGuard` (OpenZeppelin) for trigger-function protection.
- `IExecuteSwapCallback` (from SPEC-0003c §6.1).
- `IExecuteSettleCallback` (from SPEC-0003c §6.1).

The contract is deployed once per chain. It is parameterless across vaults — any `KeeperStakingVault` instance on the same chain MAY be triggered through it without per-vault registration.

The contract maintains minimal storage: governance parameters (`swapRouter`, `treasury`, `treasuryFeeBps`) and a transient call-context slot pair (`_activeVault`, `_activeBountyRecipient`) that is set on trigger entry, validated on callback entry, and cleared on trigger exit. Implementations targeting Solidity ≥ 0.8.24 MAY use transient storage (EIP-1153) for the call-context slots; otherwise regular storage suffices.

The contract holds NO per-vault state, NO order registry, NO trigger-tick configuration, and NO operator whitelist. All of these are either delegated to the vault (`quoteSwap`/`quoteSettle` is the source of truth for case classification) or to the off-chain keeper bot (profitability evaluation, route selection, calldata construction).

### 2. Roles

**Contract Owner** — set at deployment via the `Ownable` constructor, transferable per OZ semantics. Sole authorized caller of admin functions (`setSwapRouter`, `setTreasury`, `setTreasuryFeeBps`). Expected to be a governance-controlled multisig or a timelock.

**Trigger Caller** — any external address. Calls `triggerSwap()` or `triggerSettle()` for a target vault. Self-selecting; nobody is required to trigger. Supplies the swap routing (for `triggerSwap`) and a `bountyRecipient` address that receives the bounty payout. The bounty recipient MAY be the trigger caller's own address, an EOA, a contract, or any other valid address — the closer does not constrain it.

**Vault** — only addresses authorized via the active call-context slot (set by the closer's own `triggerSwap`/`triggerSettle` immediately before invoking the vault). The vault, in turn, calls back into `executeSwapCallback` or `executeSettleCallback` during its `execute*` call frame. The closer rejects callback invocations from any other address.

**Treasury** — recipient of the treasury-fee portion of the gross profit on every successful trigger. Set by the contract owner. Treasury is purely a payee role; it has no contract-side authority.

### 3. Storage

| Slot | Type | Set by | Mutability |
|---|---|---|---|
| `swapRouter` | `address` | constructor / `setSwapRouter` | mutable, owner-only |
| `treasury` | `address` | constructor / `setTreasury` | mutable, owner-only |
| `treasuryFeeBps` | `uint16` | constructor / `setTreasuryFeeBps` | mutable, owner-only |
| `_activeVault` | `address` | trigger entry / cleared on trigger exit | transient call-context |
| `_activeBountyRecipient` | `address` | trigger entry / cleared on trigger exit | transient call-context |

Plus the storage inherited from `Ownable` (the owner address slot).

Constants:

| Constant | Value |
|---|---|
| `MAX_TREASURY_FEE_BPS` | `1000` (10%) |
| `UNISWAP_V3_VENUE_ID` | `keccak256("UniswapV3")` |

The `MAX_TREASURY_FEE_BPS` cap exists to ensure the bounty remains economically attractive enough that keepers continue to call. Governance MAY set `treasuryFeeBps` to any value in `[0, MAX_TREASURY_FEE_BPS]`; values above the cap are rejected.

### 4. State

The closer has NO state machine of its own. The only "state" is the transient call-context slot pair, which is binary: either zero (no active trigger) or set to `(vault, bountyRecipient)` for the duration of one trigger call frame. The slots are guaranteed to be zero at the start and end of every external trigger call (enforced by `ReentrancyGuard` on triggers and by explicit clearing in the trigger function epilogue).

### 5. Errors

```solidity
// Construction / admin
InvalidSwapRouter                 // address(0) supplied
InvalidTreasury                   // address(0) supplied
TreasuryFeeBpsTooHigh             // > MAX_TREASURY_FEE_BPS

// Trigger validation
InvalidVault                      // address(0) supplied
InvalidBountyRecipient            // address(0) supplied
DeadlineExpired                   // deadline < block.timestamp at trigger entry
NotExecutableForSwap              // quoteSwap status is not Executable
NotExecutableForSettle            // quoteSettle returned canSettle = false

// Callback validation
NoActiveTrigger                   // callback invoked outside a trigger frame
UnauthorizedCallback              // callback msg.sender != _activeVault

// Conversion swap
MainConversionSwapExceedsSurplus  // guaranteedAmountIn > amountOut
InsufficientReturn                // total tokenIn gained < amountInMin
```

### 6. Public interface

#### 6.1 Constructor

```solidity
constructor(
    address initialOwner,
    address swapRouter_,
    address treasury_,
    uint16 treasuryFeeBps_
)
```

**Effects:**
1. Set OZ `Ownable` owner = `initialOwner` (revert if zero per OZ semantics).
2. `swapRouter_ != 0` else revert `InvalidSwapRouter`. Set `swapRouter`.
3. `treasury_ != 0` else revert `InvalidTreasury`. Set `treasury`.
4. `treasuryFeeBps_ <= MAX_TREASURY_FEE_BPS` else revert `TreasuryFeeBpsTooHigh`. Set `treasuryFeeBps`.

#### 6.2 Admin functions

```solidity
function setSwapRouter(address newRouter) external onlyOwner
function setTreasury(address newTreasury) external onlyOwner
function setTreasuryFeeBps(uint16 newBps) external onlyOwner
```

Each validates its parameter (non-zero address; bps within cap) and updates storage. Each emits an `*Updated` event.

Owner control inherits from OZ `Ownable` (`transferOwnership`, `renounceOwnership`).

#### 6.3 Trigger functions

```solidity
struct SwapParams {
    uint256 guaranteedAmountIn;
    uint256 minAmountOut;
    IMidcurveSwapRouter.Hop[] hops;
    uint256 deadline;
}

function triggerSwap(
    address vault,
    SwapParams calldata swapParams,
    address bountyRecipient,
    uint256 deadline
) external nonReentrant returns (uint256 amountIn, uint256 amountOut)

function triggerSettle(
    address vault,
    address bountyRecipient,
    uint256 deadline
) external nonReentrant returns (uint256 baseSurplus, uint256 quoteSurplus)
```

The two outer `deadline` parameters bound the trigger lifetime; the inner `swapParams.deadline` bounds the swap-router calls inside the callback. The keeper bot SHOULD set both to the same value or the inner slightly later than the outer.

The return values mirror the vault's `executeSwap` / `executeSettle` returns, for convenience of off-chain reconciliation. The bounty payout amount is reported via the `BountyPaid` event.

#### 6.4 Vault callback functions

```solidity
function executeSwapCallback(
    address tokenIn, uint256 amountInMin,
    address tokenOut, uint256 amountOut,
    bytes calldata data
) external override

function executeSettleCallback(
    address baseToken, uint256 baseSurplus,
    address quoteToken, uint256 quoteSurplus,
    bytes calldata data
) external override
```

Both callbacks are `external` per the interface signature, but reject calls from any address other than `_activeVault`. The `data` parameter for `executeSwapCallback` is the ABI-encoded `SwapParams` struct (set by `triggerSwap`); `data` for `executeSettleCallback` is unused in V1 (reserved for future expansion such as optional swap-after-settle consolidation).

#### 6.5 Views

```solidity
function activeVault() external view returns (address)
function activeBountyRecipient() external view returns (address)
```

Return the current call-context slot values. Useful for off-chain debugging; both are zero between triggers.

#### 6.6 Events

```solidity
// Admin
event SwapRouterUpdated(address indexed oldRouter, address indexed newRouter)
event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury)
event TreasuryFeeBpsUpdated(uint16 oldBps, uint16 newBps)

// Trigger lifecycle
event TriggerSwapStarted(
    address indexed caller, address indexed vault, address indexed bountyRecipient,
    address tokenIn, uint256 amountInMin, address tokenOut, uint256 amountOutExpected
)
event TriggerSettleStarted(
    address indexed caller, address indexed vault, address indexed bountyRecipient
)

// Conversion swap accounting
event MainConversionSwapExecuted(
    address indexed vault, address tokenIn, address tokenOut,
    uint256 amountIn, uint256 amountOut
)
event DustConversionSwapExecuted(
    address indexed vault, address tokenIn, address tokenOut,
    uint256 amountIn, uint256 amountOut
)

// Distribution
event TreasuryFeeApplied(
    address indexed vault, address indexed token,
    uint16 feeBps, uint256 grossAmount, uint256 feeAmount
)
event BountyPaid(
    address indexed vault, address indexed bountyRecipient,
    address token, uint256 amount
)
```

The `caller` in the trigger events is `msg.sender` of the trigger function; the `bountyRecipient` is the explicit parameter, which MAY equal or differ from `caller`. Indexers use `TriggerSwapStarted` / `TriggerSettleStarted` together with the vault's own `Swap` / `Settle` events (per SPEC-0003c §6.2) to reconstruct the full lifecycle.

### 7. Function behavior

#### 7.1 `triggerSwap(vault, swapParams, bountyRecipient, deadline) → (amountIn, amountOut)`

**Caller:** anyone (permissionless).
**Reentrancy:** `nonReentrant`. Additionally, the `_activeVault != 0` guard would reject reentry through the callback path even if `nonReentrant` were absent.

**Preconditions:**
- `vault != address(0)` else `InvalidVault`.
- `bountyRecipient != address(0)` else `InvalidBountyRecipient`.
- `deadline >= block.timestamp` else `DeadlineExpired`.

**Effects:**
1. Read `quote = IAbstractStakingVault(vault).quoteSwap()`.
2. If `quote.status != SwapStatus.Executable` revert `NotExecutableForSwap`. (Case 1, 4, NotApplicable, etc. are caught here; the vault would also revert on its own, but failing fast saves a deeper revert.)
3. Derive vault-call parameters from quote:
   - `tokenIn = quote.askToken` (the deficit token the vault needs)
   - `amountInMin = quote.askAmountMin` (exact match required by vault per SPEC-0003c §7.1 step 8)
   - `tokenOut = quote.bidToken` (the surplus token the vault will push)
   - `amountOutExpected = quote.bidAmount` (exact match required by vault per SPEC-0003c §7.1 step 9)
4. Set `_activeVault = vault`.
5. Set `_activeBountyRecipient = bountyRecipient`.
6. Emit `TriggerSwapStarted(msg.sender, vault, bountyRecipient, tokenIn, amountInMin, tokenOut, amountOutExpected)`.
7. Encode `data = abi.encode(swapParams)`.
8. Call `IKeeperStakingVault(vault).executeSwap(tokenIn, amountInMin, tokenOut, amountOutExpected, address(this), data, deadline)`. Capture return `(amountIn, amountOut)`.
9. Clear `_activeVault = address(0)`, `_activeBountyRecipient = address(0)`.
10. Return `(amountIn, amountOut)`.

The vault's call frame triggers `executeSwapCallback` synchronously between steps 8 entry and step 8 return. All distribution (treasury cut, bounty payout) happens inside the callback, before the vault verifies the return amount and finalizes settlement.

If the vault reverts at any point in its `executeSwap` (case mismatch, slippage, callback-return shortfall), the entire trigger transaction reverts. The closer's call-context slots are restored by the revert; no manual cleanup is required.

#### 7.2 `triggerSettle(vault, bountyRecipient, deadline) → (baseSurplus, quoteSurplus)`

**Caller:** anyone (permissionless).
**Reentrancy:** `nonReentrant`.

**Preconditions:**
- `vault != address(0)` else `InvalidVault`.
- `bountyRecipient != address(0)` else `InvalidBountyRecipient`.
- `deadline >= block.timestamp` else `DeadlineExpired`.

**Effects:**
1. Read `(canSettle, _, _, _) = IAbstractStakingVault(vault).quoteSettle()`. (The other return fields are not needed by the trigger; the vault re-derives them at execution time.)
2. If `!canSettle` revert `NotExecutableForSettle`.
3. Set `_activeVault = vault`, `_activeBountyRecipient = bountyRecipient`.
4. Emit `TriggerSettleStarted(msg.sender, vault, bountyRecipient)`.
5. Call `IKeeperStakingVault(vault).executeSettle(address(this), bytes(""), deadline)`. Capture return `(baseSurplus, quoteSurplus)`.
6. Clear `_activeVault`, `_activeBountyRecipient`.
7. Return `(baseSurplus, quoteSurplus)`.

The `data` parameter passed to `executeSettle` is empty in V1. Future versions MAY use it to pass post-settle consolidation parameters (e.g., "swap all base to quote before paying bounty"); the V1 callback ignores it.

#### 7.3 `executeSwapCallback(tokenIn, amountInMin, tokenOut, amountOut, data)`

**Caller:** the vault, validated against `_activeVault`.

**Preconditions:**
- `_activeVault != address(0)` else `NoActiveTrigger`.
- `msg.sender == _activeVault` else `UnauthorizedCallback`.

**Effects:**
1. Decode `SwapParams memory p = abi.decode(data, (SwapParams))`.
2. If `p.guaranteedAmountIn > amountOut` revert `MainConversionSwapExceedsSurplus`.
3. Snapshot `preTokenIn = IERC20(tokenIn).balanceOf(address(this))`.
4. **Main conversion swap (guaranteed leg):** if `p.guaranteedAmountIn > 0 && p.hops.length > 0`:
   - `IERC20(tokenOut).forceApprove(swapRouter, p.guaranteedAmountIn)`.
   - Call `IMidcurveSwapRouter(swapRouter).sell(tokenOut, tokenIn, p.guaranteedAmountIn, p.minAmountOut, address(this), p.deadline, p.hops)`.
   - `IERC20(tokenOut).forceApprove(swapRouter, 0)`.
   - Emit `MainConversionSwapExecuted(_activeVault, tokenOut, tokenIn, p.guaranteedAmountIn, mainOut)` where `mainOut` is the actual output measured by balance delta of `tokenIn`.
5. **Dust conversion swap (residual leg):** compute `dustAmount = amountOut - p.guaranteedAmountIn`. If `dustAmount > 0`:
   - Read `pool = IKeeperStakingVault(_activeVault).pool()`.
   - Build single-hop path:
     ```
     hop[0] = Hop({
         venueId: UNISWAP_V3_VENUE_ID,
         tokenIn: tokenOut,
         tokenOut: tokenIn,
         venueData: abi.encode(IUniswapV3PoolMinimal(pool).fee())
     })
     ```
   - `IERC20(tokenOut).forceApprove(swapRouter, dustAmount)`.
   - Call `IMidcurveSwapRouter(swapRouter).sell(tokenOut, tokenIn, dustAmount, 0, address(this), p.deadline, hop)`. The `0` for `minAmountOut` reflects that the dust leg's output is unpredictable (depends on post-main-swap pool state) and the floor is provided by the main conversion swap's `minAmountOut`.
   - `IERC20(tokenOut).forceApprove(swapRouter, 0)`.
   - Emit `DustConversionSwapExecuted(_activeVault, tokenOut, tokenIn, dustAmount, dustOut)`.
6. Compute `totalGained = IERC20(tokenIn).balanceOf(address(this)) - preTokenIn`.
7. If `totalGained < amountInMin` revert `InsufficientReturn`.
8. Transfer `amountInMin` of `tokenIn` to `msg.sender` (the vault) via `safeTransfer`. The vault verifies via balance delta in its own post-callback step.
9. Compute `grossProfit = totalGained - amountInMin` (denominated in `tokenIn`).
10. Apply treasury cut: `treasuryFee = mulDiv(grossProfit, treasuryFeeBps, 10_000)`. Transfer to `treasury` if non-zero. Emit `TreasuryFeeApplied(_activeVault, tokenIn, treasuryFeeBps, grossProfit, treasuryFee)`.
11. Transfer `bounty = grossProfit - treasuryFee` of `tokenIn` to `_activeBountyRecipient` if non-zero. Emit `BountyPaid(_activeVault, _activeBountyRecipient, tokenIn, bounty)`.

The callback does NOT need to clear the call-context slots; the trigger function epilogue (step 9 of `triggerSwap`) does that.

The callback does NOT explicitly handle `tokenOut` residuals because both `swapRouter.sell` calls are exact-input (the router pulls exactly the approved amount), so no `tokenOut` should remain. If a buggy router or adapter leaves residual `tokenOut`, it accumulates in the closer indefinitely. V1 does not provide a rescue function; if this materializes in practice, a rescue function MAY be added in a follow-up.

#### 7.4 `executeSettleCallback(baseToken, baseSurplus, quoteToken, quoteSurplus, data)`

**Caller:** the vault, validated against `_activeVault`.

**Preconditions:**
- `_activeVault != address(0)` else `NoActiveTrigger`.
- `msg.sender == _activeVault` else `UnauthorizedCallback`.

**Effects:**
1. (`data` is ignored in V1.)
2. Distribute `baseSurplus` if non-zero (see §7.5).
3. Distribute `quoteSurplus` if non-zero (see §7.5).
4. Return without transferring anything back to the vault. The vault's `_settleBuffersAndStake` will credit the buffer increments based on the (zero) post-callback balance delta, leaving only the structurally-locked floor `(B, Q + T)` in vault buffers.

V1 does not return any portion of the surplus to the vault. The owner's reward buffer therefore receives exactly `T` in quote and `0` in base from the settle (per SPEC-0003c §7.2 step 14). All surplus above `T` flows to treasury + bounty via the closer's distribution.

#### 7.5 Internal `_distribute(token, amount, bountyRecipient)`

**Effects:**
1. If `amount == 0` return.
2. Compute `treasuryFee = mulDiv(amount, treasuryFeeBps, 10_000)`.
3. If `treasuryFee > 0`:
   - Transfer `treasuryFee` of `token` to `treasury` via `safeTransfer`.
   - Emit `TreasuryFeeApplied(_activeVault, token, treasuryFeeBps, amount, treasuryFee)`.
4. Compute `bounty = amount - treasuryFee`. (Cannot be negative; `treasuryFee ≤ amount` by `mulDiv` semantics.)
5. If `bounty > 0`:
   - Transfer `bounty` of `token` to `bountyRecipient` via `safeTransfer`.
   - Emit `BountyPaid(_activeVault, bountyRecipient, token, bounty)`.

Edge cases:
- `treasuryFeeBps == 0` → entire `amount` goes to bounty.
- `treasuryFeeBps == MAX_TREASURY_FEE_BPS` (10%) → 90% goes to bounty.
- `amount` very small such that `treasuryFee` rounds to 0 → entire amount goes to bounty (no event for treasury).

### 8. Conversion swap mechanics

The conversion sequence is the V1 strategy for bridging the surplus token (received from the vault) to the deficit token (owed to the vault). It is reused from `position-closer/ExecutionFacet._executeSwap`, with one structural change: in the old closer, the closer holds the full freed amounts after the position close and chooses how to swap them; here, the surplus vs. deficit is determined by the vault's case classification, and the closer must produce at least `amountInMin` of the deficit token.

The sequence consists of two named legs that run in order: the **main conversion swap** (slippage-protected, off-chain quoted, typically through Paraswap) absorbs the bulk of the surplus, and the **dust conversion swap** (no slippage protection, on-chain single-hop through the vault's own pool) absorbs the residual.

**Main conversion swap (guaranteed leg).** Off-chain, the keeper bot fetches a Paraswap quote for swapping `guaranteedAmountIn` of `tokenOut` to at least `minAmountOut` of `tokenIn`. The bot calibrates `guaranteedAmountIn ≤ amountOut` and `minAmountOut ≥ amountInMin`, leaving a margin for the dust conversion swap to absorb on-chain pool drift. The Paraswap calldata is encoded as `Hop[]` (typically a single Paraswap hop with the route encoded in `venueData`, but multi-hop is supported). The closer executes this with full slippage protection: if the pool state drifts adversely between off-chain quote and on-chain execution, the swap-router reverts with `SlippageExceeded` and the entire trigger reverts cleanly.

**Dust conversion swap (residual leg).** The remaining `amountOut - guaranteedAmountIn` is routed through the vault's own Uniswap V3 pool as a single-hop swap. No `minAmountOut` is enforced because:

- The output is unpredictable (depends on the main conversion swap's effect on the same or related pools).
- The floor protection on the bridging operation as a whole is provided by the main conversion swap's `minAmountOut` plus the vault's own `amountInMin` check at callback return.

The trade-off: the main conversion swap captures most of the bridging value with strong slippage protection, the dust conversion swap absorbs residual pool drift without imposing additional revert paths. In practice the keeper bot calibrates the split (typically 95–99% through the main conversion swap, 1–5% through the dust conversion swap) based on the pool's depth and the expected drift between quote and execution.

**Main-only mode:** if the keeper sets `guaranteedAmountIn == amountOut`, the dust conversion swap is skipped entirely. The bridging is pure Paraswap. This is the mode for shallow vault pools where a same-pool dust swap would impose unacceptable slippage.

**Dust-only mode:** if the keeper sets `guaranteedAmountIn == 0` (and `hops.length == 0`), the main conversion swap is skipped entirely. All `amountOut` flows through the vault's own pool. This is the mode for assets without Paraswap support, or when pool depth is sufficient to absorb the full surplus. In this mode, the only slippage protection is the vault's own `amountInMin` floor; if the same-pool swap doesn't yield enough, the callback reverts with `InsufficientReturn`.

Both modes are valid and decided per-trigger by the keeper bot's off-chain computation.

### 9. Reentrancy and callback authentication

The closer enforces three layers of protection during a trigger call frame:

**Layer 1 — `nonReentrant` on triggers.** Both `triggerSwap` and `triggerSettle` are guarded with OZ `ReentrancyGuard.nonReentrant`. This prevents direct re-entry into either trigger function during a callback.

**Layer 2 — Call-context validation in callbacks.** Both `executeSwapCallback` and `executeSettleCallback` validate:
- `_activeVault != address(0)` (a trigger is in progress)
- `msg.sender == _activeVault` (the caller is the vault that the active trigger is targeting)

This prevents an arbitrary external caller from invoking the callbacks with crafted parameters. Without this check, a malicious contract could invoke `executeSwapCallback` to attempt to drain `tokenIn` from the closer (though this would require the closer to hold meaningful `tokenIn` balance, which it shouldn't except transiently within a trigger frame).

**Layer 3 — Vault-side state lock.** SPEC-0003c §8.1 specifies that during `EXECUTE_SWAP_IN_PROGRESS` and `EXECUTE_SETTLE_IN_PROGRESS`, all vault entry points (including base owner functions and the `execute*` functions themselves) revert with `WrongState`. This means the callback cannot re-enter the same vault to chain settlement actions, and cannot trigger a second settlement on a different vault either (because that would require the closer's `_activeVault` slot to point at the second vault, but it's still pointing at the first — Layer 2 catches this).

The combined effect: the closer's call-context slot pair is set exactly once per trigger and cleared exactly once at the end. Within the call frame, the only way back into the closer is via the validated callback. After the trigger returns (or reverts), the slots are zero.

In implementations using transient storage (EIP-1153), the slots are auto-cleared by the EVM at transaction end, eliminating the need for explicit clearing in the trigger epilogue. This is functionally equivalent to the regular-storage version; the spec does not mandate one or the other.

### 10. Treasury and bounty distribution

For both trigger paths, the gross profit is the closer's net token gain minus its obligations to the vault:

| Trigger | Gross profit token(s) | Mechanism |
|---|---|---|
| `triggerSwap` (Case 2: vault has surplus base, needs quote) | `tokenIn = quote` | Closer receives `amountOut` of base from vault, swaps via main + dust conversion for quote, returns `amountInMin` of quote to vault, keeps the leftover quote as profit. |
| `triggerSwap` (Case 3: vault has surplus quote, needs base) | `tokenIn = base` | Symmetric to Case 2: profit is denominated in base. |
| `triggerSettle` (Case 1: both surpluses) | `baseSurplus` in base + `quoteSurplus` in quote | Both surpluses are pushed to the closer; nothing is returned to the vault in V1 (no owner boost). |

For `triggerSwap`, the profit is denominated in `tokenIn` (= the deficit token, = the token the closer sources via the conversion swaps and partially returns to the vault). The closer holds zero `tokenOut` after both legs (everything was consumed by the two `sell` calls), and the leftover `tokenIn` after returning `amountInMin` to the vault is the gross profit.

Distribution per token: `treasuryCut = grossProfit × treasuryFeeBps / 10_000` to treasury, remainder to bountyRecipient. Both via `safeTransfer`. Both emit corresponding events.

Note that for `triggerSettle`, distribution happens twice (once for `baseSurplus`, once for `quoteSurplus`), independently. Either or both may be zero. Each non-zero distribution emits its own `TreasuryFeeApplied` and `BountyPaid` events.

### 11. Invariants

For all reachable states:

1. `swapRouter != address(0)`, `treasury != address(0)`, `treasuryFeeBps <= MAX_TREASURY_FEE_BPS`. Enforced at construction and on every admin update.
2. Outside any trigger call frame: `_activeVault == address(0)` AND `_activeBountyRecipient == address(0)`.
3. At callback entry: `_activeVault != address(0)` AND `msg.sender == _activeVault`. Else revert.
4. After any successful `triggerSwap`: the vault's `unstake() + claimRewards()` returns at least `(B, Q + T)` (the owner-side floor preservation contract, inherited from SPEC-0003c §7.1 step 18 and SPEC-0003b §11.2). This invariant is the vault's responsibility, not the closer's, but it MUST hold in tests of the closer.
5. After any successful `triggerSettle`: same as 4 — owner recovers at least `(B, Q + T)`. Additionally, since V1 does not return any surplus, the vault's reward buffer increment from this call is exactly `(0, T)` in (base, quote).
6. After any successful trigger, the closer's `tokenIn` (for swap) or `baseToken`+`quoteToken` (for settle) balance is zero or dust (modulo any pre-existing dust unrelated to this trigger).
7. The treasury and bountyRecipient receive exactly the amounts indicated by the events emitted in the same transaction; the sum of treasury + bounty for any given token equals the `grossAmount` field of the corresponding `TreasuryFeeApplied` event.

## Mandatory Tests

### Construction and admin
- MUST verify that the constructor reverts with `InvalidSwapRouter` if `swapRouter_ == address(0)`.
- MUST verify that the constructor reverts with `InvalidTreasury` if `treasury_ == address(0)`.
- MUST verify that the constructor reverts with `TreasuryFeeBpsTooHigh` if `treasuryFeeBps_ > MAX_TREASURY_FEE_BPS`.
- MUST verify that `setSwapRouter` reverts when called by a non-owner.
- MUST verify that `setSwapRouter(address(0))` reverts with `InvalidSwapRouter`.
- MUST verify that `setSwapRouter` updates storage and emits `SwapRouterUpdated` with the correct old/new values.
- MUST verify that `setTreasury(address(0))` reverts with `InvalidTreasury`.
- MUST verify that `setTreasuryFeeBps(MAX_TREASURY_FEE_BPS + 1)` reverts with `TreasuryFeeBpsTooHigh`.
- MUST verify that `setTreasuryFeeBps(0)` succeeds and that subsequent triggers route 100% of gross profit to the bounty recipient.

### Trigger validation
- MUST verify that `triggerSwap(address(0), …)` reverts with `InvalidVault`.
- MUST verify that `triggerSwap(vault, …, address(0), …)` reverts with `InvalidBountyRecipient`.
- MUST verify that `triggerSwap(…, deadline)` with `deadline < block.timestamp` reverts with `DeadlineExpired`.
- MUST verify that `triggerSwap` against a vault where `quoteSwap.status != Executable` reverts with `NotExecutableForSwap`.
- MUST verify the analogous reverts for `triggerSettle` (`InvalidVault`, `InvalidBountyRecipient`, `DeadlineExpired`, `NotExecutableForSettle`).

### Callback authentication
- MUST verify that `executeSwapCallback` reverts with `NoActiveTrigger` when called outside any trigger frame (i.e., directly).
- MUST verify that `executeSettleCallback` reverts with `NoActiveTrigger` when called outside any trigger frame.
- MUST verify that during an active trigger, an external contract that is NOT the active vault cannot invoke `executeSwapCallback` (test: deploy a malicious contract, have it attempt to call the closer's callback during a real trigger from another vault; expect `UnauthorizedCallback`).

### triggerSwap — Case 2 success path
- MUST verify that `triggerSwap` against a vault in Case 2 with valid `swapParams` and a Paraswap-like main conversion swap (mocked swap-router returning at least `minAmountOut`) succeeds, transitions the vault to `STATE_SETTLED`, and pays the bounty in `tokenIn = quote`.
- MUST verify that after the trigger, the vault's `unstake() + claimRewards()` returns at least `(B, Q + T)` to the vault owner.
- MUST verify that the treasury receives `treasuryFeeBps × grossProfit / 10_000` of `tokenIn` and the bountyRecipient receives the remainder.
- MUST verify that the events `TriggerSwapStarted`, `MainConversionSwapExecuted`, `DustConversionSwapExecuted` (if dust > 0), `TreasuryFeeApplied`, `BountyPaid` are emitted in the expected order.

### triggerSwap — Case 3 success path
- MUST verify the symmetric Case 3 path: bounty paid in `tokenIn = base`, vault transitions to `STATE_SETTLED`, owner floor preserved.

### triggerSwap — Conversion modes
- MUST verify that main-only mode (`guaranteedAmountIn == amountOut`, `hops.length > 0`) succeeds and skips the dust conversion swap (no `DustConversionSwapExecuted` event emitted).
- MUST verify that dust-only mode (`guaranteedAmountIn == 0`, `hops.length == 0`) succeeds when the vault's own pool has sufficient depth to yield ≥ `amountInMin`.
- MUST verify that dust-only mode reverts with `InsufficientReturn` when the vault's own pool yields < `amountInMin`.
- MUST verify that mixed mode with `guaranteedAmountIn` strictly between 0 and `amountOut` executes both legs.

### triggerSwap — Reverts and edge cases
- MUST verify that `triggerSwap` reverts with `MainConversionSwapExceedsSurplus` when `guaranteedAmountIn > amountOut` (caught inside the callback, propagates up).
- MUST verify that `triggerSwap` reverts with the swap-router's `SlippageExceeded` when the main conversion swap's `minAmountOut` is not met (and that the entire trigger reverts cleanly without partial state).
- MUST verify that `triggerSwap` reverts with `InsufficientReturn` when the main and dust conversion swaps combined yield less than `amountInMin` (e.g., adversarial pool drift between off-chain quote and on-chain execution).
- MUST verify that after a reverted `triggerSwap`, the closer's `_activeVault` and `_activeBountyRecipient` are zero.

### triggerSettle — Case 1 success path
- MUST verify that `triggerSettle` against a vault in Case 1 with non-zero `baseSurplus` AND `quoteSurplus` succeeds, transitions the vault to `STATE_SETTLED`, and pays bounty in BOTH tokens.
- MUST verify that the treasury receives `treasuryFeeBps × baseSurplus / 10_000` of base AND `treasuryFeeBps × quoteSurplus / 10_000` of quote.
- MUST verify that after the trigger, the vault's `unstake() + claimRewards()` returns exactly `(B, Q + T)` to the owner (since V1 returns nothing to the vault, the reward buffer increment is exactly `(0, T)`).
- MUST verify that the events `TriggerSettleStarted`, `TreasuryFeeApplied` (twice if both surpluses non-zero), `BountyPaid` (twice if both bounties non-zero) are emitted.

### triggerSettle — Boundary cases
- MUST verify that `triggerSettle` against a vault at the boundary `b == B AND q == Q + T` (both surpluses zero) succeeds, distributes nothing, and transitions the vault to `STATE_SETTLED` without any token transfers from the closer.
- MUST verify that `triggerSettle` succeeds when only `baseSurplus > 0` and `quoteSurplus == 0` (or vice versa), distributing only the non-zero side.

### Owner-floor preservation under all triggers
- MUST verify that across `triggerSwap` (Case 2), `triggerSwap` (Case 3), and `triggerSettle` (Case 1), under any valid swap params and any non-zero bountyRecipient, the vault owner's `unstake() + claimRewards()` returns at least `(B, Q + T)`.
- MUST verify that no trigger path leaves the closer holding `tokenIn` (for swap) or `baseToken`/`quoteToken` (for settle) above pre-trigger dust.

### Reentrancy and state-lock interactions
- MUST verify that any attempt to call `triggerSwap` or `triggerSettle` reentrantly from within a callback reverts (via OZ `nonReentrant` AND/OR via the vault's own `EXECUTE_*_IN_PROGRESS` state-lock).
- MUST verify that the closer's call-context slots are zero before AND after every successful and reverted trigger.

### Permissionlessness
- MUST verify that `triggerSwap` and `triggerSettle` succeed when called by an arbitrary non-owner address.
- MUST verify that the bounty is paid to the explicit `bountyRecipient` parameter, even when `msg.sender != bountyRecipient`.

## Out of Scope

- Off-chain keeper bot specification (route discovery, Paraswap quoting, profitability gating, transaction submission). Specified separately.
- A Diamond / facet-based variant of the closer. The single-contract topology is the canonical V1.
- Partial-close triggers. The vault's `executeSwap` and `executeSettle` are full-close-only per SPEC-0003c §4; the closer mirrors that.
- Owner-boost (returning a portion of the surplus to the vault's reward buffer to increase the owner's claim). Excluded from V1 to keep keeper economics maximally attractive; MAY be reconsidered in a future version if empirical surplus distributions warrant it.
- Multi-vault batching in a single trigger transaction (e.g., settling several vaults in one call). The single-vault-per-trigger design keeps the call-context slot semantics simple; batching is a separate concern that can be layered above via off-chain orchestration or a dedicated batching wrapper.
- Flash-loan integration inside the closer. The push-callback-pull pattern of the vault's `executeSwap` makes flash loans redundant (the surplus token is pushed to the closer before the callback runs, so the closer can use it directly to source the deficit token). If a future variant needs flash loans (e.g., for a different vault subclass), it will be a separate closer.
- Token-rescue function. The closer holds no expected balance between triggers; if dust accumulates from buggy router behavior, it remains until a follow-up SPEC adds a rescue path.
- Off-chain-supplied vault parameters (i.e., bypassing the closer's `quoteSwap` / `quoteSettle` reads). The closer reads the vault directly to ensure the parameters passed to `executeSwap` match the vault's case classification exactly. If the off-chain bot wants to override this for testing or specialized use, they call the vault's `executeSwap` / `executeSettle` directly without going through the closer.
- ERC-1271 / EIP-712 signature paths for delegated triggering. V1 is direct call only.
- Support for vault subclasses other than `KeeperStakingVault`. The closer is keeper-vault-specific; a `CowStakingVault` (SPEC-0003e, deferred) would have its own integration path.
- Treasury withdrawal mechanics. The treasury address is a plain payee; whatever mechanism the treasury uses to manage received funds is its own concern.

---

**End of spec.** Reach back to the conversation that produced this spec only for clarification on the *why* of a decision; the *what* is fully specified here.
