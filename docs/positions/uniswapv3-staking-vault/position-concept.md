# What is a `uniswapv3-staking-vault` position?

> Phase 1 + 2 concept document for the Uniswap V3 Staking Vault
> integration, per [how-to-implement-new-positions.md](../../how-to-implement-new-positions.md).
> Phase 1 fixes the position's identity, lifecycle, and economic
> invariant. Phase 2 extends with the metric methodology — common
> metric mapping, type-specific `state` shape, and PnL decomposition.
> This document is the north star for Phase 3 (UI) and Phase 4
> (automation). See [mental-model.md](./mental-model.md) for the
> user-facing framing that motivates the decisions captured here.
> Authoritative on-chain sources are
> [rfc-0003-staking-vault.md](./rfc-0003-staking-vault.md) for the
> architecture, [spec-0003b-abstract-staking-vault.md](./spec-0003b-abstract-staking-vault.md)
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
single transaction's execution frame. `KeeperStakingVault` adds two:
`ExecuteSwapInProgress` (during the `executeSwap` callback frame) and
`ExecuteSettleInProgress` (during the `executeSettle` callback frame),
both per RFC-0003 §10. Both are set when entering the callback frame
and revert to `Settled` on successful return. These transient states
are never observable as the persistent state between transactions and
are not part of the user-facing lifecycle. They belong to the
contract's implementation, not to the position's semantics.

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
| `Staking` | `Settled` | `executeSwap(callback)` (Cases 2/3, full only) | permissionless | Keeper | no |
| `Staking` | `Settled` | `executeSettle(callback)` (Case 1, full only) | permissionless | Keeper | no |
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

- **`executeSwap(callback, ...)` for Cases 2/3, full close.** A
  keeper provides a callback contract; the vault closes the entire
  position, pushes the surplus token to the callback, and expects at
  least `amountInMin` of the deficit token returned within the same
  call frame. Keepers typically use the surplus tokens to source the
  deficit externally (sell on AMMs, fund the deficit return), keeping
  the spread between the LVR-implied rate and external markets as
  profit. Their profit comes from the spread — _not_ from the vault's
  reward buffer. Callback overpayment (returning more than
  `amountInMin`) flows into the reward buffer for the owner.
- **`executeSettle(callback, ...)` for Case 1, full close.** A
  permissionless caller triggers settlement when both surpluses are
  present, providing a callback contract. The vault locks the floor
  `(B, Q + T)` into buffers (`B` and `Q` to the unstake buffer, `T`
  to the reward buffer), pushes the surplus over the floor (`b - B`
  base and `q - (Q + T)` quote) to the callback, and credits whatever
  the callback returns to the reward buffer via balance-delta
  accounting. The callback retains whatever it doesn't return —
  typically routed to a caller-chosen recipient (a keeper bot's own
  EOA, a Position Closer Contract's bounty-and-fee distribution to
  treasury and operator, etc.). The vault is agnostic to how the
  callback distributes the pushed surplus.

  This is structurally symmetric to `executeSwap`: both push surplus
  to the callback, both credit returns to the reward buffer via
  balance-delta. The asymmetry is parametric — `executeSwap` pushes
  one token (the surplus side) and demands at least `amountInMin` of
  the deficit token returned; `executeSettle` pushes both surpluses
  and demands no minimum return (the floor is already in buffers, so
  the floor is structurally inviolable regardless of callback
  behaviour).

  In practice the surplus over `(B, Q + T)` in Case 1 is small. Case
  1 only arises when fees push both `b` past `B` and `q` past
  `Q + T` simultaneously, and an `executeSwap` keeper would typically
  settle the position earlier in Case 2 or 3.

### Surplus allocation across paths

The owner-side floor `(B × frac, (Q + T) × frac)` is preserved on
every path. Where the surplus over that floor goes, however, depends
on the path:

| Path | Subclass | Surplus over `(B × frac, (Q + T) × frac)` flows to |
|---|---|---|
| `swap()` (Cases 2/3) | all | owner reward buffer |
| `settle()` (Case 1) | all | owner reward buffer |
| `executeSwap()` (Cases 2/3) | Keeper | owner reward buffer (callback overpayment included) |
| `executeSettle()` (Case 1) | Keeper | caller-supplied callback, which decides what returns to owner reward buffer (via balance-delta crediting on callback return) vs. what is retained externally |

Two important consequences:

- The owner who runs a `ManualStakingVault` keeps every wei the
  vault accumulates. There is no third-party leak.
- The owner who runs a `KeeperStakingVault` may lose part of the
  Case-1 surplus (via the `executeSettle` callback) and the LVR
  spread in Cases 2/3 (via `executeSwap`'s external arbitrage). The
  exact split between owner-retained and externally-retained surplus
  depends on which callback contract the keeper uses: a naive keeper
  bot retains everything externally; an owner-affiliated Closer
  Contract can return everything to the reward buffer; a
  treasury-fee-charging Closer can split the surplus between
  recipient and reward buffer per its own policy. The vault itself
  is agnostic to this routing. The choice between Manual and Keeper
  is therefore not "do I sacrifice yield for automation?" — it is
  "do I accept the surplus distribution policy of the keepers and
  Closer Contracts I expect to act on this vault, in exchange for
  permissionless settlement when conditions allow it?"

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
| `realizedPnl` | Quote-denominated PnL recognised at disposal (`B × ΔP` insight: the principal payout valued at `P_settle` minus its proportional cost basis) | Ledger-cumulative; written on `STAKING_DISPOSE` | Quote bigint | Ledger-derived |
| `realizedCashflow` | n/a — no periodic income stream in the vault model | — | `0` | constant |
| `unrealizedPnl` | Standard derived value `currentValue − costBasis` | Computed | Quote bigint | Live (derived) |
| `unrealizedCashflow` | n/a | — | `0` | constant |
| `collectedYield` | Cumulative quote value of yield recognised at the disposal that filled the reward buffer; valued at `P_settle`. **Owner-realised** yield: excludes capital-cycling on `owner-swap` and the externally-retained surplus on `keeper-settle` (see §2.3). | Ledger-cumulative; written on `STAKING_DISPOSE` (the reward-fill component) | Quote bigint | Ledger-derived |
| `unclaimedYield` | Quote-valued contents of the reward buffer (UV3 fees + LVR substance + allocated `T` share) | `vault.rewardBufferBase × P_pool + vault.rewardBufferQuote` | Quote bigint | Live |
| `lastYieldClaimedAt` | Timestamp of the most recent `STAKING_CLAIM_REWARDS` event | Ledger | Date | Ledger-derived |
| `baseApr` | Time-weighted APR computed from `collectedYield` over weighted average `costBasis`, bracketed on `STAKING_DEPOSIT` and `STAKING_DISPOSE` events | `PositionAprPeriod` aggregation | Float, basis-point precision | Aggregated from ledger periods |
| `rewardApr` | n/a — no external incentive programmes | — | `null` | constant |
| `totalApr` | `baseApr` (or `null`) | Computed | Float \| null | Aggregated |
| `positionOpenedAt` | Timestamp of the first `STAKING_DEPOSIT` event | Ledger | Date | Ledger-derived |
| `priceRangeLower`, `priceRangeUpper` | The wrapped NFT's price range, projected into quote via `isToken0Quote` | Computed once at import from `vault.tickLower()`, `vault.tickUpper()` via `TickMath` | Quote bigint | Static (immutable post-init) |

**Notes on three contested choices.**

- **`currentValue` is mark-to-market, not settlement-now.**
  Settlement-now valuation collapses under Underwater (where every
  settlement path reverts). Mark-to-market is always well-defined
  and symmetric with NFT valuation, which matters for portfolio-level
  aggregates.

- **`collectedYield` recognises at disposal time, symmetric with
  `realizedPnl`.** Both are recognised at the same event
  (`STAKING_DISPOSE`) because both reflect the realisation of position
  economics — `realizedPnl` for the principal component,
  `collectedYield` for the yield component. The drain events
  (`STAKING_UNSTAKE`, `STAKING_CLAIM_REWARDS`) are pure asset/
  liability movements within the position's accounting; they have
  no recognition impact.

  The mark-to-market value of buffered tokens between disposal and
  drain is reflected only in `unrealizedPnl` (live valuation of the
  buffer at pool price vs. its booked value at disposal). It does
  not produce a separate realised PnL component; the buffered tokens
  are held at-cost from the disposal moment until they leave the
  vault. Any FX drift on the base component between disposal and
  drain is visible to the user via the `unrealizedPnl` movement,
  then folds into the next disposal's `Realized Gains` /
  `Realized Losses` if not yet drained.

- **`priceRangeLower/Upper` is the wrapped-NFT range, not the
  swap-executable band.** The NFT range is the region where the
  position is productive (rebalancing, accruing fees) — the same
  semantics as for a bare NFT position, and the same condition under
  which the position is in profit at settlement (modulo the LVR
  substance ceded to the settlement counterparty). The Underwater
  condition is surfaced separately in `state.swapStatus`, not via
  the range field.

## 2.2 Type-specific metrics

The `state` JSON shape under `@midcurve/shared/src/types/position/uniswapv3-staking-vault/`. Filter test: included if the UI reads it for a badge, action gate, or status label; excluded if it is only an implementation detail of `currentValue`.

| Field | Type | Source | UI consumer |
|---|---|---|---|
| `kindLabel` | `'manual-staking-vault-v1' \| 'keeper-staking-vault-v1' \| 'cow-staking-vault-v1'` | `vault.kindLabel()` once at import (immutable post-deploy) | Subclass badge in card header; gates Keeper-specific UI elements (e.g., bounty history, `executeSettle` status panels) |
| `vaultState` | `'Empty' \| 'Staking' \| 'Settled'` | `vault.state()`, mapped (on-chain `Staked → Staking`; subclass transient states `ExecuteSwapInProgress` and `ExecuteSettleInProgress` are never observed between transactions) | Lifecycle badge in card header |
| `swapStatus` | `'NotApplicable' \| 'NoSwapNeeded' \| 'Executable' \| 'Underwater'` | derived from current `(b, q)` projection vs. `(B × frac, (Q + T) × frac)` per RFC-0003 §4 case classification: Case 1 → `NoSwapNeeded`, Cases 2/3 → `Executable`, Case 4 → `Underwater`; `NotApplicable` when `vaultState != Staking` | Health indicator badge (Underwater); gates settlement action buttons (`NoSwapNeeded` → Settle button, `Executable` → Swap button, `Underwater` → both disabled, prompts the user to lower `T`) |
| `swapQuote` | `{ tokenIn, minAmountIn, tokenOut, amountOut, liquidity } \| null` | `vault.quoteSwap(currentLiquidity)`; `null` if `swapStatus ∉ {Executable}` | Swap tab in detail page; informs the close-position formular |
| `settleQuote` | `{ unstakeBase, unstakeQuote, rewardBase, rewardQuote, liquidity } \| null` | `vault.quoteSettle(currentLiquidity)`; `null` if `swapStatus != NoSwapNeeded` | Settle tab in detail page; shows the buffers a full settle would fill |
| `stakedBase` | `bigint` | `vault.stakedBase()` (slot `B` in SPEC) | Current-stake display; input for PnL-curve simulation |
| `stakedQuote` | `bigint` | `vault.stakedQuote()` (slot `Q` in SPEC) | dito |
| `yieldTarget` | `bigint` | `vault.yieldTarget()` (slot `T` in SPEC) | "T" display; key configuration parameter |
| `currentLiquidity` | `bigint` | `npm.positions(wrappedTokenId).liquidity` | "Active liquidity" indicator; decrements on partial swap/settle; the card may render `currentLiquidity / initialLiquidity` to show how much of the position remains |
| `unstakeBufferBase`, `unstakeBufferQuote` | `bigint` | `vault.unstakeBufferBase/Quote()` | Drain-principal button gating (enabled if > 0) |
| `rewardBufferBase`, `rewardBufferQuote` | `bigint` | `vault.rewardBufferBase/Quote()` | Claim-rewards button gating (enabled if > 0) |
| `sqrtPriceX96` | `bigint` | `pool.slot0().sqrtPriceX96` | Pool price display; input for `currentValue` and `swapStatus` |
| `currentTick` | `number` | `pool.slot0().tick` | In-range / out-of-range computation |
| `poolLiquidity` | `bigint` | `pool.liquidity()` | Optional comparison display (own position vs. pool TVL) |
| `lifetimeBountyPaid` | `bigint` (quote-valued) | derived per `STAKING_DISPOSE` event with `disposalKind == 'keeper-settle'` as `surplusForwardedBase × P_settle + surplusForwardedQuote` (where the two `surplusForwarded*` config fields are populated by the indexer per §2.3 from `ExecuteSettleInitiated` and `Settle` event data, factoring in `T_at_call`); cumulative across all such events | "Bounty paid to keepers" display in the Keeper-vault history tab; `0` for Manual vaults |

**Rationale for the changes from the SPEC-0003a draft:**

- **`kindLabel` is new.** The subclass identity is queryable on-chain
  via `kindLabel()` and is fixed at deploy time. The UI conditions on
  it for everything that varies by subclass — most critically the
  bottom-action-row buttons in Phase 3, but also the detail-page tab
  list (a Manual vault has no bounty history; a Keeper vault may show
  one). The field is *not* derived from `vaultState` and is
  independent of lifecycle.

- **`swapStatus` retains its name from the SPEC-0003a draft.**
  Despite the name, the field gates both swap and settle actions: in
  Case 1 (`NoSwapNeeded`) the UI surfaces the Settle button; in
  Cases 2/3 (`Executable`) the Swap button. The four enum values map
  onto the SPEC-0003b/c case-classification status without
  re-encoding.

- **`swapQuote` and `settleQuote` are split.** The earlier single
  `swapQuote` covered both swap (Cases 2/3) and settle (Case 1) via
  a polymorphic shape. Splitting into two typed quotes matches the
  SPEC's two view methods (`vault.quoteSwap(liquidity)` and
  `vault.quoteSettle(liquidity)`), simplifies the UI's tab-rendering
  logic, and lets the indexer cache them separately. Both cache the
  full-close projection (`liquidity = currentLiquidity`); the UI
  re-fetches with a smaller `liquidity` parameter when the user
  dials a partial close.

- **`pendingBps` and `effectiveBps` are dropped.** The new contract
  has no `partialUnstakeBps` storage. Close fraction is per-call via
  the `liquidity` parameter on `swap`/`settle`/`executeSwap`/
  `executeSettle`. Nothing persists between calls.

- **`currentLiquidity` is renamed from `wrappedNftLiquidity`.** Same
  on-chain source, but the new name reflects that it is a current
  value that decrements with partial closes — not just an
  active-vs-burned indicator.

- **`lifetimeBountyPaid` is new and Keeper-specific.** Only
  meaningful for `kindLabel == 'keeper-staking-vault-v1'`. It tracks
  the cumulative quote-value of surplus that the `executeSettle`
  callback retained externally (i.e., did not return to the vault's
  reward buffer), valued at `P_settle` of each event. With the
  symmetric callback design, this value is fully derivable from the
  pair of vault events emitted at each `executeSettle` call —
  `ExecuteSettleInitiated.baseSurplus`/`quoteSurplus` (the gross
  pushed) minus the corresponding `Settle` event's reward-buffer
  increment (correcting for the locked-in `T_at_call` portion; see
  §2.3 for the derivation formula). No Closer-Contract event surface
  is required.

  This is **not** PnL — the owner's `realizedPnl` and
  `collectedYield` are unaffected by the surplus retention (the
  owner-side floor `(B, Q + T)` is preserved structurally before
  any callback runs). It is metadata, useful for the user's
  introspection into "what did I trade away for the
  permissionless-Case-1 guarantee?". The field is `0` for Manual
  vaults, stays `0` over keeper-swap and owner-side paths, and
  stays `0` for keeper-settle calls where the callback returns the
  entire pushed surplus to the vault (e.g., owner-affiliated Closer
  Contracts).

**Stale-quote handling.** `swapQuote` and `settleQuote` change
block-by-block as `sqrtPriceX96` moves and as fees accrue. The cached
values in `state` are only as fresh as the last refresh. Before any
user-initiated settlement action (the "Execute Swap" / "Execute
Settle" buttons in the detail tabs), the UI must re-fetch the quote
directly from RPC and reconcile with the cached value. If the drift
exceeds a tolerated band, prompt the user to reconfirm — analogous
to the existing slippage-protection pattern on NFT close orders.

**Wrapped-NFT internals deliberately excluded.** The
`feeGrowthInside*X128` checkpoints, `tokensOwed*` snapshot, and
tick-level fee-growth fields are implementation details of how
`currentValue` and `unclaimedYield` are computed. The vault user does
not see them: by design, the wrapper hides UV3 internals so the user
sees a single quote-valued yield number, not a four-component fee
picture. Power users who want the on-chain detail can use a block
explorer.

## 2.3 PnL decomposition

**Model A.** Yield is booked separately from PnL: `collectedYield` /
`unclaimedYield` are dedicated fields, `realizedPnl` carries only the
disposal consequence on the principal (the `B × ΔP` quantity). Yield
never lands in `pnl`. This conforms to [philosophy.md]'s
yield-vs-value-appreciation separation.

`realizedCashflow` and `unrealizedCashflow` are constant `0` (no
funding, no interest stream).

### Event taxonomy

Five `EventType` values, prefixed `STAKING_*`:

| EventType | Source on-chain event(s) | Subclass scope |
|---|---|---|
| `STAKING_DEPOSIT` | `Stake` (initial mint), `IncreaseStake` (top-up) | all |
| `STAKING_DISPOSE` | `Swap` (owner-side or `executeSwap`), `Settle` (owner-side or `executeSettle`) | all |
| `STAKING_UNSTAKE` | `Unstake` | all |
| `STAKING_CLAIM_REWARDS` | `ClaimRewards` | all |
| `STAKING_CHANGE_CONFIG` | `YieldTargetChanged` | all |

`STAKING_DISPOSE` is a single `EventType` covering all four
settlement paths, discriminated via `config.disposalKind`. The four
values are `'owner-swap'`, `'owner-settle'`, `'keeper-swap'`,
`'keeper-settle'`. Discriminating in `config` rather than via four
separate `EventType` values keeps the ledger event taxonomy stable
and keeps consumers (journal-posting, reconciliation, APR) able to
treat all disposals uniformly except where the subtle kind-specific
rules below apply.

#### `STAKING_DEPOSIT`

Owner stakes — initial stake or top-up. Same delta pattern in both
cases; the distinction lives in NPM mechanics (mint vs.
`increaseLiquidity`), not in accounting.

| Field | Value |
|---|---|
| `deltaCostBasis` | `+(baseConsumed × P_stake + quoteConsumed)` |
| `deltaPnl` | `0` |
| `deltaCollectedYield` | `0` |
| `deltaRealizedCashflow` | `0` |
| `deltaLiquidity` | `+addedLiquidity` (UV3 L units) |
| `tokenValue` | equals `deltaCostBasis` |
| `rewards` | `[]` |
| `config` | `{ depositKind: 'initial' \| 'increase', baseConsumed, quoteConsumed, baseRefunded, quoteRefunded, sqrtPriceX96, newStakedBase, newStakedQuote, newYieldTarget }` |

The `newStakedBase`, `newStakedQuote`, `newYieldTarget` fields
capture the post-call slot values. For `depositKind == 'increase'`,
`newYieldTarget` reflects the auto-scaled `T` per RFC-0003 §6.2:
`T_new = ceil(T_old × (Q + ΔQ) / Q)`. The auto-scaling is captured
inside the `STAKING_DEPOSIT` event itself; no separate
`STAKING_CHANGE_CONFIG` is emitted for it (only owner-explicit
`setYieldTarget` produces that event).

#### `STAKING_DISPOSE`

A disposal — one of four paths discriminated by `config.disposalKind`.
The framework deltas are computed identically across all four;
disposalKind-specific behaviour lives entirely in the journal-posting
rule (§Account mapping) and in `state.lifetimeBountyPaid` updates
(`keeper-settle` only).

**Common config fields (all disposalKinds):**

```
{
  disposalKind: 'owner-swap' | 'owner-settle' | 'keeper-swap' | 'keeper-settle',
  caller: address,                       // msg.sender of the underlying call
  liquidityClosed: bigint,               // L delta closed in this disposal
  liquidityRemainingBefore: bigint,      // L before the close (for frac derivation)
  principalPayoutBase: bigint,           // (B × frac) credited to unstakeBufferBase
  principalPayoutQuote: bigint,          // (Q × frac) credited to unstakeBufferQuote
  rewardFillBase: bigint,                // increment to rewardBufferBase
  rewardFillQuote: bigint,               // increment to rewardBufferQuote
  sqrtPriceX96: bigint
}
```

The Case 1/2/3 distinction is fully recoverable from `disposalKind`
plus (for swap variants) the `tokenIn` field in the disposalKind-
specific addendum: Case 2 has `tokenIn == quoteToken` (base is the
surplus), Case 3 has `tokenIn == baseToken` (quote is the surplus),
and Case 1 paths (`owner-settle`, `keeper-settle`) have no
`tokenIn` because no trade occurs. No separate case-code field is
needed in the config payload.

**disposalKind-specific config additions:**

- `'owner-swap'` and `'keeper-swap'` (Cases 2/3 only):
  - `tokenIn: address` (the deficit token the counterparty supplied)
  - `amountIn: bigint` (the amount supplied)
- `'keeper-settle'` (Case 1 only):
  - `surplusForwardedBase: bigint` (= `ExecuteSettleInitiated.baseSurplus - rewardFillBase`; the portion of the gross base surplus the callback retained externally instead of returning it to the vault)
  - `surplusForwardedQuote: bigint` (= `ExecuteSettleInitiated.quoteSurplus - (rewardFillQuote - T_at_call)`; the portion of the gross quote surplus the callback retained externally; `T_at_call` is the position's `yieldTarget` slot value at the moment of disposal, tracked by the indexer)

  Note: there is no `callbackTarget` or `recipient` field in the
  config. The vault sees `callbackTarget` once at `executeSettle`
  entry but doesn't preserve it as semantic data — what the callback
  ultimately does with the externally-retained surplus (route to a
  treasury, an owner-affiliated address, a third-party keeper) is
  not visible to the vault. If integration with a specific Closer
  Contract is desired, the Closer should emit its own events that an
  additional indexer can correlate with the vault's `STAKING_DISPOSE`
  event by tx hash.

**Framework deltas (uniform across disposalKinds):**

| Field | Value |
|---|---|
| `deltaCostBasis` | `−(costBasisBefore × liquidityClosed / liquidityRemainingBefore)` (proportional disposal) |
| `deltaPnl` | `principalPayoutValue − proportionalCostBasis` where `principalPayoutValue = principalPayoutBase × P_settle + principalPayoutQuote` and `proportionalCostBasis = costBasisBefore × liquidityClosed / liquidityRemainingBefore` |
| `deltaCollectedYield` | see kind-specific table below |
| `deltaRealizedCashflow` | `0` |
| `deltaLiquidity` | `−liquidityClosed` |
| `tokenValue` | `0` (no movement to owner; tokens move into buffers or to the executeSettle callback) |
| `rewards` | `[]` |

**`deltaCollectedYield` per disposalKind:**

| disposalKind | `deltaCollectedYield` | Rationale |
|---|---|---|
| `owner-swap` | `(rewardFillBase × P_settle + rewardFillQuote) − amountInValue` | The owner provides `amountIn` from their own wallet; that capital cycles back to them via `claimRewards` and is **not yield**. Subtract it from the buffer fill to recognise only pool-intrinsic yield. `amountInValue = amountIn` if `tokenIn == quoteToken`, else `amountIn × P_settle`. |
| `owner-settle` | `rewardFillBase × P_settle + rewardFillQuote` | Case 1: no counterparty trade, `amountIn = 0`, the entire reward fill is pool-intrinsic yield. |
| `keeper-swap` | `rewardFillBase × P_settle + rewardFillQuote` | The keeper's `amountIn` is sourced from external markets via their callback; it represents LVR substance flowing into the vault. Counts entirely as yield. (Pending verification against SPEC-0003c's exact callback semantics — see §2.5.) |
| `keeper-settle` | `rewardFillBase × P_settle + rewardFillQuote` | The callback may return any non-negative amounts of base and quote to the vault (including zero, the full pushed surplus, or anything in between including overpayment). Whatever returns lands in the reward buffer alongside the locked-in `T` portion (which is preserved before the callback runs). All reward-buffer increment counts as owner-realised yield. The portion of the surplus the callback retained externally (= `surplusForwardedBase`, `surplusForwardedQuote`) does not enter the reward buffer and is not yield from the owner's perspective. In the boundary case where the callback returns nothing, `rewardFillBase = 0` and `rewardFillQuote = T`, simplifying to `T × P_settle`-conversion. |

Note that for `keeper-settle` in the boundary case where the callback
returns nothing, `rewardFillBase = 0` and `rewardFillQuote = T × frac`
(full close: `frac = 1`), so the formula simplifies to `T` (in quote
units). When the callback returns part or all of the pushed surplus,
`rewardFillBase` and `rewardFillQuote` capture both the locked-in `T`
portion and the returned surplus; the formula recognises all of it as
owner yield. The portion the callback retained externally is recorded
separately in `config.surplusForwardedBase`/`surplusForwardedQuote`
and aggregated into `state.lifetimeBountyPaid` for transparency, but
does not enter `realizedPnl` or `collectedYield`.

#### `STAKING_UNSTAKE`

Drain of `unstakeBuffer*` to the owner.

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

Marker only — `collectedYield` was incremented at the
`STAKING_DISPOSE` that filled the reward buffer. `tokenValue`
records the actual movement to the owner.

`rewards: []` is intentional. The `rewards` array is for external
reward-token programmes; the vault's intrinsic yield is in token0/
token1 amounts and is not a separate reward-token category.

#### `STAKING_CHANGE_CONFIG`

Owner-intent change. In the new contract surface, the only
owner-intent change that does not produce a `STAKING_DEPOSIT` is
`setYieldTarget`. (Top-up via `increaseStake` produces
`STAKING_DEPOSIT` with `depositKind == 'increase'`, which already
records the auto-scaled `T`.)

Neutral in all financial dimensions, but ledger-visible for audit
trail and history-tab display.

| Field | Value |
|---|---|
| `deltaCostBasis` | `0` |
| `deltaPnl` | `0` |
| `deltaCollectedYield` | `0` |
| `deltaRealizedCashflow` | `0` |
| `deltaLiquidity` | `0` |
| `tokenValue` | `0` |
| `rewards` | `[]` |
| `config` | `{ action: 'setYieldTarget', oldValue: bigint, newValue: bigint }` |

The journal-posting rule produces no `JournalEntry` for this event;
it is purely a marker.

### Account mapping

The journal-posting rule
(`UniswapV3StakingVaultPostJournalEntriesRule`) maps each non-marker
event to a single journal entry containing all required lines. The
chart of accounts adds four new accounts to the existing schema:

| Code | Account | Class | Normal side | Purpose |
|---|---|---|---|---|
| 1010 | Staking Position at Cost | Asset | Debit | Active UV3 liquidity, at acquisition cost |
| 1020 | Position Cash Holdings | Asset | Debit | Buffered tokens (unstake + reward), at disposal value |
| 2000 | Pending Settlement | Liability | Credit | Obligation to owner for buffered tokens, at disposal value |
| 4400 | Realized Yield | Revenue | Credit | Yield recognised at disposal |

Existing accounts in use: `3000 Contributed Capital`,
`3100 Capital Returned`, `4100 Realized Gains`,
`4300 FX Gain / Loss`, `5000 Realized Losses`.

The `2xxx` Liability class is new in the chart of accounts. Account
codes are suggestions; final assignment is the implementation phase's
responsibility (must align with existing conventions in
`account_definitions`).

#### `STAKING_DEPOSIT` (value `V`)

```
DR 1010 Staking Position at Cost   V
CR 3000 Contributed Capital        V
```

Identical to the existing NFT/Vault-Share acquisition pattern. Same
posting for both `depositKind == 'initial'` and
`depositKind == 'increase'`.

#### `STAKING_DISPOSE` — base posting

For all disposalKinds, define:
- `principalPayoutValue = principalPayoutBase × P_settle + principalPayoutQuote`
- `rewardFillValue = rewardFillBase × P_settle + rewardFillQuote`
- `proportionalCostBasis = costBasisBefore × liquidityClosed / liquidityRemainingBefore`
- `realizedYield = deltaCollectedYield` per the kind-specific table above

The base journal entry for a profitable disposal:

```
DR 3100 Capital Returned          principalPayoutValue + realizedYield
DR 1020 Position Cash Holdings    principalPayoutValue + realizedYield
CR 1010 Staking Position at Cost  proportionalCostBasis
CR 4100 Realized Gains            principalPayoutValue − proportionalCostBasis
CR 4400 Realized Yield            realizedYield
CR 2000 Pending Settlement        principalPayoutValue + realizedYield
```

For loss-making disposals, replace the `CR 4100 Realized Gains` line
with `DR 5000 Realized Losses |principalPayoutValue −
proportionalCostBasis|`.

Balance check (profitable variant): DR `2 × (principalPayoutValue +
realizedYield)` equals CR `proportionalCostBasis +
(principalPayoutValue − proportionalCostBasis) + realizedYield +
(principalPayoutValue + realizedYield) = 2 × (principalPayoutValue +
realizedYield)`. ✓

#### `STAKING_DISPOSE` — disposalKind-specific addenda

**`disposalKind == 'owner-swap'`: amountIn-cycling addendum.**

The owner's `amountIn` enters the vault as additional cash and
becomes part of the reward buffer (and thus the future
`claimRewards` drain). It is not yield. Append the following lines
to the base entry:

```
DR 1020 Position Cash Holdings    amountInValue
CR 2000 Pending Settlement        amountInValue
```

This pair is balanced and PnL-neutral; it tracks the cash-cycling
through the vault without recognising it as income.

The buffer-tracking invariant becomes
`1020 == 2000 == principalPayoutValue + realizedYield +
amountInValue` for owner-swap dispositions, where `realizedYield`
excludes `amountInValue` per §2.3 framework deltas.

**`disposalKind == 'owner-settle'`, `'keeper-swap'`: no addendum.**

Base entry is complete. (`keeper-swap` `amountIn` is treated as
yield and is already inside `realizedYield = rewardFillValue`.)

**`disposalKind == 'keeper-settle'`: no addendum to the journal.**

The portion of the surplus the callback retained externally
(`surplusForwardedBase`, `surplusForwardedQuote`) flows from the
vault directly to whichever address the callback routed to, never
entering Position Cash Holdings, Pending Settlement, or Realized
Yield. From the owner's accounting perspective, this externally-
retained surplus is invisible. The portion the callback returned to
the vault (plus the locked-in `T`) lands in the reward buffer and
is captured in the base entry's `rewardFillValue` and `realizedYield`
correctly.

The externally-retained surplus is tracked in the position's
`state.lifetimeBountyPaid` metadata (per §2.2) for user introspection
but does not produce any journal lines in the owner's ledger.

#### `STAKING_UNSTAKE` (drained value `V`)

```
DR 2000 Pending Settlement        V
CR 1020 Position Cash Holdings    V
```

Pure asset/liability movement. The drained value `V` equals the
value originally booked into Pending Settlement at the disposal — no
revaluation occurs at drain time. Any FX drift on the base component
between disposal and drain is visible only via the position's
`unrealizedPnl` (the live mark-to-market of the buffer at pool price
vs. its booked value at disposal). It does not produce a separate
realised PnL line at drain; if not yet drained, the drift folds
into the next disposal's `Realized Gains` / `Realized Losses`.

#### `STAKING_CLAIM_REWARDS` (drained value `V`)

```
DR 2000 Pending Settlement        V
CR 1020 Position Cash Holdings    V
```

Identical mechanism to `STAKING_UNSTAKE`, just for the reward-buffer
slice of `Pending Settlement`. Yield was already recognised as
`Realized Yield` at the prior `STAKING_DISPOSE`; the drain is a pure
asset/liability movement.

For owner-swap dispositions, this is also where the `amountIn`
capital cycling completes its round trip: the
`amountIn` portion of the reward buffer is drained back to the owner
along with the actual yield. Both flow through the same journal
mechanism; the distinction between "cycling" and "yield" was made at
the disposal event and does not need to be replayed at drain.

#### `STAKING_CHANGE_CONFIG`

No journal entry. Marker only.

### Reconciliation

`UniswapV3StakingVaultReconcileRule` periodically checks two
invariants:

- **Cost-basis invariant.** `1010 Staking Position at Cost` balance
  equals `Position.costBasis`. The primary check that
  deposit/disposal cost-basis movements are consistent.
- **Buffer-tracking invariant.** `1020 Position Cash Holdings`
  balance equals `2000 Pending Settlement` balance, both equal to
  the booked value of all four buffer slots (`unstakeBufferBase ×
  P_settle + unstakeBufferQuote + rewardBufferBase × P_settle +
  rewardBufferQuote`, where `P_settle` is the pool price at the
  disposal that filled each buffer component). Note: this is the
  *booked* value, not the current pool-price-marked value, since
  neither account is revalued at drain.

  For owner-swap dispositions, the `amountInValue` portion is
  included in both 1020 and 2000 (per the addendum lines), so the
  invariant `1020 == 2000 == buffer-booked-value` holds without
  modification.

A mismatch on either signals a missed event or a misposted event.

## 2.4 Domain events

Existing routing key family is reused: `position.liquidity.uniswapv3-staking-vault.<eventType>` with `eventType ∈ {deposit, dispose, unstake, claim_rewards, change_config}`. Existing payload shape (positionId, eventId, eventType, blockNumber, txHash, plus event-specific config) suffices — no payload extensions, no new exchange. Per the new guide §2.4, no deviation conditions apply.

The `dispose` routing key fans out to consumers regardless of
`config.disposalKind`; consumers that need kind-specific handling
(e.g., the `lifetimeBountyPaid` aggregator that reacts only to
`keeper-settle`) read `config.disposalKind` from the payload.

## 2.5 Computation as code (deferred)

Per guide §2.5, the metric derivation rules are locked in TypeScript under `packages/midcurve-shared/src/metrics/uniswapv3-staking-vault/` (`common-metrics.ts` + `specific-metrics.ts`). This is a build artefact, not a concept artefact, and is produced as a separate implementation issue against the build phases — not as part of this concept document.

One Phase-2 question is left open for the build phase to confirm:
the precise callback semantics of `executeSwap` in `KeeperStakingVault`
(SPEC-0003c) determine whether the keeper's `amountIn` is
unambiguously external value (and thus yield) or whether part of it
returns to the keeper via flash-style mechanics. The §2.3 rule
("`keeper-swap` `amountIn` is yield") is the working assumption based
on the buffer-table reading of RFC-0003 §9; the build phase verifies
it against the SPEC-0003c contract behaviour and adjusts the
`deltaCollectedYield` formula for `keeper-swap` if the final reading
diverges.
