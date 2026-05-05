# What is a `uniswapv3-staking-vault` position?

> Phase 1 concept document for the Uniswap V3 Staking Vault integration,
> per [how-to-implement-new-positions.md](../../how-to-implement-new-positions.md).
> This document fixes the position's identity, lifecycle, and economic
> invariant. It is the north star for Phase 2 (metrics) and Phase 3 (UI).
> See [mental-model.md](./mental-model.md) for the user-facing framing
> that motivates the decisions captured here.

## 1.1 Identity

**`protocol`**: `uniswapv3-staking-vault`

The discriminator names the specific vault construct, not the broader
"Uniswap V3 staking" category. Future staking wrappers around UV3 (e.g.
a shared-vault variant managing many positions in one contract) would
take their own discriminator under the same family.

**`type`**: `STAKING` (new value; not reused from `LP_CONCENTRATED`)

The `type` discriminator names the **risk class**, not the vehicle. A
bare UV3 NFT under `LP_CONCENTRATED` carries the classical LP risk
shape — continuous rebalancing, IL/LVR exposure, range mechanics, fee
accrual visible to the holder. The vault deliberately hides those from
the user: from outside, the position behaves as a fixed-deposit-like
construct with a market-conditional yield claim. That is a different
risk shape and warrants its own type. The `STAKING` value is generic
enough to admit future non-vault staking constructs (shared vaults,
hook-based variants) under the same risk class without further type
proliferation.

**`positionHash`**: `uniswapv3-staking-vault/<chainId>/<vaultAddress>`

The vault address is globally unique per chain; each vault is its own
EIP-1167 clone with its own address. The wrapped UV3 NFT's `tokenId`
is an internal implementation detail of the vault — one vault holds
exactly one position over its lifetime (SPEC-0003a §1: _"One vault per
UV3 position"_), so `tokenId` is derivable from `vaultAddress` and is
not part of the position's identity.

**Owner model**: Owner-bound 1:1

A single user owns a single contract clone. Ownership is encoded
on-chain at clone initialisation and is structurally immutable —
SPEC-0003a §1: _"The owner address is set once during clone
initialization. Once set, it MUST NOT be mutable. No transfer function,
no ownership token, no upgrade mechanism that could rebind it."_

The factory's `createVault()` performs deployment AND initialisation
atomically in the same call frame, closing the standard EIP-1167
front-running race where a third party could claim ownership of a
freshly deployed but uninitialised clone. From an integration
perspective: every vault address has exactly one owner, known
unambiguously from the moment the vault exists.

## 1.2 Lifecycle

Three user-facing states:

- **`Empty`** — clone is deployed, `stake()` has never been called.
  Formally the entry state, but typically observable only for a few
  microseconds: the factory composes deploy + initialise + initial
  stake into a single transaction by convention. We retain the state
  in the model as the formal origin of the lifecycle, not as a
  realistic user-facing state.
- **`Staking`** — UV3 position is open and active. `swap()` is
  callable, all owner levers (top-up, yield-target adjustment, partial
  unstake) are available. The normal operating state.
- **`Settled`** — position is fully closed (`liquidity == 0`). No new
  operations possible, but `unstake()` and `claimRewards()` remain
  callable to drain any buffered amounts the final settlement filled.
  Terminal.

**Naming note.** The user-facing name `Staking` deliberately diverges
from SPEC-0003a's on-chain storage name `Staked`. Gerund vs. past
participle is a meaningful distinction here: the on-chain storage slot
records that staking _has occurred_, while the user-facing state names
the activity that _is occurring_. Both names are correct in their own
domain; the divergence should not surprise readers who put SPEC and
this document side by side.

**On-chain-only state.** SPEC-0003a §4 also defines a
`FlashCloseInProgress` storage state. It is a transient reentrancy
lock that lives only inside a single transaction — it is never
observable as the persistent state between transactions, so it is not
part of the user-facing lifecycle. It belongs to the contract's
implementation, not to the position's semantics.

### Transitions

| From | To | Trigger | Class | Reversible? |
|---|---|---|---|---|
| `Empty` | `Staking` | `stake()` (initial) | owner-initiated | no |
| `Staking` | `Staking` | `stake()` (top-up) | owner-initiated | self-loop |
| `Staking` | `Staking` | `setYieldTarget()` | owner-initiated | self-loop |
| `Staking` | `Staking` | `setPartialUnstakeBps()` / `increasePartialUnstakeBps()` | owner-initiated | self-loop |
| `Staking` | `Staking` | `swap()` with `effectiveBps < 10000` | permissionless | self-loop |
| `Staking` | `Staking` | `unstake()` / `claimRewards()` | owner-initiated | self-loop |
| `Staking` | `Staking` | `flashClose(bps < 10000)` | owner-initiated | self-loop |
| `Staking` | `Settled` | `swap()` with `effectiveBps == 10000` | permissionless | no |
| `Staking` | `Settled` | `flashClose(10000)` | owner-initiated | no |
| `Settled` | `Settled` | `unstake()` / `claimRewards()` | owner-initiated | self-loop |

`multicall()` is not a transition in its own right; it composes the
transitions above and inherits their state checks per inner call.

### Two structural properties

**Forward-monotonic.** There is no path from `Staking` back to `Empty`,
and no path from `Settled` back to `Staking`. SPEC-0003a §19 enumerates
the deliberate omissions: no `cancelStake()`, no range adjustment, no
position re-mint. The lifecycle is a strict forward axis. For the UI
this means the lifecycle badge has no surprises; for the indexer it
means a simple monotonic state derivation from event order.

**No automatic transitions.** Nothing in this design happens
chain-driven without an explicit transaction. Even `Settled` is not
reached automatically when some market condition flips — it always
requires a caller (executor via `swap`, owner via `flashClose`). This
distinguishes the vault from positions with auto-liquidation
(lending, perps). Phase 4 (on-chain pipeline) does not need a
background watcher for passive transitions.

## 1.3 Economic invariant

### What the position does economically

The vault converts a continuously-rebalancing UV3 position into a
**terminable fixed-deposit construct with an embedded limit-order
clause**. The owner provides an inventory `(B, Q)`, defines a yield
expectation `T` in quote units, and on regular settlement receives
exactly `(B, Q + T)` back. Market activity in between is absorbed by
the vault; the owner sees neither the tick-crossings nor the range
behaviour of the wrapped NFT.

The user's exposure decomposes into two distinct components:

- A **deterministic quote claim** of size `T` (the yield target),
  realised only if a settlement actually occurs.
- An **underwater residual risk** on the principal `(B, Q)` itself,
  realisable if the owner exits via `flashClose` while market
  conditions cannot deliver `(B, Q + T)`.

These two components are not "two parts of one return" — they are two
separate claims with different guarantee classes, and the owner
chooses via `T` which class is active. This is the central
characterisation; everything below sharpens it.

### The token-conservation invariant

For every settlement event closing a fraction `bps` of the staked
liquidity, the vault structurally guarantees:

> **The owner receives at least `(B × bps/10000, Q × bps/10000)` of
> principal and at least `T × bps/10000` of quote-side yield, for the
> closed fraction `bps`.**

This invariant is encoded in `swap()`: the executor _must_ fill the
deficit on each side, otherwise the transaction reverts (SPEC-0003a §13).
The invariant is range-independent (evaluated only at settlement,
never continuously), top-up-stable (scales proportionally with each
top-up per SPEC §8.2), and partial-stable (additive across multiple
settlements per `bps`).

A property of the underlying UV3 primitive does most of the work here:

> **Closing a UV3 position via `decreaseLiquidity + collect` never
> yields both `b < B` and `q < Q` simultaneously.**

The bonding curve traverses a single conversion direction at a time
(price up → sells base, gains quote; price down → gains base, sells
quote), and fees accumulate additively on both sides. There is no
market path that reduces both inventory sides at once. This is a UV3
property, not a vault property — the vault inherits it.

### Two guarantee classes

The owner chooses, via `T`, which of two guarantee classes is active:

**Strong guarantee (T = 0): principal-only, structurally always
honourable.** With `T = 0`, the partial-target reduces to
`(B × bps/10000, Q × bps/10000)`. By the UV3 property above, the
condition `b < targetBase AND q < targetQuote` becomes structurally
impossible — every settlement falls into Case 1, 2, or 3 of SPEC-0003a
§11. The vault is **always liquidatable via `swap()`**, and the owner
recovers principal `(B, Q)` exactly. There is no market scenario that
prevents principal recovery. The vault is never structurally
insolvent against a `T = 0` claim.

**Conditional guarantee (T > 0): principal-plus-yield, market-dependent.**
With `T > 0`, the partial-target widens to
`(B × bps/10000, (Q + T) × bps/10000)`, and a Case-4 region opens up
in the inventory space:
`Q × bps/10000 ≤ q < (Q + T) × bps/10000` combined with `b < targetBase`.
This region exists _only because_ `T > 0`. In Case 4, `swap()` reverts
with `Underwater()`. The owner can:

- wait for market conditions to change (the vault stays in `Staking`,
  fees may accumulate, price may move back into a settleable region),
- call `setYieldTarget(0)` (or any lower value that the current
  inventory can support) — this collapses Case 4 back into Cases 1–3
  and restores `swap()` callability, but at the cost of forgoing the
  original yield claim,
- exit via `flashClose` (see below) at the realised market value.

Underwater is therefore not "the market broke the vault" — it is "the
owner's yield claim exceeds the market's current ability to deliver".
The owner caused it (by setting `T`), and the owner can resolve it
(by lowering `T`).

### Three exit paths

When the owner wants to terminate the position, three paths are
available, in descending order of accounting cleanliness:

**(1) Wait for an external executor.** The vault sits in `Staking`
until a third-party executor (solver, MEV bot, keeper) calls `swap()`
because external conditions make the offered rate profitable for them.
Maximally clean: the four canonical events (`Stake`, `Swap`,
`Unstake`, `ClaimRewards`) appear in their intended order, the owner
is uninvolved during the swap itself, and tokens never flow through
the owner's wallet during settlement. Cost: waiting time, market-
dependent.

**(2) Self-execute via `swap()`.** The owner calls `swap()` themselves,
supplying the deficit-side liquidity (quote in Case 2, base in Case 3)
from their own wallet. This stays fully inside the staking semantics:
the event sequence is identical to (1), with the owner address in the
`executor` slot of the `Swap` event. Three separable token movements
result — owner-as-executor sends `amountIn`, owner-as-executor receives
`amountOut`, owner-as-owner later receives `unstake()` and
`claimRewards()` payouts — and each is bookable independently in the
owner's accounting. The "below-spot" component the owner appears to
pay themselves is a temporary capital lock-up, not an economic loss:

- At `T = 0`, the swap is a structurally fair inventory cycle; the
  owner's net token position changes by zero (excluding gas).
- At `T > 0`, the swap funds the `T` payout from the owner's own
  liquidity, which then returns to them via `claimRewards()`. Again
  net zero, with a visible accounting span across two movements that
  makes the `T` payment auditable.

This path is the under-appreciated middle option. It is always
available to an owner with sufficient liquidity, which is often the
case — an owner who sized `(B, Q)` typically holds comparable amounts
on their wallet.

**(3) `flashClose(bps)`.** Externally-financed exit via a flash-loan
callback (SPEC-0003a §15). Available when the owner has neither
patience nor liquidity. Auto-drains all buffers in a single transaction,
which collapses the `Stake → Swap → Unstake → ClaimRewards` event
sequence into a compressed `FlashCloseInitiated → Unstake → ClaimRewards`
that mixes the position-close, the flash-loan pull/repay, the external
swap, and the settlement drain into one transaction. The accounting
outcome is the same in net terms, but the events are no longer cleanly
separable. Cost: flash-loan fee plus possibly forgone yield.

The cleanliness ordering — **(1) wait > (2) self-execute > (3) flashClose**
— is what determines `flashClose`'s role in the design. It is the
emergency option, not the default convenience. Earlier framings of
`flashClose` as "the owner's go-to convenience function" were wrong;
it is the path the owner takes only when neither (1) nor (2) is
viable.

### What is emergent (not invariant)

- **When** settlement occurs — depends on spot-price movement, time
  in range, fee accumulation, executor behaviour, and owner action.
- **Which case** settlement falls into (1, 2, or 3) — depends on the
  position's end-state inventory.
- **How much above `T`** of quote value accumulates — goes to the
  executor, not the owner. From the user's perspective there is no
  "bonus", only the deterministic `T`.
- **Whether the position enters underwater at all** — depends on
  volatility and range choice relative to the chosen `T`.

### Yield: origins and mechanism

The yield the owner receives has two structural sources, which the
vault collapses externally into a single number:

- **UV3 fees** that accumulate over the position's lifetime, on both
  token sides, collected via `collect` at settlement.
- **LVR substance** that the executor voluntarily transfers to the
  vault: the executor pays a below-spot rate at `swap()`, and the
  difference between spot and the executor's input flows into the
  reward buffer. The executor accepts this because their net is still
  positive against external venues — the pool's tractability condition
  is `Fee-APR > σ²/8` (see [lvr-theory-summary.md] context).

Both sources flow indistinguishably into the `rewardBuffer*` slots
(SPEC-0003a §11) and are paid to the owner via `claimRewards()`. The
owner sees a single yield number: `T`, quote-denominated, agreed up
front, paid at settlement. The decomposition into "fees" and
"LVR-compensation" does not exist for the user — and that is by
design.

### Risk: origins and crystallisation points

Four risk classes, each with a clear crystallisation point:

| Risk | Driver | Crystallises at |
|---|---|---|
| **Principal risk** | structurally **zero at `T = 0`**; non-zero only if owner exits via `flashClose` while `T > 0` is unresolved | `flashClose` call (and only if owner has not first lowered `T`) |
| **Yield-fulfilment risk** | volatility relative to range width and `T` size | First settlement attempt; or owner's `setYieldTarget(0)` decision to abandon the claim |
| **Liquidity risk on `flashClose`** | external flash-loan provider conditions (Aave / Balancer / Morpho) | `flashClose` call |
| **Smart-contract risk** | bugs in vault, NFT manager, or flash-loan provider | Exploit events; mitigation is audit + time-in-production |

Two risks deliberately **not** in this list:

- **IL / LVR from owner perspective.** The vault absorbs both; the
  owner does not see them. The owner economically still bears LVR
  (they cede LVR substance to the executor), but as a component of
  "T vs. market upside" rather than a separate risk.
- **Permissionless executor behaviour.** Not a risk in the classical
  sense, because the executor can structurally only act under
  conditions that preserve principal and yield. The owner does not
  need to trust the executor.

The take-away: the vault has **two guarantee classes**, and the owner
chooses via `T` which class is active. The strong guarantee
(principal at `T = 0`) is always available; the weaker guarantee
(principal + `T` at `T > 0`) is market-conditional. Risk discussion
should always specify which class is in scope.
