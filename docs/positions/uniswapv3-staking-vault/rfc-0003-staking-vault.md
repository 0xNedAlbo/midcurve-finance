# RFC-0003: Staking Vault

**Status:** Draft (rewrite)
**Issue:** TBD
**Implementation:** SPEC-0003b (abstract base + ManualStakingVault), SPEC-0003c (KeeperStakingVault)
**Author:** @0xNedAlbo
**Last updated:** 2026-05-07

---

## 1. Summary

The Staking Vault wraps a single Uniswap V3 NFT position and turns it
into a yield-target-based staking primitive. The owner deposits a
position with a fixed quote-side reward target `T`. The vault closes the
position (fully or partially) when the on-chain conditions allow it to
honor the deposit `(B, Q)` plus the target `T`, paying the owner exactly
that and distributing any surplus along well-defined paths.

The vault is structured as an **abstract base contract** plus
**concrete subclasses** that select a settlement strategy. The base
contract — `AbstractStakingVault` — defines the deposit, the yield
target, the four-case classification, and all owner-only paths
(`stake`, `increaseStake`, `setYieldTarget`, `swap`, `settle`,
`unstake`, `claimRewards`). It guarantees the owner-side floor: after
any successful settlement, the owner can recover at least `(B, Q + T)`.

Subclasses extend the base with permissionless settlement strategies:
- `ManualStakingVault` — no automation, owner is the sole settlement
  actor.
- `KeeperStakingVault` — keepers drive settlement via callback-based
  trade (`executeSwap`) or callback-based no-trade settlement
  (`executeSettle`); both functions follow the same push-callback-pull
  pattern.
- `CowStakingVault` — deferred. Future subclass that integrates with
  CoW Protocol's solver network via ERC-1271.

The vault uses no oracle. All pricing is deterministic from the pool
state at execution time, classified by a four-case partition over the
`(b, q)`-balance after position close.

## 2. Motivation

A Uniswap V3 LP position is a complex, two-sided exposure with no
intrinsic exit signal. The provider holds two tokens that drift relative
to spot, accumulates fees, and must decide manually when to close —
which typically means writing a bot, paying for an aggregator, or
eyeballing the position in a UI.

This RFC turns the position into a primitive that **defines an exit
target as a contract** and **lets a settlement strategy realize it**.
Two ideas pulled apart:

1. **What the protocol guarantees to the position owner.** The deposit
   `(B, Q)` plus the yield target `T` form a settlement contract: when
   the position is closed via any path, the owner receives at least
   `(B, Q + T)`. This guarantee is identical across all settlement
   strategies and lives in the abstract base contract.

2. **How settlement is automated.** The base contract gives the owner
   manual paths to settle. Concrete subclasses add permissionless
   automation: keepers, solvers, helper bots — each with its own
   incentive structure and trust assumptions. A user picks a subclass
   matching their preferred automation level.

This separation matters because the right automation strategy depends
on context: a small position may not be worth running keeper
infrastructure for and is better served by manual close; a large
position benefits from permissionless keeper-driven close so the owner
can be offline; a sophisticated owner may want CoW Protocol routing for
better execution. The same `(B, Q, T)` contract works underneath all
three.

The economic primitive being expressed is: **"I want exactly `B` base
plus `Q + T` quote out of this position. Define the close conditions
mathematically, then apply whatever settlement strategy fits."**

## 3. Concepts and notation

### 3.1 Quote and base

The vault distinguishes the two pool tokens as **quote** and **base**.
Quote is the unit of account for the yield target; base is everything
else. Mapping is fixed at stake time via the `isToken0Quote` flag.

For a WETH/USDC position with USDC as quote, base is WETH. The owner's
yield target `T` is denominated in USDC. The owner's payout on full
settlement is `(B WETH, Q + T USDC)`.

### 3.2 Deposit and target

At `stake()`, the vault records the deposit `(B, Q)` from the actual
token amounts consumed by the NFPM mint (after slippage refunds). The
yield target `T` is set by the owner and is mutable while staked.

`(B, Q, T)` together form the *settlement contract* the vault makes
with the owner: on full settlement, the owner receives at least
`(B, Q + T)`, distributed across the unstake buffer (B and Q) and the
reward buffer (T plus any surplus).

This guarantee — the **owner-side floor** — is the single most
important invariant of the vault, and it MUST hold across all
settlement paths in all concrete subclasses. See §7 for the contract
that subclasses MUST honor.

### 3.3 Position close and balance after close

When a settlement path triggers, the vault calls UV3's
`decreaseLiquidity` (proportional to the close fraction) and `collect`
(all uncollected fees, not pro-rated — UV3 fee collection is
all-or-nothing per `tokenId`). The resulting fresh balance the vault
receives is denoted `(b, q)`.

This is the central observable: `(b, q)` is what the position can
deliver right now. The four-case classification compares it to the
targets `(B × frac, (Q + T) × frac)` where `frac` is the close
fraction.

### 3.4 LVR-implied rate

LVR ("loss versus rebalancing") is the structural feature of UV3
positions where the average price the position trades at across its
range is below the current spot price. The vault exposes this rate
mechanically: in Cases 2 and 3 below, the vault offers a swap at the
exact `(b, q)`-derived rate from the position close. By construction
this is the LVR-implied rate. The counterparty (owner in `swap()`,
keeper in `executeSwap()`) accepts that rate or declines.

The vault never quotes "spot minus X%". It quotes "this much in, this
much out, take it or leave it." The fact that this rate corresponds to
a discount versus current spot is not a parameter — it is the
structural property of the close itself.

## 4. The four cases

After closing the position, the vault holds `(b, q)` of base and quote
respectively. Compare against `(targetBase, targetQuote) = (B × frac,
(Q + T) × frac)`:

| Case | Condition | Status |
|------|-----------|--------|
| 1 | `b ≥ targetBase AND q ≥ targetQuote` | NoSwapNeeded |
| 2 | `b ≥ targetBase AND q < targetQuote` | Executable |
| 3 | `b < targetBase AND q ≥ targetQuote` | Executable |
| 4 | `b < targetBase AND q < targetQuote` | Underwater |

**Case 1 (NoSwapNeeded).** The vault holds enough of both tokens. No
trade is needed; settlement is purely accounting. The owner-side floor
`(B × frac, (Q + T) × frac)` is locked into buffers (B and Q to
unstake, T to reward). Surplus over the floor is routed depending on
the caller:
- Owner-side `settle()` (base contract): the surplus stays in the
  vault and flows into the reward buffer; the owner claims it via
  `claimRewards()`.
- Permissionless `executeSettle()` (keeper subclass): the surplus is
  pushed to a caller-supplied callback. Whatever the callback returns
  flows into the reward buffer (via the same `_settleBuffersAndStake`
  balance-delta logic as `executeSwap`); whatever the callback retains
  externally is the caller's profit. The vault is agnostic to how the
  callback distributes the surplus.

In both cases the owner-side floor `(B × frac, (Q + T) × frac)` is
preserved.

**Case 2 (Executable, base surplus).** Vault has too much base, not
enough quote. The vault offers `(b − targetBase)` base in exchange for
at least `(targetQuote − q)` quote. The counterparty who provides the
quote sells the base on external markets and keeps the LVR-implied rate
as profit.

**Case 3 (Executable, quote surplus).** Symmetric to Case 2: vault has
too much quote, offers it for base.

**Case 4 (Underwater).** The position cannot deliver `(B × frac,
(Q + T) × frac)` at the current price. This is **only reachable when
`T > 0`**. Mathematically, a UV3 position close always yields either
`(b ≥ B AND q ≤ Q)` or `(b ≤ B AND q ≥ Q)` plus non-negative fees on
both sides. So `b < B` implies `q ≥ Q`, and Case 4's `q < Q + T`
requires `T > fees_quote`.

Underwater is therefore always a yield-target phenomenon, never a pool
phenomenon. The owner controls whether the position is in Case 4: if
`setYieldTarget(0)` is called, the vault transitions to Case 1, 2, or
3 and becomes settle-able. The owner trades reward expectation for
exit optionality.

### 4.1 Boundary handling

Comparisons use `≥` consistently. Boundary equalities (`b == B`,
`q == Q + T`) fall into Case 1. Degenerate sub-amounts (`amountIn ==
0` or `amountOut == 0` in Cases 2/3) are handled by the standard
token-flow path with zero transfers — they do not constitute special
cases.

### 4.2 Why no fifth case

A previous draft of this RFC proposed a fifth "discount swap" case
(both surpluses, swap at oracle-discounted rate to incentivize a
keeper). It was rejected because:

1. It required a TWAP oracle, contradicting the no-oracle goal.
2. It introduced an arbitrary 5% discount parameter.
3. The case it addressed — both surpluses — is now handled cleanly by
   the surplus-routing logic in Case 1, no oracle needed.

The four-case partition is final.

## 5. Architecture: abstract base + concrete subclasses

The vault is split into an abstract base contract and concrete
subclasses. The split exists because the owner-side contract (what the
protocol guarantees) is invariant across automation strategies, while
the strategy itself (how settlement happens permissionlessly) varies
substantially — and forcing one strategy on every deployment loses
flexibility while gaining no safety.

### 5.1 What lives in the base

`AbstractStakingVault` defines:

- All storage (deposit accounting, buffers, state slot, position
  parameters).
- All owner-only entry points: `stake`, `increaseStake`,
  `setYieldTarget`, `swap`, `settle`, `unstake`, `claimRewards`.
- The four-case classification math (§4).
- All views: `quoteSwap`, `quoteSettle`, `positionLiquidity`,
  `baseToken`, `quoteToken`.
- Internal helpers: position close, buffer fill, expected-freed
  computation, pool resolution.
- The state machine: `Empty`, `Staked`, `Settled`.
- One lifecycle hook: `_afterStake(tokenId, liquidityDelta)`, called
  after a successful initial stake or incremental stake. Default
  implementation is empty.
- One abstract function: `kindLabel()`, which any concrete subclass
  MUST implement to return its unique stable identity.

The base contract is `abstract` and cannot be deployed directly. The
abstract `kindLabel()` enforces this at compile time.

### 5.2 What subclasses add

Concrete subclasses extend the base with permissionless settlement
strategies. Each subclass:

- Implements `kindLabel()` returning a unique identifier.
- MAY override `_afterStake` to perform strategy-specific setup
  (e.g., approval to a settlement infrastructure contract, or
  registration of an order with an off-chain solver network).
- MAY add new external functions, typically named `execute*` to
  match the verb-based taxonomy where pure verbs (`swap`, `settle`)
  are owner-side and `execute*` variants are permissionless.
- MAY add new state values for transient locks during callback
  frames, starting at `state = 3`. The base's `Empty/Staked/Settled`
  values are reserved.
- MAY add new storage slots, subject to the layout constraint that
  subclass slots come strictly after base slots.

Subclasses MUST NOT:
- Break the owner-side floor `(B × frac, (Q + T) × frac)` defined
  in §3.2.
- Redirect surplus away from the owner in owner-side functions
  (only permissionless paths may route surplus to a non-owner
  recipient).
- Override base owner functions in ways that change the buffer-fill
  contract.
- Modify base storage from within `_afterStake`.

These are SPEC-level constraints; they are not contract-enforced
(beyond what Solidity's inheritance and visibility rules naturally
provide). Per-subclass review and tests must validate them.

### 5.3 Why this split

Three motivating observations:

**Observation 1: the owner contract is identical across strategies.**
A keeper-automated vault and a manual vault are economically
indistinguishable from the owner's perspective: same deposit, same
target, same payout structure, same recovery semantics. The only
difference is whether external actors can settle, and at what cost.
Putting the owner contract in the base eliminates duplication and
makes the cross-strategy invariant structurally obvious.

**Observation 2: subclass selection is a meaningful UX choice.**
Different users want different automation. A user with a small
position who plans to monitor it manually wants the simplicity of
`ManualStakingVault` — no callback complexity, no permissionless
surface to reason about. A user with a large position who is offline
most of the time wants `KeeperStakingVault` so external actors close
the position when conditions allow. A user routing through CoW Swap
wants `CowStakingVault` for solver-network execution. Forcing one
strategy on all users would either over-complicate the simple case or
under-serve the sophisticated case.

**Observation 3: future strategies should not require base changes.**
CoW Protocol integration in particular requires non-trivial setup
(VaultRelayer approvals, ConditionalOrder registration with
ComposableCoW, ERC-1271 signature handling) that is out of scope for
keeper-style automation. The subclass extension mechanism (`_afterStake`
hook plus new external functions) is sized exactly for this kind of
strategy without modifying or even redeploying the base.

### 5.4 Subclass identity and the registry

Each concrete subclass returns a unique stable `kindLabel()`. These
labels serve as keys in the implementation registry (specified
separately in `spec-0003d-vault-implementation-registry.md`), which
the factory consults to deploy the right clone for the user's chosen
kind.

Currently defined kinds:

| Subclass | `kindLabel()` returns |
|---|---|
| `ManualStakingVault` | `keccak256("manual-staking-vault-v1")` |
| `KeeperStakingVault` | `keccak256("keeper-staking-vault-v1")` |
| `CowStakingVault` (deferred) | `keccak256("cow-staking-vault-v1")` |

Subclasses are parallel siblings of the base, not a chain. There is no
`Manual → Keeper → Cow` inheritance.

## 6. Owner-side contract (base)

The base contract gives the owner a complete settlement toolkit even
without any subclass automation. The owner can stake, adjust the yield
target, harvest surplus partially, exit fully, and recover principal
plus rewards. None of these paths require external actors.

The verb-based taxonomy is consistent: pure verbs (`swap`, `settle`,
`stake`, `unstake`, etc.) are owner-only. Subclass `execute*` variants
are permissionless.

### 6.1 Owner-side settlement

**`swap(liquidity, ...)` — Cases 2/3.** The owner trades against the
vault at the LVR-implied rate. Specifies the close size as a
`liquidity` parameter (NFPM units). Vault dictates the resulting
`(amountIn, amountOut)` from the post-close state. Slippage bounds
(`amountInMax`, `amountOutMin`) protect against pool drift. Reverts in
Case 1 (use `settle`) and Case 4 (reduce T).

Partial-capable. The owner is in control of close size and aware of
the implications.

**`settle(liquidity, ...)` — Case 1.** Owner closes the position
without trading because both surpluses are already present. Buffers
fill with `(B × frac, Q × frac)` on the unstake side and the entire
surplus over those amounts (including the yield target T and any
fee-driven surplus) on the reward side. Reverts in Cases 2, 3 (use
`swap`) and Case 4 (reduce T).

Partial-capable. Use case: the owner wants to harvest accumulated
surplus without fully exiting (e.g., position has been running well,
fees push Q significantly above Q + T, owner takes part out and lets
the rest run).

### 6.2 Owner-side stake lifecycle

**`stake(...)`** — initial mint of a new UV3 position into the vault.
Records `(B, Q, T)` from the consumed amounts and the owner's chosen
target.

**`increaseStake(...)`** — adds liquidity to the existing position.
The vault adds the consumed `(amount0, amount1)` to `(B, Q)`
proportionally. The yield target `T` is scaled by the new-to-old quote
ratio: `T_new = ceil(T_old × (Q + ΔQ) / Q)`. This keeps the implicit
yield rate `T / Q` constant across stake increases.

Skipped if `Q == 0` (no anchor to scale against). Renamed from earlier
`stakeTopUp` for verb-taxonomy consistency.

**`setYieldTarget(newT)`** — change `T` while staked. Three use cases:
1. Lower T to escape Underwater (`setYieldTarget(0)` always makes the
   position settle-able).
2. Raise T to extend reward expectation, accepting longer position
   lifetime.
3. Adjust T to changed pool conditions (volume regime shifts, fee tier
   reasoning) without forcing a close + re-stake.

### 6.3 Owner-side recovery

**`unstake()`** — drains the unstake buffer (principal recovered from
settlement) to the owner. Callable in `Staked` (mid-lifecycle) and
`Settled`.

**`claimRewards()`** — drains the reward buffer (yield target plus
surplus) to the owner. Callable in `Staked` and `Settled`.

Both follow checks-effects-interactions: zero buffers, then transfer.

### 6.4 The owner-side floor

Across all owner-side paths in the base, the post-call invariant
holds: the owner can drain at least `(B × frac, (Q + T) × frac)`
through `unstake() + claimRewards()` for any settled fraction `frac`.
The base internal helper `_settleBuffersAndStake` enforces this by
construction: it credits exactly `(B × frac, Q × frac)` to the unstake
buffer and the entire excess to the reward buffer.

This is the floor that subclasses inherit and MUST NOT break. See §7.

## 7. Subclass extension contract

This section is normative for any subclass implementer.

### 7.1 What subclasses MAY add

- New external functions, typically `execute*` for permissionless
  variants of `swap` and `settle`, or strategy-specific configuration
  setters.
- New events.
- New storage slots, appended after base slots in declaration order.
- New `state` values starting at 3 for transient locks during callback
  frames.
- New errors with non-colliding selectors.
- An override of `_afterStake` for strategy-specific setup performed
  immediately after `stake` or `increaseStake`.
- An override of `kindLabel` (mandatory for any concrete subclass).

### 7.2 What subclasses MUST NOT do

- Break the owner-side floor `(B × frac, (Q + T) × frac)`. After any
  successful settlement triggered through any subclass-defined path,
  the owner MUST be able to drain at least this much through
  `unstake()` plus `claimRewards()`.
- Redirect surplus away from the owner in owner-side functions.
  Subclass `execute*` paths MAY route surplus to a non-owner recipient
  as bounty per the subclass's own contract; owner functions MUST
  always route surplus to the reward buffer.
- Override or shadow base internal helpers (`_closePartial`,
  `_settleBuffersAndStake`, `_expectedFreedAmounts`, `_resolvePool`).
- Modify base storage slots from within `_afterStake`. Subclass-only
  slots are fair game.
- Reuse the base state constants `Empty`, `Staked`, `Settled` for
  different semantics, or insert subclass slots that shift base slot
  positions.

These rules are SPEC-level constraints, not contract-enforced. Each
concrete subclass MUST be reviewed and tested against them.

### 7.3 Lifecycle hook

`_afterStake(tokenId, liquidityDelta)` is the only base lifecycle
hook. It is invoked from `stake()` and `increaseStake()` after `state
= STATE_STAKED` and after the `Stake` event has been emitted. The
default implementation is empty.

Subclasses use this hook for one-time setup that depends on the
position being in place — examples:

- `KeeperStakingVault` does nothing (no setup needed beyond base).
- `CowStakingVault` (deferred) approves the CoW VaultRelayer for both
  pool tokens and registers a `ConditionalOrder` with ComposableCoW.

The hook runs inside the calling function's `nonReentrant` frame.
Subclass implementations MUST NOT make external calls to untrusted
contracts that could re-enter the vault. Calls to trusted external
registries (token approvals, ComposableCoW order creation) are
acceptable. The hook MAY revert; a revert reverts the entire calling
function (including the underlying NFPM mint/increase).

`liquidityDelta` is the liquidity newly added by *this* call (initial
full liquidity in `stake`; delta-only in `increaseStake`). Subclasses
that care about cumulative liquidity read it via `positionLiquidity()`.

## 8. Concrete subclasses

### 8.1 ManualStakingVault

The trivial concrete subclass. Adds nothing except an override of
`kindLabel()` returning `keccak256("manual-staking-vault-v1")`. No new
storage, no new functions, no `_afterStake` override.

This is the canonical no-automation deployment. The owner is the sole
settlement actor; there are no permissionless paths. The owner closes
through `swap()` (Cases 2/3), `settle()` (Case 1), or escapes Case 4
via `setYieldTarget(0)` followed by the appropriate settlement path.

`ManualStakingVault` also serves as the reference vault for testing
the base contract — the base test suite runs against
`ManualStakingVault` because all owner-side behavior is unchanged from
the base.

### 8.2 KeeperStakingVault

Adds two permissionless settlement entry points, both following the
same push-callback-pull pattern:

**`executeSwap(...)` — Cases 2/3, full close, callback-based.** A
keeper provides a callback contract; the vault closes the entire
position, pushes the surplus token (`tokenOut`, the side the vault
has too much of) to the callback, and expects at least `amountInMin`
of the deficit token (`tokenIn`) returned within the same call frame.
Keepers typically use the surplus tokens to source the deficit
externally — sell the surplus on AMMs or external markets, fund the
deficit return, keep the spread between the LVR-implied rate and
external markets as profit. Callback overpayment (returning more
than `amountInMin`) flows into the reward buffer for the owner.

Always full close. Yield-target preservation: a partial close would
shrink `T` proportionally, leaving the remainder exposed to further
drift. If keeper #1 closes 30%, keeper #2 may find a Case-4 position.
The yield-target promise breaks. Keepers reaching `q ≥ Q + T` want the
full position closed atomically.

**`executeSettle(...)` — Case 1, full close, callback-based.**
A permissionless caller triggers settlement when both surpluses are
present, providing a callback contract. The vault closes the
position, locks the floor `(B, Q + T)` into buffers (`B` and `Q` to
the unstake buffer, `T` to the reward buffer), pushes both surpluses
(`b - B` base and `q - (Q + T)` quote) to the callback, and credits
whatever returns to the reward buffer via `_settleBuffersAndStake`'s
balance-delta computation. The callback retains whatever it doesn't
return — typically routed to a caller-chosen recipient (a Closer
Contract's "bounty" semantic against a treasury or third party).

This is structurally symmetric to `executeSwap`: both functions push
the surplus to the callback, both credit return-amounts to the reward
buffer via balance-delta, both keep the floor `(B, Q + T)`
structurally inviolable. The asymmetry is parametric: `executeSwap`
pushes one token (the surplus side) and demands at least
`amountInMin` of the other returned (the deficit must be covered for
the floor to be reachable); `executeSettle` pushes both surpluses and
demands no minimum return (the floor is already in buffers).

The vault is agnostic to how the callback distributes the surplus. A
simple keeper bot can route everything to its own EOA (callback
returns nothing). A Closer Contract can split: a portion to a
recipient as bounty, a portion to a treasury as fee, the remainder
back to the vault for the owner's reward. The vault doesn't know or
care; it sees the post-callback balance and credits accordingly.

In practice the surplus over `(B, Q + T)` in Case 1 is small. Case 1
only arises when UV3 fees push both `b` past `B` and `q` past
`Q + T` simultaneously. If either inequality were strict by more
than a dust amount, the position would already have been in Case 2
or 3 and an `executeSwap` keeper would have settled it earlier.
Case 1 is an edge case at the four-quadrant origin, and the surplus
reflects that.

The owner-side floor is preserved: `unstake()` plus `claimRewards()`
returns at least `(B, Q + T)` to the owner regardless of whether
settlement happened via `executeSwap` (with surplus over the floor
handled by the callback) or `executeSettle` (with both surpluses
handled by the callback). The owner trades the right to the surplus
over `(B, Q + T)` for the guarantee that the position settles
automatically when the target is reachable.

### 8.3 CowStakingVault (deferred)

Future subclass that integrates with CoW Protocol's solver network via
ERC-1271 signatures and ComposableCoW conditional orders. Settlement
flows through CoW solvers rather than direct keepers; the LVR-implied
rate is offered as a limit order that solvers can fill within their
batch auctions.

`_afterStake` does the strategy-specific setup: approving the CoW
VaultRelayer for both pool tokens and registering a `ConditionalOrder`
with the canonical ComposableCoW contract.

Specification deferred to a future SPEC contingent on a watch-tower
spike validating that the public CoW watch-tower reliably picks up and
serves the vault's conditional orders. If the spike succeeds, this
becomes `spec-0003e-cow-staking-vault.md`.

The hook design (`_afterStake` plus state-extensibility via `uint8`
constants) was sized specifically to accommodate this subclass without
base modifications.

## 9. Buffer mechanics

The vault holds two pairs of buffers:

- `unstakeBufferBase`, `unstakeBufferQuote` — accumulating principal
  reclaimed via settlement. Drained by `unstake()`.
- `rewardBufferBase`, `rewardBufferQuote` — accumulating yield reward
  including target T and any surplus. Drained by `claimRewards()`.

Buffers fill **additively** across multiple settlement calls. A vault
may settle in pieces (multiple partial swaps, then a final swap or
settle, etc.); each call adds to existing buffer balances. Drains
zero out the respective buffers and transfer to owner.

Buffers are filled by `_settleBuffersAndStake`, which computes the
post-call balance deltas (vault balance after all transfers complete,
minus the pre-close snapshot) and credits:

- `unstakeBuffer*` += `(B × frac, Q × frac)` — the principal allocation.
- `rewardBuffer*` += whatever else the vault holds.

This is **balance-delta accounting**. The buffers are filled from what
is actually present in the vault after the function's transfers, not
from formulas applied to the close-output `(b, q)`. As a result, the
buffer fills depend on what each settlement path transfers in/out
during its operation.

Per-path post-call buffer increments:

| Path                       | Where  | unstakeBase | unstakeQuote | rewardBase           | rewardQuote          |
|----------------------------|--------|-------------|--------------|----------------------|----------------------|
| `swap` (Case 2)            | Owner  | B × frac    | Q × frac     | 0                    | T × frac             |
| `swap` (Case 3)            | Owner  | B × frac    | Q × frac     | 0                    | T × frac             |
| `settle` (Case 1)          | Owner  | B × frac    | Q × frac     | b − B × frac         | q − Q × frac         |
| `executeSwap` (Case 2)     | Keeper | B           | Q            | 0                    | q + amountIn − Q     |
| `executeSwap` (Case 3)     | Keeper | B           | Q            | b + amountIn − B     | T                    |
| `executeSettle` (Case 1)   | Keeper | B           | Q            | r_base               | T + r_quote          |

**Variables:**

- `frac` = `liquidity / posLiq` for partial-capable owner paths.
  Always 1 for keeper paths (full close).
- `amountIn` (`executeSwap` only) = the amount of `tokenIn` returned
  by the callback (≥ `amountInMin`). Overpayment lands in the
  corresponding reward slot — `rewardQuote` in Case 2 (`tokenIn` =
  quote); `rewardBase` in Case 3 (`tokenIn` = base).
- `r_base`, `r_quote` (`executeSettle` only) = base and quote returned
  by the callback. No minimum is enforced; whatever returns lands in
  the reward buffer. The callback may return `(0, 0)` (full surplus
  retained externally), the full surplus (returned to vault), or
  anything in between, including overpayment.

**Notes on the table:**

- **Owner `swap` (Cases 2, 3) always produces reward fills `(0, T × frac)`.**
  Owner-side swap pays exactly the case-derived `amountIn` and
  receives exactly the case-derived `amountOut` (no overpayment
  semantics). After the swap, the vault retains exactly
  `(B × frac, (Q + T) × frac)`. The buffer fills are
  `(B × frac, Q × frac)` to unstake and `(0, T × frac)` to reward.

- **Owner `settle` (Case 1) routes the entire surplus to reward.**
  No transfers happen during owner-settle (all freed amounts stay
  in the vault), so the buffer fills cover the full close output
  `(b, q)` minus the unstake portion.

- **Keeper `executeSwap` reward fills depend on callback return.**
  The vault pushes the surplus token to the callback (`b - B` base
  in Case 2; `q - (Q + T)` quote in Case 3) and receives at least
  `amountInMin` of the deficit-side token back. Overpayment lands
  in the corresponding reward buffer slot. The non-pushed-out side
  always fills to exactly `T` (Case 3 rewardQuote) or `0` (Case 2
  rewardBase, since the surplus was pushed out) because the floor
  `(B, Q + T)` is preserved by construction.

- **Keeper `executeSettle` is symmetric on both sides.** The vault
  pushes both surpluses to the callback and credits whatever returns
  to the reward buffer. The owner's floor `(B, Q + T)` is locked
  into the buffers (B and Q to unstake; T to reward) before the
  callback is invoked, so the floor is structurally inviolable
  regardless of callback behavior. If the callback retains
  everything externally, `r_base = r_quote = 0` and the reward
  buffer is exactly `(0, T)`. If the callback returns the full
  surplus, the reward buffer captures all of it.

The `executeSettle` callback design replaces an earlier
`executeSettle(recipient)` direct-transfer design. The old design
hardcoded the bounty routing as a vault parameter; the new design
moves routing into the callback contract, where it can be combined
with treasury-fee logic, owner-vs-third-party recipient policies, and
other Closer Contract concerns. The vault becomes agnostic to the
bounty mechanic and keeps a uniform pattern across both `execute*`
functions.

## 10. State machine

The base contract defines three persistent states:

```
            ┌─────────┐
            │  Empty  │
            └────┬────┘
                 │ stake()
                 ▼
            ┌─────────┐
            │ Staked  │ ──── partial swap / partial settle ──┐
            └────┬────┘                                       │
                 │                                            │
                 │ swap (full) / settle (full)                │
                 │                                            │
                 ▼                                            │
            ┌─────────┐                                       │
            │ Settled │◄──────────────────────────────────────┘
            └─────────┘
```

`unstake()` and `claimRewards()` are available in `Staked` and
`Settled`. `increaseStake()` and `setYieldTarget()` are available only
in `Staked`.

Subclasses with callback-based permissionless paths add transient
states. `KeeperStakingVault` adds two:

- `ExecuteSwapInProgress` (transient, set during the `executeSwap`
  callback frame; reverts to `Settled` on successful return).
- `ExecuteSettleInProgress` (transient, set during the `executeSettle`
  callback frame; reverts to `Settled` on successful return).

The transient states are not just for reentrancy protection — they
also make the in-progress condition observable. An indexer seeing an
`ExecuteSwapInitiated` or `ExecuteSettleInitiated` event without a
matching `Swap` or `Settle` event in the same transaction knows the
call reverted. And because base entry points all check for
`state == Staked` strictly, the transient states naturally block all
base functions during the callback frame, layered on top of
OpenZeppelin's `nonReentrant`.

## 11. Pricing and oracle stance

The vault uses **no external price oracle and no pool TWAP**. All
pricing is deterministic from the pool state at execution time:

- `pool.slot0().sqrtPriceX96` — current spot price, used to compute
  `(b, q)` from the partial close.
- NFPM `positions(tokenId)` — current liquidity, fee growth, owed
  amounts.
- `LiquidityAmounts.getAmountsForLiquidity` — to convert liquidity ×
  sqrtPrice to token amounts.

The four-case classification depends only on `(b, q)` versus
`(B × frac, (Q + T) × frac)`. There is no rate-decision step that
requires an oracle.

Consequences:

- No deployment dependency on Chainlink, third-party feeds, or
  cross-pool basis.
- No TWAP-manipulation surface.
- Per-call gas is reduced (no oracle round-trip).
- Pricing is exactly the LVR-implied rate, which is always at or below
  current spot — keepers self-select based on whether external markets
  give them better prices (in which case they don't act and the vault
  stays open).

The trade-off is that the vault cannot offer a "spot-priced" trade. A
Case-4 position cannot be closed by the vault itself; the owner's only
recovery path is `setYieldTarget(0)` (or any value low enough to
convert Case 4 into Case 1, 2, or 3). This is by design: the no-oracle
stance is non-negotiable and Case 4 is rare and recoverable.

## 12. Multicall

The vault inherits OpenZeppelin's `Multicall` mixin, allowing the
owner to bundle multiple calls atomically. Common patterns:

- `setYieldTarget(0)` then `swap(...)` or `settle(...)` — owner
  escapes Underwater and immediately settles via the resulting case.
- `unstake()` then `claimRewards()` — drain both buffers in one tx.
- `swap(...)` then `unstake()` then `claimRewards()` — owner
  self-executes a trade and immediately drains.
- `settle(partialLiquidity, ...)` then `claimRewards()` — owner
  harvests accumulated surplus without full exit and immediately
  claims it.
- `increaseStake(...)` then `setYieldTarget(...)` — owner adds capital
  and re-anchors the yield rate atomically (different from the
  proportional auto-scaling that `increaseStake` applies).

Per-call state checks remain authoritative — `multicall` does not
bypass them. The `nonReentrant` modifier across calls in the same
multicall is handled per individual call (each enters and exits its
own guard).

## 13. Out of scope

The following are explicitly out of scope for this RFC:

- **Multi-position vaults.** Each vault wraps exactly one NFT. Owners
  with multiple positions deploy multiple vaults via the factory.

- **Cross-vault accounting.** Each vault is fully self-contained.
  There is no protocol-level treasury, fee, or shared state.

- **Vault transferability.** The owner is bound at clone init time
  and cannot be changed. Owners who want to transfer ownership
  effectively close out (`setYieldTarget(0)` + settle if needed) and
  re-stake under the new owner.

- **Per-vault TWAP windows or oracle configuration.** The vault is
  fully oracle-free.

- **Range adjustment after `stake()`.** No changes to `tickLower`,
  `tickUpper`, no reposition. `increaseStake` only adds liquidity to
  the existing range.

- **Subclass-specific specifications.** Each concrete subclass has
  its own SPEC. This RFC defines the architecture and the contract
  the base offers; SPEC-0003b implements the base plus
  `ManualStakingVault`; SPEC-0003c implements `KeeperStakingVault`;
  the future `CowStakingVault` will have its own SPEC contingent on
  the watch-tower spike.

- **Vault-implementation registry / multi-kind factory.** Specified
  separately in `spec-0003d-vault-implementation-registry.md`.

## 14. Design decisions log

Decisions made during chat-mode design that are now baked in:

- **Abstract base + concrete subclasses.** The owner-side contract is
  invariant across automation strategies and lives in the abstract
  base. Permissionless settlement strategies are concrete subclasses.
  This split was driven by the realization that CoW Protocol
  integration requires non-trivial setup that doesn't fit
  keeper-style automation, and the future need to support multiple
  parallel strategies without forking the core vault.

- **Verb-based naming taxonomy.** Pure verbs (`swap`, `settle`,
  `stake`, `increaseStake`, `unstake`, `claimRewards`) are
  owner-only. Subclass `execute*` variants (`executeSwap`,
  `executeSettle`) are permissionless. View functions use the
  `quote*` prefix (`quoteSwap`, `quoteSettle`).

- **`stakeTopUp` renamed to `increaseStake`.** Verb-taxonomy
  consistency. Symmetric with a hypothetical future `decreaseStake`
  if needed (currently out of scope).

- **No `flashSettle` function.** Earlier drafts had a callback-based
  owner exit covering all cases including Underwater. Removed in
  favor of the simpler `setYieldTarget(0)` Underwater-escape: the
  owner reduces T to make the position settle-able, then exits via
  the appropriate base path. This eliminates a callback interface,
  a transient state, and a complex helper-contract design surface.

- **`settle()` is owner-only and partial-capable.** Earlier drafts
  had `settle` as the permissionless Case-1 path. The permissionless
  Case-1 path is now `executeSettle()` in the keeper subclass. The
  base `settle()` is the symmetric counterpart to `swap()` for
  owner-side action: same partial-capable, same buffer-routing
  semantics, just for the no-trade case. The base contract therefore
  gives the owner a complete settlement toolkit without any subclass
  automation.

- **Liquidity over basis points.** NFPM liquidity units (uint128) are
  used as the close-size parameter. Liquidity is the natural
  primitive for UV3, makes top-up semantics simpler, and avoids the
  implicit-vs-explicit-fraction confusion of an earlier `pendingBps`
  draft.

- **`uint8` state with constants instead of Solidity `enum`.** Allows
  subclasses to extend the state set with their own values starting
  at 3 without forking the enum or adding cross-subclass coupling.

- **`executeSettle` is structurally symmetric with `executeSwap`.**
  An earlier draft of this RFC had `executeSettle(recipient, ...)`
  as a no-callback function that transferred the surplus over
  `(B, Q + T)` directly to a caller-supplied recipient. The current
  design replaces this with a callback pattern symmetric to
  `executeSwap`: the floor `(B, Q + T)` is locked into buffers
  first, both surpluses are pushed to the callback, and whatever
  the callback returns flows into the reward buffer via
  `_settleBuffersAndStake`'s balance-delta logic. This makes the
  vault agnostic to bounty routing (a Closer Contract handles it),
  and gives a uniform settlement-routing pattern across both
  `execute*` functions.

- **Surplus routed through callback in `executeSettle`.** The
  surplus over `(B, Q + T)` in Case 1 is pushed to the callback;
  the callback decides what to return to the vault (rewardBuffer
  for the owner) versus retain externally (caller's profit /
  third-party bounty / treasury fee). The yield-target T itself
  always stays with the owner via the reward buffer; it is locked
  in before the callback is invoked. Owner trades the right to the
  surplus against the guarantee that the position settles
  automatically when the target is reached.

- **Underwater = T-escapable.** Mathematically Case 4 is only
  reachable when `T > 0`. Setting `T = 0` always makes the position
  settle-able. This is the canonical Underwater-escape, replacing
  earlier callback-based helper designs.

- **No oracle, no TWAP.** Earlier drafts proposed a 5%-discount Case
  for both-surplus situations using TWAP-spot pricing. Replaced by
  the `executeSettle` callback mechanism. The vault is now fully
  oracle-free.

- **Overpayment to reward in `execute*` callbacks.** Callback
  overpayment (returning more than the minimum required, or any
  return at all in `executeSettle`) flows into the reward buffer
  via the post-call balance-delta computation in
  `_settleBuffersAndStake`. This makes defensive callback
  implementations safe (round-up buffers, slippage cushions,
  flash-loan fee margins) and uniform across both `execute*`
  functions.

- **Owner-side floor as central invariant.** All settlement paths,
  base or subclass, MUST preserve `unstake() + claimRewards() ≥
  (B × frac, (Q + T) × frac)` for any settled fraction `frac`. This
  is the protocol's contract with the position owner, and it is the
  one thing subclasses MUST NOT break. In the keeper subclass,
  the floor is locked into buffers BEFORE any callback runs,
  making it structurally inviolable regardless of callback
  behavior.

## 15. Open questions

- **`executeSettle` callback retaining nothing.** The function does
  not revert if `baseSurplus == 0 AND quoteSurplus == 0` (boundary
  case `b == B AND q == Q + T`). The position settles; the callback
  is invoked with zero-amount pushes; reward buffer receives only
  T. Caller bears their gas with no surplus distribution. Decision:
  keep the no-revert behavior so an owner-affiliated helper can
  trigger settlement even without bounty; bot operators self-select
  by checking `quoteSettle()` first.

- **Recipient for `swap()`.** Currently `recipient` is mandatory and
  cannot be `address(0)`. Should `address(0)` be interpreted as
  "owner"? Decision: no, explicitness preferred. Owner specifies
  `recipient = msg.sender` if they want to send to themselves.

- **Future `decreaseStake()` symmetry.** Currently no path exists to
  reduce position size without going through full settlement. A
  hypothetical `decreaseStake` could mirror `increaseStake` for
  partial principal withdrawal without forcing a settle. Out of
  scope for this RFC; if needed it would be a SPEC follow-up
  (SPEC-0003*).
