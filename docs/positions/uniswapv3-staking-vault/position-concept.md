# What is a `uniswapv3-staking-vault` position?

> Phase 1 concept document for the Uniswap V3 Staking Vault integration,
> per [how-to-implement-new-positions.md](../../how-to-implement-new-positions.md).
> This document fixes the position's identity, lifecycle, and economic
> invariant. It is the north star for Phase 2 (metrics) and Phase 3 (UI).
> See [mental-model.md](./mental-model.md) for the user-facing framing
> that motivates the decisions captured here. Authoritative on-chain
> sources are [rfc-0003-staking-vault.md](./rfc-0003-staking-vault.md)
> for the architecture, [spec-0003b-abstract-staking-vault.md](./spec-0003b-abstract-staking-vault.md)
> for the abstract base and `ManualStakingVault`, and
> [spec-0003c-keeper-staking-vault.md](./spec-0003c-keeper-staking-vault.md)
> for `KeeperStakingVault`.

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
exactly one position over its lifetime (RFC-0003 §13: _"Each vault
wraps exactly one NFT."_), so `tokenId` is derivable from
`vaultAddress` and is not part of the position's identity.

**Subclass identity is metadata, not part of the hash.** The contract
ships as an abstract base plus concrete subclasses
(`ManualStakingVault`, `KeeperStakingVault`, deferred
`CowStakingVault`); see RFC-0003 §5. The chosen subclass is **fixed
at deploy time** and queryable on-chain via `vault.kindLabel()`
(returning a `keccak256("manual-staking-vault-v1")`-style identifier).

The subclass is _not_ part of `positionHash` — it would inflate the
identity space without changing what the position _is_ from the
ledger's perspective: the same `(B, Q, T)` settlement contract, the
same buffer mechanics, the same owner-side floor `(B × frac,
(Q + T) × frac)` per RFC-0003 §6.4. The subclass only changes _who
can act_ permissionlessly (nobody in Manual; keepers in Keeper; CoW
solvers in the deferred Cow variant). This belongs in the type-specific
metric `state.kindLabel`, not in the identity. Phase 2 picks this up.

The factory consults a vault implementation registry
(SPEC-0003d, separate) to deploy the right clone for the user's
chosen subclass. Discovery (Phase 5) and the Add-Position flow
(Phase 3) need to handle this multi-kind surface explicitly.

**Owner model**: Owner-bound 1:1

A single user owns a single contract clone. Ownership is encoded
on-chain at clone initialisation and is structurally immutable — the
owner address is set once during clone initialization and cannot be
changed (no transfer function, no ownership token, no upgrade
mechanism that could rebind it).

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
- **`Staking`** — UV3 position is open and active. All owner levers
  (top-up via `increaseStake`, yield-target adjustment, partial
  swap/settle, drains) are available. Permissionless paths
  (`executeSwap` / `executeSettle`) are available in subclasses that
  expose them. The normal operating state.
- **`Settled`** — position is fully closed (`liquidity == 0`). No new
  settlement operations possible, but `unstake()` and `claimRewards()`
  remain callable to drain any buffered amounts the final settlement
  filled. Terminal.

**Naming note.** The user-facing name `Staking` deliberately diverges
from the on-chain storage name `Staked` (RFC-0003 §10). Gerund vs.
past participle is a meaningful distinction here: the on-chain
storage slot records that staking _has occurred_, while the
user-facing state names the activity that _is occurring_. Both names
are correct in their own domain; the divergence should not surprise
readers who put SPEC and this document side by side.

**Subclass-specific transient states.** The base contract exposes
only the three persistent states above. Subclasses with callback-based
permissionless paths add transient states that exist only inside a
single transaction's execution frame. `KeeperStakingVault` adds
`ExecuteSwapInProgress` (RFC-0003 §10), set during the keeper-supplied
callback frame and reverted on successful return. These transient
states are never observable as the persistent state between
transactions and are not part of the user-facing lifecycle. They
belong to the contract's implementation, not to the position's
semantics.

### Transitions

The transition table is split into rows that exist in every subclass
(rows from the abstract base) and rows that exist only in specific
subclasses (`KeeperStakingVault` for now; `CowStakingVault` deferred).

| From | To | Trigger | Class | Subclass | Reversible? |
|---|---|---|---|---|---|
| `Empty` | `Staking` | `stake()` (initial) | owner | all | no |
| `Staking` | `Staking` | `increaseStake()` (top-up) | owner | all | self-loop |
| `Staking` | `Staking` | `setYieldTarget()` | owner | all | self-loop |
| `Staking` | `Staking` | `swap(liquidity)` (partial, Cases 2/3) | owner | all | self-loop |
| `Staking` | `Staking` | `settle(liquidity)` (partial, Case 1) | owner | all | self-loop |
| `Staking` | `Staking` | `unstake()` / `claimRewards()` | owner | all | self-loop |
| `Staking` | `Settled` | `swap(liquidity)` (full close) | owner | all | no |
| `Staking` | `Settled` | `settle(liquidity)` (full close, Case 1) | owner | all | no |
| `Staking` | `Settled` | `executeSwap()` (Cases 2/3, full only) | permissionless | Keeper | no |
| `Staking` | `Settled` | `executeSettle(recipient)` (Case 1, full only) | permissionless | Keeper | no |
| `Settled` | `Settled` | `unstake()` / `claimRewards()` | owner | all | self-loop |

`multicall()` is not a transition in its own right; it composes the
transitions above and inherits their state checks per inner call.

### Three structural properties

**Forward-monotonic.** There is no path from `Staking` back to `Empty`,
and no path from `Settled` back to `Staking`. RFC-0003 §13 enumerates
the deliberate omissions: no cancel-stake, no range adjustment, no
position re-mint. The lifecycle is a strict forward axis. For the UI
this means the lifecycle badge has no surprises; for the indexer it
means a simple monotonic state derivation from event order.

**No automatic transitions.** Nothing in this design happens
chain-driven without an explicit transaction. Even `Settled` is not
reached automatically when some market condition flips — it always
requires a caller (owner via `swap`/`settle`, keeper via
`executeSwap`/`executeSettle` in the Keeper subclass). This
distinguishes the vault from positions with auto-liquidation
(lending, perps). The data pipeline (Phase 5) does not need a
background watcher for passive transitions.

**Permissionless paths are full-close only.** Where a subclass exposes
permissionless callers, they always close the entire remaining
position. Partial settlement is owner-only. RFC-0003 §8.2 makes this
explicit: a permissionless partial close would shrink `T`
proportionally on the residual liquidity, and a subsequent keeper call
on the residual could find a Case-4 position — the yield-target
promise breaks across keeper calls. Partial close therefore stays in
the owner's hands across all subclasses.

## 1.3 Economic invariant

### What the position does economically

The vault converts a continuously-rebalancing UV3 position into a
**terminable fixed-deposit construct with an embedded limit-order
clause**. The owner provides an inventory `(B, Q)`, defines a yield
expectation `T` in quote units, and on regular settlement receives
exactly `(B, Q + T)` back per closed fraction. Market activity in
between is absorbed by the vault; the owner sees neither the
tick-crossings nor the range behaviour of the wrapped NFT.

The user's exposure decomposes into two distinct components:

- A **deterministic quote claim** of size `T`, realised only if a
  settlement actually occurs.
- A **target-flexibility lever** on the principal: by raising or
  lowering `T` mid-life, the owner trades expected yield against
  exit optionality. At `T = 0` the position is always settle-able;
  at `T > 0` settlement is market-conditional.

These two components are not "two parts of one return" — they are
two separate claims with different guarantee classes, and the owner
chooses via `T` which class is active. This is the central
characterisation; everything below sharpens it.

### The token-conservation invariant

For every settlement event closing a fraction `frac` of the staked
liquidity, the vault structurally guarantees:

> **The owner receives at least `(B × frac, (Q + T) × frac)` for the
> closed fraction, drainable via `unstake()` plus `claimRewards()`.**

This is the **owner-side floor** (RFC-0003 §6.4). It is encoded by
construction in the base contract's internal helper
`_settleBuffersAndStake`, which credits exactly `(B × frac, Q × frac)`
to the unstake buffer and the entire excess to the reward buffer in
every base-contract code path. Subclasses inherit the floor and MUST
NOT break it (RFC-0003 §7.2); per-subclass review enforces this.

The floor is range-independent (evaluated only at settlement, never
continuously), top-up-stable (scales proportionally with each
`increaseStake` per RFC-0003 §6.2), and partial-stable (additive
across multiple settlement calls).

A property of the underlying UV3 primitive does most of the work here:

> **Closing a UV3 position via `decreaseLiquidity + collect` never
> yields both `b < B × frac` and `q < Q × frac` simultaneously.**

The bonding curve traverses a single conversion direction at a time
(price up → sells base, gains quote; price down → gains base, sells
quote), and fees accumulate additively on both sides. There is no
market path that reduces both inventory sides at once. This is a UV3
property, not a vault property — the vault inherits it.

### Two guarantee classes

The owner chooses, via `T`, which of two guarantee classes is active:

**Strong guarantee (`T = 0`): principal-only, structurally always
honourable.** With `T = 0`, the partial-target reduces to
`(B × frac, Q × frac)`. By the UV3 property above, the condition
`b < B × frac AND q < Q × frac` becomes structurally impossible —
every settlement falls into Case 1, 2, or 3 of RFC-0003 §4. The vault
is **always settle-able**, and the owner recovers principal `(B, Q)`
exactly. There is no market scenario that prevents principal recovery.
The vault is never structurally insolvent against a `T = 0` claim.

**Conditional guarantee (`T > 0`): principal-plus-yield,
market-dependent.** With `T > 0`, the partial-target widens to
`(B × frac, (Q + T) × frac)`, and a Case-4 region opens up in the
inventory space: `Q × frac ≤ q < (Q + T) × frac` combined with
`b < B × frac`. This region exists _only because_ `T > 0`. In Case 4,
all settlement paths revert (`swap`, `settle`, `executeSwap`,
`executeSettle` all require a non-Underwater state). The owner can:

- wait for market conditions to change (the vault stays in `Staking`,
  fees may accumulate, price may move back into a settle-able region),
- call `setYieldTarget(0)` (or any lower value that the current
  inventory can support) — this collapses Case 4 back into Cases 1–3
  and restores settle-ability, at the cost of forgoing the original
  yield claim.

Underwater is therefore not "the market broke the vault" — it is "the
owner's yield claim exceeds the market's current ability to deliver".
The owner caused it (by setting `T`), and the owner can resolve it
(by lowering `T`). Critically, **the resolution is not a loss path**:
when `T` is lowered enough to clear Underwater, settlement returns
the floor `(B × frac, (Q' + T') × frac)` for the new target `T'` —
including `(B × frac, Q × frac)` if `T' = 0`. Principal is never
forfeit through the Underwater-escape mechanism. The cost is purely
forgone yield.

### Settlement paths by subclass

The settlement menu depends on which subclass the vault clone is.
Owner-side paths exist in every subclass; permissionless paths are
subclass-specific and always full-close.

**Owner-side, all subclasses:**

- **`swap(liquidity, ...)` for Cases 2/3.** The owner closes a
  fraction of the position and trades against the vault at the
  LVR-implied rate from the post-close `(b, q)`. They supply the
  deficit-side amount (quote in Case 2, base in Case 3) and receive
  the surplus-side amount. Slippage bounds (`amountInMax`,
  `amountOutMin`) protect against pool drift between quote and call.
  Partial-capable. Reverts in Case 1 (use `settle`) and Case 4
  (lower `T` first).
- **`settle(liquidity, ...)` for Case 1.** The owner closes a
  fraction without any trade because both surpluses are already
  present. The buffers fill with `(B × frac, Q × frac)` on the
  unstake side and the entire surplus over those amounts on the
  reward side. Use case: the position has been running well, fees
  push `q` significantly above `(Q + T) × frac`, the owner harvests
  accumulated surplus without fully exiting. Partial-capable.
  Reverts in Cases 2, 3 (use `swap`) and Case 4 (lower `T` first).
- **`setYieldTarget(newT)` for Underwater escape.** Lowering `T` (or
  setting it to zero) collapses Case 4 back into Cases 1/2/3,
  restoring settle-ability via the matching path above.

**Permissionless, `KeeperStakingVault` only:**

- **`executeSwap(...)` for Cases 2/3, full close.** A keeper provides
  a callback contract; the vault closes the entire position, pushes
  the surplus token to the callback, and expects at least
  `amountInMin` of the deficit token returned within the same call
  frame. Keepers typically wrap `executeSwap` in a flash-loan
  callback (UV3 pool, Aave, Balancer) to source the deficit token
  without pre-funded inventory. Their profit comes from the spread
  between the LVR-implied rate offered by the vault and external
  markets — _not_ from the vault's reward buffer.
- **`executeSettle(recipient, ...)` for Case 1, full close.** A
  permissionless caller triggers settlement when both surpluses are
  present. The vault fills the unstake buffer with `(B, Q)` and the
  reward buffer with `T` (the yield-target portion). The remaining
  surplus over `(B, Q + T)` is transferred to `recipient` as a
  bounty. The bounty compensates gas and incentivises permissionless
  Case-1 settlement so the owner's yield target is realised without
  owner action. In practice the bounty is small: Case 1 only arises
  when fees push both `b` past `B` and `q` past `Q + T`
  simultaneously, and an `executeSwap` keeper would typically settle
  the position earlier in Case 2 or 3.

### Surplus allocation across paths

The owner-side floor `(B × frac, (Q + T) × frac)` is preserved on
every path. Where the surplus over that floor goes, however, depends
on the path:

| Path | Subclass | Surplus over `(B × frac, (Q + T) × frac)` flows to |
|---|---|---|
| `swap()` (Cases 2/3) | all | owner reward buffer |
| `settle()` (Case 1) | all | owner reward buffer |
| `executeSwap()` (Cases 2/3) | Keeper | owner reward buffer (callback overpayment included) |
| `executeSettle()` (Case 1) | Keeper | caller-supplied `recipient` as bounty |

Two important consequences:

- The owner who runs a `ManualStakingVault` keeps every wei the
  vault accumulates. There is no third-party leak.
- The owner who runs a `KeeperStakingVault` only loses the Case-1
  surplus (via `executeSettle`); in Cases 2/3 the keeper's profit
  is external to the vault, not extracted from it. The choice
  between Manual and Keeper is therefore not "do I sacrifice yield
  for automation?" — it is "do I sacrifice the rare Case-1 surplus
  for guaranteed Case-1 settlement without owner action?"

### What is emergent (not invariant)

- **When** settlement occurs — depends on spot-price movement, time
  in range, fee accumulation, keeper behaviour (Keeper subclass),
  and owner action.
- **Which case** settlement falls into (1, 2, or 3) — depends on the
  position's end-state inventory.
- **How much above `T`** of quote value accumulates — flows per the
  surplus-allocation table above. From the user's perspective the
  yield outcome is at least the deterministic `T`; the floor is the
  guarantee, anything above is path-dependent.
- **Whether the position enters Underwater at all** — depends on
  volatility and range choice relative to the chosen `T`.

### Yield: origins and mechanism

The yield the owner receives has two structural sources, which the
vault collapses externally into a single number:

- **UV3 fees** that accumulate over the position's lifetime, on both
  token sides, collected via `collect` at settlement.
- **LVR substance** that the settlement counterparty voluntarily
  transfers to the vault: the counterparty (owner-as-self in
  `swap()`, keeper in `executeSwap()`) pays a below-spot rate at
  the trade, and the difference between spot and counterparty input
  flows into the reward buffer. The counterparty accepts this
  because their net is still positive against external venues — the
  pool's tractability condition is `Fee-APR > σ²/8` (see
  [lvr-theory-summary.md] context).

Both sources flow indistinguishably into the `rewardBuffer*` slots
and are paid to the owner via `claimRewards()`. The owner sees a
single yield number: at least `T`, quote-denominated, agreed up
front, paid at settlement. The decomposition into "fees" and
"LVR-compensation" does not exist for the user — and that is by
design.

### Risk: origins and crystallisation points

Four risk classes, each with a clear crystallisation point:

| Risk | Driver | Crystallises at |
|---|---|---|
| **Principal risk** | structurally **zero** through the protocol's mechanism: every settle-path returns at least `(B × frac, (Q + T) × frac)`, and Underwater escapes via `setYieldTarget(0)` settle the position at `(B × frac, Q × frac)` | Never within the protocol's mechanism — only via external smart-contract failure (see below) |
| **Yield-fulfilment risk** | volatility relative to range width and `T` size | First settlement attempt; or the owner's `setYieldTarget(0)` decision to abandon the original claim |
| **Smart-contract risk (base)** | bugs in vault, NFPM, or pool contracts | Exploit events; mitigation is audit + time-in-production |
| **Smart-contract risk (subclass-specific)** | bugs in the keeper-callback surface (`KeeperStakingVault`) or solver-network integration (`CowStakingVault`, deferred) | Same; surface size grows with subclass complexity |

Two risks deliberately **not** in this list:

- **IL / LVR from owner perspective.** The vault absorbs both; the
  owner does not see them. The owner economically still bears LVR
  (they cede LVR substance to the settlement counterparty), but as
  a component of "T vs. market upside" rather than a separate risk.
- **Permissionless caller behaviour.** Not a risk in the classical
  sense, because permissionless callers can structurally only act
  under conditions that preserve the owner-side floor. The owner
  does not need to trust them. (`ManualStakingVault` has no
  permissionless callers at all.)

The take-away: the vault has **two guarantee classes**, and the
owner chooses via `T` which class is active. The strong guarantee
(principal at `T = 0`) is always available and structurally
unbreakable; the weaker guarantee (principal + `T` at `T > 0`) is
market-conditional but never costs principal — only forgone yield.
Risk discussion should always specify which class is in scope.

## 2.1 Common metric mapping

> **⚠ Phase 2 rewrite pending.** The §2 sections below were authored
> against the earlier SPEC-0003a contract. They reference removed
> mechanics (`partialUnstakeBps` / `effectiveBps`, `flashClose`,
> permissionless `swap`) and need to be rewritten against
> RFC-0003 + SPEC-0003b/c. A separate Phase-2 pass will reconcile
> the metric mapping, type-specific `state` shape, event taxonomy,
> and journal-posting rule with the new contract surface.

**Global valuation rule.** All live valuations of quote-denominated
quantities use the current pool price from `pool.slot0().sqrtPriceX96`.
External price sources (Coingecko, Chainlink, CEX aggregators) are not
admissible. Rationale: what the vault can actually deliver is
pool-intrinsic; an external valuation could produce a value that the
vault cannot realise.

**Default conventions.** Unless overridden below: `realizedCashflow =
unrealizedCashflow = 0` (the vault produces no periodic income stream
in the funding/interest sense; yield is an endpoint payout, not a
flow). `unrealizedPnl` is the standard derived value `currentValue −
costBasis`, not a stored cumulative.

| Field | Meaning for this position | On-chain reads / source | Unit, quote-side mapping | Ledger-derived vs. live |
|---|---|---|---|---|
| `id`, `userId`, `protocol`, `type`, `positionHash`, `createdAt`, `updatedAt`, `archivedAt`, `isArchived` | Standard framework fields | Database | n/a | DB-managed |
| `ownerWallet` | The on-chain vault owner, set at clone init and immutable | `vault.owner()` once at import | `evm:<address>` | Live, immutable after init |
| `currentValue` | Mark-to-market of vault contents at pool price: filled buffers + active wrapped-NFT liquidity (projected onto current tick) + uncollected UV3 fees, all in quote | `vault.unstakeBufferBase/Quote`, `vault.rewardBufferBase/Quote`, `npm.positions(tokenId).liquidity`, `tokensOwed*`, `pool.slot0()` | Quote bigint via `isToken0Quote` mapping; `base × P_pool + quote` decomposition | Live |
| `costBasis` | Cumulative quote value of capital currently deployed | Ledger-cumulative; written on `STAKING_DEPOSIT` (positive) and `STAKING_DISPOSE` (proportional negative) | Quote bigint | Ledger-derived |
| `realizedPnl` | Quote-denominated PnL recognised at disposal (`B × ΔP` insight: the principal payout valued at `P_settle` minus its proportional cost basis, minus any flash-loan fee) | Ledger-cumulative; written on `STAKING_DISPOSE` | Quote bigint | Ledger-derived |
| `realizedCashflow` | n/a — no periodic income stream in the vault model | — | `0` | constant |
| `unrealizedPnl` | Standard derived value `currentValue − costBasis` | Computed | Quote bigint | Live (derived) |
| `unrealizedCashflow` | n/a | — | `0` | constant |
| `collectedYield` | Cumulative quote value of yield recognised at the disposal that filled the reward buffer; valued at `P_settle` | Ledger-cumulative; written on `STAKING_DISPOSE` (the reward-fill component) | Quote bigint | Ledger-derived |
| `unclaimedYield` | Quote-valued contents of the reward buffer (UV3 fees + LVR substance + allocated `T` share) | `vault.rewardBufferBase × P_pool + vault.rewardBufferQuote` | Quote bigint | Live |
| `lastYieldClaimedAt` | Timestamp of the most recent `STAKING_CLAIM_REWARDS` event | Ledger | Date | Ledger-derived |
| `baseApr` | Time-weighted APR computed from `collectedYield` over weighted average `costBasis`, bracketed on `STAKING_DEPOSIT` and `STAKING_DISPOSE` events | `PositionAprPeriod` aggregation | Float, basis-point precision | Aggregated from ledger periods |
| `rewardApr` | n/a — no external incentive programmes | — | `null` | constant |
| `totalApr` | `baseApr` (or `null`) | Computed | Float \| null | Aggregated |
| `positionOpenedAt` | Timestamp of the first `STAKING_DEPOSIT` event | Ledger | Date | Ledger-derived |
| `priceRangeLower`, `priceRangeUpper` | The wrapped NFT's price range, projected into quote via `isToken0Quote` | Computed once at import from `vault.tickLower()`, `vault.tickUpper()` via `TickMath` | Quote bigint | Static (immutable post-init) |

**Notes on three contested choices.**

- **`currentValue` is mark-to-market, not settlement-now or
  flashClose-now.** Settlement-now valuation collapses under
  Underwater (where `swap()` reverts); flashClose-now requires a
  flash-loan-fee estimate that is not pool-intrinsic. Mark-to-market
  is always well-defined and symmetric with NFT valuation, which
  matters for portfolio-level aggregates.

- **`collectedYield` recognises at disposal time, symmetric with
  `realizedPnl`.** Both are recognised at the same event
  (`STAKING_DISPOSE`) because both reflect the realisation of position
  economics — `realizedPnl` for the principal component, `collectedYield`
  for the yield component. The drain events (`STAKING_UNSTAKE`,
  `STAKING_CLAIM_REWARDS`) are pure asset/liability movements within
  the position's accounting; they have no recognition impact.

  The mark-to-market value of buffered tokens between disposal and
  drain is reflected only in `unrealizedPnl` (live valuation of the
  buffer at pool price vs. its booked value at disposal). It does not
  produce a separate realised PnL component; the buffered tokens are
  held at-cost from the disposal moment until they leave the vault.
  Any FX drift on the base component between disposal and drain is
  visible to the user via the `unrealizedPnl` movement, then folds
  into the next disposal's `Realized Gains` / `Realized Losses` if
  not yet drained.

- **`priceRangeLower/Upper` is the wrapped-NFT range, not the
  swap-executable band.** The NFT range is the region where the
  position is productive (rebalancing, accruing fees) — the same
  semantics as for a bare NFT position, and the same condition under
  which the position is in profit at settlement (modulo the LVR
  substance ceded to the executor). The Underwater condition is
  surfaced separately in `state.swapStatus`, not via the range field.

## 2.2 Type-specific metrics

The `state` JSON shape under `@midcurve/shared/src/types/position/uniswapv3-staking-vault/`. Filter test: included if the UI reads it for a badge, action gate, or status label; excluded if it is only an implementation detail of `currentValue`.

| Field | Type | Source | UI consumer |
|---|---|---|---|
| `vaultState` | `'Empty' \| 'Staking' \| 'Settled'` | `vault.state()`, mapped (on-chain `Staked → Staking`; `FlashCloseInProgress` is transient and never observed between transactions) | Lifecycle badge in card header |
| `swapStatus` | `'NotApplicable' \| 'NoSwapNeeded' \| 'Executable' \| 'Underwater'` | `vault.quoteSwap().status` | Health indicator badge; gates the self-execute swap button |
| `swapQuote` | `{ tokenIn, minAmountIn, tokenOut, amountOut, effectiveBps } \| null` | `vault.quoteSwap()` (full struct) | Swap tab in detail page; informs the close-position formular |
| `stakedBase` | `bigint` | `vault.stakedBase()` | Current-stake display; input for PnL-curve simulation |
| `stakedQuote` | `bigint` | `vault.stakedQuote()` | dito |
| `yieldTarget` | `bigint` | `vault.yieldTarget()` | "T" display; key configuration parameter |
| `pendingBps` | `number` (0..10000) | `vault.partialUnstakeBps()` | "Partial unstake pending: X%" indicator |
| `effectiveBps` | `number` (1..10000) | derived: `pendingBps == 0 ? 10000 : pendingBps` | Shows what fraction the next swap would actually settle |
| `unstakeBufferBase`, `unstakeBufferQuote` | `bigint` | `vault.unstakeBufferBase/Quote()` | Drain-principal button gating (enabled if > 0) |
| `rewardBufferBase`, `rewardBufferQuote` | `bigint` | `vault.rewardBufferBase/Quote()` | Claim-rewards button gating (enabled if > 0) |
| `sqrtPriceX96` | `bigint` | `pool.slot0().sqrtPriceX96` | Pool price display; input for currentValue and swapStatus |
| `currentTick` | `number` | `pool.slot0().tick` | In-range / out-of-range computation |
| `poolLiquidity` | `bigint` | `pool.liquidity()` | Optional comparison display (own position vs. pool TVL) |
| `wrappedNftLiquidity` | `bigint` | `npm.positions(wrappedTokenId).liquidity` | Active-liquidity indicator; null when `vaultState == Settled` |

**Stale-quote handling.** `swapQuote` changes block-by-block as
`sqrtPriceX96` moves. The cached value in `state` is only as fresh as
the last refresh. Before any user-initiated swap action (the "Execute
Swap" button in the swap tab), the UI must re-fetch the quote directly
from RPC and reconcile with the cached value. If the drift exceeds a
tolerated band, prompt the user to reconfirm — analogous to the
existing slippage-protection pattern on NFT close orders.

**Wrapped-NFT internals deliberately excluded.** The `feeGrowthInside*X128`
checkpoints, `tokensOwed*` snapshot, and tick-level fee-growth fields
are implementation details of how `currentValue` and `unclaimedYield`
are computed. The vault user does not see them: by design, the
wrapper hides UV3 internals so the user sees a single quote-valued
yield number, not a four-component fee picture. Power users who want
the on-chain detail can use a block explorer.

## 2.3 PnL decomposition

**Model A.** Yield is booked separately from PnL: `collectedYield` /
`unclaimedYield` are dedicated fields, `realizedPnl` carries only the
disposal consequence on the principal (the `B × ΔP` quantity). Yield
never lands in `pnl`. This conforms to [philosophy.md]'s
yield-vs-value-appreciation separation.

`realizedCashflow` and `unrealizedCashflow` are constant `0` (no
funding, no interest stream).

### Event taxonomy

Five new `EventType` values, prefixed `STAKING_*` (analogous to
`VAULT_*` for vault shares).

#### `STAKING_DEPOSIT`

Owner stakes — initial stake or top-up. Same delta pattern in both
cases; the distinction lives in NPM mechanics (mint vs.
increaseLiquidity), not in accounting.

| Field | Value |
|---|---|
| `deltaCostBasis` | `+(baseConsumed × P_stake + quoteConsumed)` |
| `deltaPnl` | `0` |
| `deltaCollectedYield` | `0` |
| `deltaRealizedCashflow` | `0` |
| `deltaLiquidity` | `+addedLiquidity` (UV3 L units) |
| `tokenValue` | equals `deltaCostBasis` |
| `rewards` | `[]` |
| `config` | `{ baseConsumed, quoteConsumed, baseRefunded, quoteRefunded, sqrtPriceX96 }` |

#### `STAKING_DISPOSE`

A disposal — `swap()` (permissionless or owner-self-execute, identical
accounting) or `flashClose()`. One event per disposal.

| Field | Value |
|---|---|
| `deltaCostBasis` | `−(costBasisBefore × bps / 10000)` |
| `deltaPnl` | `principalPayoutValue − proportionalCostBasis − flashLoanFee` |
| `deltaCollectedYield` | `+rewardFillValue` (recognition at disposal) |
| `deltaRealizedCashflow` | `0` |
| `deltaLiquidity` | `−removedLiquidity` |
| `tokenValue` | `0` (no movement to owner; tokens move into the buffers) |
| `rewards` | `[]` |
| `config` | `{ bps, disposalKind: 'swap' \| 'flashClose', executor, principalPayoutBase, principalPayoutQuote, rewardFillBase, rewardFillQuote, sqrtPriceX96, flashLoanFee }` |

`principalPayoutValue = principalPayoutBase × P_settle + principalPayoutQuote`. `rewardFillValue = rewardFillBase × P_settle + rewardFillQuote`. `flashLoanFee == 0` unless `disposalKind == 'flashClose'`. The `executor` field captures the `msg.sender` of the underlying call, which lets the UI distinguish self-executed from third-party-executed disposals; on `flashClose` it is always the owner.

#### `STAKING_UNSTAKE`

Drain of `unstakeBuffer*` to the owner. Owner-triggered, or
auto-emitted inside a `flashClose` transaction.

| Field | Value |
|---|---|
| `deltaCostBasis` | `0` |
| `deltaPnl` | `0` |
| `deltaCollectedYield` | `0` |
| `deltaRealizedCashflow` | `0` |
| `deltaLiquidity` | `0` |
| `tokenValue` | `+(drainedBase × P_drain + drainedQuote)` |
| `rewards` | `[]` |
| `config` | `{ drainedBase, drainedQuote, sqrtPriceX96 }` |

Marker only — cumulatives were already adjusted at `STAKING_DISPOSE`.
`tokenValue` records the actual movement to the owner for audit and
reconciliation.

#### `STAKING_CLAIM_REWARDS`

Drain of `rewardBuffer*` to the owner.

| Field | Value |
|---|---|
| `deltaCostBasis` | `0` |
| `deltaPnl` | `0` |
| `deltaCollectedYield` | `0` (already recognised at the prior `STAKING_DISPOSE`) |
| `deltaRealizedCashflow` | `0` |
| `deltaLiquidity` | `0` |
| `tokenValue` | `+(drainedBase × P_drain + drainedQuote)` |
| `rewards` | `[]` |
| `config` | `{ drainedBase, drainedQuote, sqrtPriceX96 }` |

Marker only — `collectedYield` was incremented at the `STAKING_DISPOSE`
that filled the reward buffer. `tokenValue` records the actual
movement to the owner.

`rewards: []` is intentional. The `rewards` array is for external
reward-token programmes; the vault's intrinsic yield is in token0/
token1 amounts and is not a separate reward-token category.

#### `STAKING_CHANGE_CONFIG`

Owner-intent change — `setYieldTarget`, `setPartialUnstakeBps`, or
`increasePartialUnstakeBps`. Neutral in all financial dimensions, but
ledger-visible for audit trail and history-tab display.

| Field | Value |
|---|---|
| `deltaCostBasis` | `0` |
| `deltaPnl` | `0` |
| `deltaCollectedYield` | `0` |
| `deltaRealizedCashflow` | `0` |
| `deltaLiquidity` | `0` |
| `tokenValue` | `0` |
| `rewards` | `[]` |
| `config` | `{ action: 'setYieldTarget' \| 'setPartialUnstakeBps' \| 'increasePartialUnstakeBps', oldValue, newValue }` |

The journal-posting rule produces no `JournalEntry` for this event;
it is purely a marker.

### Account mapping

The journal-posting rule (`UniswapV3StakingVaultPostJournalEntriesRule`)
maps each non-marker event to a single journal entry containing all
required lines. The chart of accounts adds four new accounts to the
existing schema:

| Code | Account | Class | Normal side | Purpose |
|---|---|---|---|---|
| 1010 | Staking Position at Cost | Asset | Debit | Active UV3 liquidity, at acquisition cost |
| 1020 | Position Cash Holdings | Asset | Debit | Buffered tokens (unstake + reward), at disposal value |
| 2000 | Pending Settlement | Liability | Credit | Obligation to owner for buffered tokens, at disposal value |
| 4400 | Realized Yield | Revenue | Credit | Yield recognised at disposal |

Existing accounts in use: `3000 Contributed Capital`, `3100 Capital Returned`, `4100 Realized Gains`, `4300 FX Gain / Loss`, `5000 Realized Losses`.

The `2xxx` Liability class is new in the chart of accounts. Account
codes are suggestions; final assignment is the implementation phase's
responsibility (must align with existing conventions in
`account_definitions`).

#### `STAKING_DEPOSIT` (value `V`)

```
DR 1010 Staking Position at Cost   V
CR 3000 Contributed Capital        V
```

Identical to the existing NFT/Vault-Share acquisition pattern.

#### `STAKING_DISPOSE` (profitable)

```
DR 3100 Capital Returned          principalPayout + rewardFill
DR 1020 Position Cash Holdings    principalPayout + rewardFill
CR 1010 Staking Position at Cost  proportionalCostBasis
CR 4100 Realized Gains            principalPayout − proportionalCostBasis
CR 4400 Realized Yield            rewardFill
CR 2000 Pending Settlement        principalPayout + rewardFill
```

A single journal entry combining two effects. The first set of lines
(Capital Returned, Staking Position at Cost reduction, Realized Gains,
Realized Yield) follows the existing NFT/Vault-Share disposal pattern:
equity is reclassified from active capital to returned capital, the
cost basis is removed, gains and yield are recognised. The other two
lines (Position Cash Holdings, Pending Settlement) record the buffer
creation: tokens enter the vault's cash holdings as an asset, balanced
by a liability to the owner.

Balance check: DR `2 × (principalPayout + rewardFill)` equals CR
`proportionalCostBasis + (principalPayout − proportionalCostBasis) +
rewardFill + (principalPayout + rewardFill) = 2 × (principalPayout +
rewardFill)`. ✓

#### `STAKING_DISPOSE` (loss-making)

```
DR 3100 Capital Returned          principalPayout + rewardFill
DR 1020 Position Cash Holdings    principalPayout + rewardFill
DR 5000 Realized Losses           |principalPayout − proportionalCostBasis|
CR 1010 Staking Position at Cost  proportionalCostBasis
CR 4400 Realized Yield            rewardFill
CR 2000 Pending Settlement        principalPayout + rewardFill
```

Identical structure to the profitable variant, with `Realized Losses`
on the debit side instead of `Realized Gains` on the credit side.

#### `STAKING_DISPOSE` with non-zero `flashLoanFee`

If the on-chain pipeline can extract `flashLoanFee` separately (a
Phase 5 question — on-chain events do not directly emit this value;
the pipeline would need to parse provider-specific events from
Aave/Balancer/Morpho or compute the fee via token-difference on the
flash-loan helper contract), an additional pair of lines is appended:

```
DR 5000 Realized Losses           flashLoanFee
CR 3100 Capital Returned          flashLoanFee
```

If extraction is not feasible, the fee is implicit in a smaller
`principalPayout` and subsumed in `Realized Gains` / `Realized Losses`.
This is a pipeline-availability decision, not a concept-level
decision; the journal-posting rule will conditionally include or omit
these lines based on whether `config.flashLoanFee > 0`.

#### `STAKING_UNSTAKE` (drained value `V`)

```
DR 2000 Pending Settlement        V
CR 1020 Position Cash Holdings    V
```

Pure asset/liability movement. The drained value `V` equals the value
originally booked into Pending Settlement at the disposal — no
revaluation occurs at drain time. Any FX drift on the base component
between disposal and drain is visible only via the position's
`unrealizedPnl` (the live mark-to-market of the buffer at pool price
vs. its booked value at disposal). It does not produce a separate
realised PnL line at drain; if not yet drained, the drift folds into
the next disposal's `Realized Gains` / `Realized Losses`.

#### `STAKING_CLAIM_REWARDS` (drained value `V`)

```
DR 2000 Pending Settlement        V
CR 1020 Position Cash Holdings    V
```

Identical mechanism to `STAKING_UNSTAKE`, just for the reward-buffer
slice of `Pending Settlement`. Yield was already recognised as
`Realized Yield` at the prior `STAKING_DISPOSE`; the drain is a pure
asset/liability movement.

#### `STAKING_CHANGE_CONFIG`

No journal entry. Marker only.

### Reconciliation

`UniswapV3StakingVaultReconcileRule` periodically checks two
invariants:

- **Cost-basis invariant.** `1010 Staking Position at Cost` balance
  equals `Position.costBasis`. The primary check that
  deposit/disposal cost-basis movements are consistent.
- **Buffer-tracking invariant.** `1020 Position Cash Holdings` balance
  equals `2000 Pending Settlement` balance, both equal to the booked
  value of all four buffer slots (`unstakeBufferBase × P_settle +
  unstakeBufferQuote + rewardBufferBase × P_settle + rewardBufferQuote`,
  where `P_settle` is the pool price at the disposal that filled each
  buffer component). Note: this is the *booked* value, not the
  current pool-price-marked value, since neither account is revalued
  at drain.

A mismatch on either signals a missed event or a misposted event.

## 2.4 Domain events

Existing routing key family is reused: `position.liquidity.uniswapv3-staking-vault.<eventType>` with `eventType ∈ {deposit, dispose, unstake, claim_rewards, change_config}`. Existing payload shape (positionId, eventId, eventType, blockNumber, txHash, plus event-specific config) suffices — no payload extensions, no new exchange. Per the new guide §2.4, no deviation conditions apply.

## 2.5 Computation as code (deferred)

Per guide §2.5, the metric derivation rules are locked in TypeScript under `packages/midcurve-shared/src/metrics/uniswapv3-staking-vault/` (`common-metrics.ts` + `specific-metrics.ts`). This is a build artefact, not a concept artefact, and is produced as a separate implementation issue against the build phases — not as part of this concept document.
