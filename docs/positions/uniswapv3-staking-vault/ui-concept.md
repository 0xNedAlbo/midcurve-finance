# UI Concept — `uniswapv3-staking-vault`

> Phase 3 concept document for the Uniswap V3 Staking Vault integration,
> per [how-to-implement-new-positions.md](../../how-to-implement-new-positions.md).
> This document specifies the UI surface — card layout, detail page tabs,
> add-position flow, and the backend requirements those surfaces produce.
>
> Reference inputs:
> - [`mental-model.md`](./mental-model.md) — user-facing framing
> - [`position-concept.md`](./position-concept.md) — Phase 1 (identity, lifecycle, economic invariant) and Phase 2 (metrics)
> - [`rfc-0003-staking-vault.md`](./rfc-0003-staking-vault.md) — architecture (abstract base + subclasses)
> - [`spec-0003b-abstract-staking-vault.md`](./spec-0003b-abstract-staking-vault.md), [`spec-0003c-keeper-staking-vault.md`](./spec-0003c-keeper-staking-vault.md) — contracts
> - [`docs/ui.md`](../../ui.md) — global UI templates for the existing position types (NFT, Vault Shares)

## Single-product UI

The vault ships as an abstract base plus concrete subclasses (RFC-0003
§5). Two product surfaces — `KeeperStakingVault` for the current
iteration and a deferred `CowStakingVault` — share the abstract
base's owner contract. **The UI in this iteration is Keeper-only.**
The product is labelled simply "Uniswap V3 Staking Vault" without
exposing the subclass distinction; behind the scenes, all newly
created vaults are `KeeperStakingVault` clones, and the Add Position
wizard provides no subclass picker.

If `CowStakingVault` matures and replaces (or supplements) the
Keeper subclass, this document will be updated. The single-product
framing means the Phase-3 UI does not anticipate a subclass selector
or branching by `state.kindLabel`. Read paths still receive
`kindLabel` for forward-compatibility (per
[position-concept.md §2.2](./position-concept.md#22-type-specific-metrics)),
but the UI does not condition on it for actions or styling in this
iteration.

## Multi-wallet handling (applies throughout this document)

The user owns multiple wallets. `vault.owner()` may match any wallet
in the user's wallet set; **`isOwnedByUser`** is the boolean derived
from that match. The currently-connected wallet is a separate concern:
**`isConnectedWalletOwner`** is `true` only when the connect-state
matches `vault.owner()` exactly.

These two states gate UI elements differently:

- **Action visibility** is gated by `isOwnedByUser`. If the vault
  belongs to no wallet of the user, owner-only actions are hidden;
  what remains is read-only management (refresh, archive from list).
- **Action execution** is gated by `isConnectedWalletOwner`. Owner-
  only action buttons remain visible whenever `isOwnedByUser == true`,
  regardless of which user wallet is currently connected. At click
  time, if `isConnectedWalletOwner == false`, the action MUST first
  open a `SwitchConnectedWalletPrompt` component prompting the user
  to switch to the wallet matching `vault.owner()`. Only after the
  switch completes does the action's actual modal or wizard open.

**`SwitchConnectedWalletPrompt` does not exist today and must be
built.** It is a reusable component, not vault-specific — every
multi-wallet position type benefits from it, and the existing
NFT/Vault-Share patterns silently assume single-wallet equivalence.
This is a Phase 3 backend/frontend requirement (see §3.4).

## 3.1 Card layout slots

The card follows the standard three-region layout from [`docs/ui.md`](../../ui.md#per-card-layout): header (status + structural identification), metrics block, right-side common buttons; with a protocol-specific bottom action row beneath.

### Slot 1 — Header status badges

The upper badge row, rendered alongside the pair name. Vault-card badges:

- **`In Range`** / **`Out of Range`** — pool price relative to the wrapped NFT's `[tickLower, tickUpper]` range, projected into quote via `isToken0Quote`. Same semantics as the NFT card, same green/red colouring. Per the position concept, the wrapped-NFT range is the productivity range; "In Range" means the position is actively rebalancing and accruing fees.
- **`Settled`** — when `vaultState == 'Settled'` (per Phase 1.2 forward-monotonic). Replaces the NFT pattern's `Closed` badge; the lifecycle semantics are different (forward-monotonic, not reopenable), so the name diverges deliberately.
- **`Staking`** — neutral type-identifier, analogous to `Tokenized` on the existing Vault-Share card. Always present (except when `Settled`).
- **`<n> days`** — age indicator computed from `positionOpenedAt`. Reused from existing card pattern, no protocol-specific behaviour.

Badges deliberately **not** included:

- `Burned` — the wrapped NFT may technically be burned after settlement and full drain, but this is irrelevant to the vault user. The vault clone's address is permanent and is the user's reference, not the NFT.
- `Underwater` — the underwater state is an internal vault condition that surfaces in the Overview tab's Position State block via the `swapStatus` indicator (see §3.2, Overview tab); it does not warrant a card-level badge.
- `Empty` — the empty state (`vaultState == 'Empty'`) is implicit in the metrics block (`Current Value: 0`) and the action row state.

### Slot 2 — Header structural line

Below the status badges. Vault-card structure:

```
uniswapv3-staking-vault • <chain> • <feeTier> • <truncatedVaultAddress> [copy] [explorer]   [owner-badge]
```

- **Protocol name** — `uniswapv3-staking-vault`, the discriminator from §1.1.
- **Chain** — same chain badge as existing pattern (chain name + colour).
- **Fee tier** — pool fee tier from `pool.fee()`, displayed as percent (e.g. `0.05%`).
- **Identifier** — truncated vault address, with copy and explorer-link icons.
- **Owner badge**: `Bottz-Icon` if `isOwnedByUser == true` (consistent regardless of which user wallet matches; the user is the owner). Truncated owner address in grey if `isOwnedByUser == false` (read-only watching of someone else's vault).

The wrapped NFT's `tokenId` is **not** displayed on the card. It is an implementation detail and lives in the Technical Details tab of the detail page (see §3.2).

### Slot 3 — Metrics block

Five fields, replacing or reinterpreting the standard NFT slots:

| Slot | Vault-card content |
|---|---|
| 1 | **`Current Value` (USDC) / `Current Stake` (Token-Pair)** — toggle-able, default `Current Value`. Shows mark-to-market in quote (per [position-concept.md §2.1](./position-concept.md#21-common-metric-mapping)) or the staked inventory as a token-pair (e.g. `1 WETH / 2,000 USDC`). User toggle persists via localStorage, keyed on `positionHash`. |
| 2 | **PnL Curve** — mini-sparkline of position value vs. base price, identical visualisation to the NFT card with vault-specific `computeCurrentValue` as input. Acceptable as a starting visualisation; vault-specific refinements (e.g. underwater-region marking at `T > 0`) are deferred. |
| 3 | **Total PnL (USDC)** — `realizedPnl + unrealizedPnl + collectedYield + unclaimedYield` per the standard four-component decomposition. Up/down arrow with red/green tinting, identical to NFT card. |
| 4 | **`Claimable Funds` (USDC)** — combined value of both buffers: `(unstakeBufferBase + rewardBufferBase) × P_pool + unstakeBufferQuote + rewardBufferQuote`. Amber when > 0. The combined value avoids breaking the five-slot pattern; the per-buffer breakdown is available in the detail page. |
| 5 | **`Yield Target` (USDC)** — display depends on `state.yieldTarget`: when `yieldTarget == uint256.max`, displays as `—` with grey "Automation off" subtitle; when `yieldTarget < uint256.max`, displays the value with green "Automation on" subtitle. Replaces the NFT card's `est. APR` slot — the vault has no continuous yield rate; the target is the meaningful number. |

**localStorage key convention** for the Slot 1 toggle: `vault-card-slot:<positionHash>`. Cleanup hook required when the position is deleted (see §3.4).

### Slot 4 — Right-side common buttons

| Button | Vault behaviour |
|---|---|
| **View Details** | Identical to NFT pattern. Navigates to detail page; stores current dashboard URL for back-navigation. |
| **Refresh** | Identical to NFT pattern. `POST /refresh`. |
| **3-dot menu** | Two items: **Reload History** (identical to existing pattern), **Delete Position** (with localStorage cleanup, see §3.4). **`Switch Quote Token` is dropped** — `isToken0Quote` is on-chain immutable, and a switch would violate the vault's case-classification semantics. |

### Slot 5 — Bottom action row

The action row mirrors the NFT pattern as closely as the protocol allows. Owner-only buttons follow the multi-wallet handling described above.

**Layout**:

```
[+ Stake More] [- Withdraw] [$ Claim Funds]   ◇   [Pool Price] [Yield Target Component]   ◇   [Archive Position]
```

#### Position management buttons (left section)

| Button | Visibility | Action |
|---|---|---|
| **`+ Stake More`** | Visible if `isOwnedByUser`. Always enabled when `vaultState != 'Settled'`. | Navigates to a top-up wizard page, analogous to the existing `IncreaseDepositPage` pattern. Atomic deposit + `increaseStake`. |
| **`- Withdraw`** | Visible if `isOwnedByUser`. Enabled if `vaultState != 'Empty'`. | Opens the Withdraw wizard (specified below). The wizard is the unified owner-side exit path: it dispatches internally to `swap()` or `settle()` based on the current `swapStatus`, with a transparent Underwater-escape branch where applicable. |
| **`$ Claim Funds`** | Visible if `isOwnedByUser`. Enabled if `claimableFunds > 0`. | Opens the claim-funds modal (specified below). |

#### Withdraw wizard

The Withdraw wizard is the user-facing exit path for the vault. It
unifies what the contract calls `swap()` (Cases 2/3) and `settle()`
(Case 1) under a single UI flow, because the economic effect on the
owner is identical: a fraction of the position is closed and the
proportional inventory plus the proportional yield share land in the
vault buffers, ready for drain. Whether a swap is required (Cases
2/3) or not (Case 1) is a function of the current pool state and is
handled by the wizard internally — the user does not see it.

The wizard is status-centric: the user picks a withdrawal fraction,
and the wizard previews exactly what will happen at the current pool
state.

**Step 1 — Configure & Preview**:

- **Withdrawal slider** (0%–100%). The user picks the fraction of
  current liquidity to close. The slider value is converted to a
  `liquidity` parameter via `frac × state.currentLiquidity`. There is
  no on-chain "pending fraction" state — the chosen fraction lives
  only in the wizard.
- **Status section** below the slider, live-updating as the slider
  moves. Content depends on the current `swapStatus`:

  - **`NoSwapNeeded` (Case 1):** "Direct settlement — no trade
    required." Preview of the buffers that will fill (`unstakeBase`,
    `unstakeQuote`, `rewardBase`, `rewardQuote`), and the resulting
    claimable-funds delta.
  - **`Executable` (Cases 2/3):** Preview of the resulting trade
    (`<base in> → <quote out>` or vice versa, with effective rate
    vs. spot, e.g. `1 WETH → 1,300 USDC, 700 USDC under spot`).
    Preview of the buffers that will fill. The user provides the
    deficit-side amount from their own wallet; this is shown as
    "You provide: <amount>".
  - **`Underwater` (Case 4):** A red-bordered warning box —
    *"This position is currently Underwater. The vault cannot deliver
    your principal plus the configured yield target at the current
    pool state. To proceed with the withdrawal, the yield target
    will be lowered to 0 (the strong-guarantee state). You forgo
    the configured yield expectation; principal is recovered in
    full. The yield target will not be restored after this
    withdrawal — to re-enable yield expectation on the residual
    position, set a new target afterwards."* Below the warning, the
    same kind of preview as `Executable` shows what the vault will
    deliver after the T=0 escape.

  The `swap` vs. `settle` distinction is silent (the user sees only
  the economic effect), but the Underwater-T=0 escape is **explicit
  and confirmation-gated**, because it has a real economic
  consequence: the user is voluntarily abandoning the configured
  yield-expectation. The Underwater warning constitutes the wizard's
  consent moment for that consequence.

- **Funding-source toggle (deferred to Phase 4):** the wizard's
  default execution path is "you provide the deficit-side amount
  from your wallet". A future externally-financed path (via a
  Position Closer Contract) will be added in Phase 4. The wizard's
  layout reserves a toggle row in this position for the second path
  to plug in; in this iteration, only the self-funded path is
  available, and the toggle either renders as disabled-with-tooltip
  ("Coming soon") or is omitted entirely. The choice is left to the
  Phase-4 implementation.

**Step 2 — Execute Transaction**:

A multicall, contents depending on the current `swapStatus`:

- **`NoSwapNeeded` (Case 1):**
  1. `settle(liquidity, ...)`
  2. `unstake()`
  3. `claimRewards()`
- **`Executable` (Cases 2/3):**
  1. `swap(liquidity, ...)` — owner provides deficit-side amount,
     receives surplus-side amount within the same call.
  2. `unstake()`
  3. `claimRewards()`
- **`Underwater` (Case 4), after user confirms in Step 1:**
  1. `setYieldTarget(0)` — collapses Case 4 into Cases 1/2/3.
  2. `swap(liquidity, ...)` or `settle(liquidity)` — UI dispatches
     based on the resulting `swapStatus` post-T=0; in practice, the
     T=0 collapse usually lands in Case 2 (base surplus) or Case 3
     (quote surplus), occasionally Case 1.
  3. `unstake()`
  4. `claimRewards()`

After a Case-4 withdrawal, **`yieldTarget` remains at 0 on the
residual position**. The user must explicitly set a new target via
the Yield Target Component if they want to re-enable yield
expectation; the wizard does not auto-restore. This is consistent
with the no-client-persistence rule (see Yield Target Component
below).

The wizard preview requires a backend service that simulates the
post-action state for any given `liquidity`. This service does not
exist today and is a Phase 3.4 requirement. See §3.4.

#### Claim-funds modal

A modal dialog with two checkboxes, allowing the user to drain principal and yield independently or together:

- **`[ ] Claim Unstaked Funds`** — value: `unstakeBufferBase × P_pool + unstakeBufferQuote`. Defaults to checked if `unstakeBuffer*` is non-zero; disabled and unchecked if zero.
- **`[ ] Claim Rewards`** — value: `rewardBufferBase × P_pool + rewardBufferQuote`. Defaults to checked if `rewardBuffer*` is non-zero; disabled and unchecked if zero.

Execution is a multicall containing the user-selected drains. Critically, **the two ledger events remain separate**: a `STAKING_UNSTAKE` event for principal drain, a `STAKING_CLAIM_REWARDS` event for yield drain, each with its own `tokenValue` and accounting impact. The combined-modal UX is purely a transaction-batching convenience; the underlying domain separation (principal vs. yield) is preserved per the position concept.

#### Pool Price and Yield Target Component (middle section)

Between the position-management buttons and the archive button, two informational/control elements:

- **Pool Price** — live-updating display, identical to the NFT card's `Current Price` element. Reuse the existing component as-is.
- **Yield Target Component** — vault-specific. Two states, derived
  entirely from `state.yieldTarget`:

  | State | Display | Click targets |
  |---|---|---|
  | Off (`yieldTarget == uint256.max`) | `[+ Yield Target]` button (CTA-styled) | Click opens a modal to enter a value via `setYieldTarget(<value>)`. |
  | Active (`yieldTarget < uint256.max`) | `<value> USDC [Pen-Icon] [X-Icon]` | **Pen-Icon**: opens edit modal to set a new value via `setYieldTarget(<newValue>)`. **X-Icon**: opens a confirmation modal to disable automation via `setYieldTarget(uint256.max)`. |

  The component is entirely on-chain-driven: the displayed state is a
  pure function of `state.yieldTarget`, with no client-side memo. When
  the user disables automation and later re-enables it, they must
  enter a new value — the previous target is **not** persisted
  anywhere. This matches the on-chain contract: the only state of
  record is `yieldTarget`, and its `uint256.max` sentinel value
  doubles as the "automation off" indicator.

  The `[X-Icon]` confirmation modal explicitly states this: _"Disabling
  automation prevents keepers from settling this position. You can
  re-enable by setting a new yield target. The current value
  (<X> USDC) will not be remembered. Continue?"_

  All click targets that trigger a wallet transaction display a
  **pending state** during transaction submission (e.g. a spinner
  overlay, with other targets disabled). The state changes only
  after the transaction confirms; if it fails or is cancelled, an
  error popup is shown and the component reverts.

  **Why no third "paused" state.** An earlier draft proposed three
  states (Off / Active / Paused) with a client-side memo of the
  previously-active value to support a Pause-and-Resume idiom. This
  was dropped because (a) the on-chain `yieldTarget` is the single
  source of truth and the UI should not invent state next to it, and
  (b) the user's "disable automation now, re-enable later with a new
  target" workflow is fully expressible via the two-state model. The
  user explicitly chooses what target to re-enable with, rather than
  having an off-chain memory dictate it.

#### Archive button (right section)

- **Archive Position** — visible when `vaultState == 'Settled' AND claimableFunds == 0`. Toggles `isArchived` via `useArchivePosition`. Identical to the existing pattern.

#### Multi-wallet treatment summary

`+ Stake More`, `- Withdraw`, `$ Claim Funds`, and the Yield Target Component's click targets all follow the multi-wallet handling defined at the top of this document. They are visible whenever `isOwnedByUser == true`; on click, if `isConnectedWalletOwner == false`, `SwitchConnectedWalletPrompt` opens before the actual action.

`Archive Position`, `View Details`, `Refresh`, and the 3-dot-menu items are not owner-only — they manage the user's tracking record, not the on-chain vault — and have no `SwitchConnectedWalletPrompt` requirement.

## 3.2 Detail page tabs

The detail page has seven canonical tab slots (see [`docs/ui.md` §Tabs](../../ui.md#tabs-common-to-both-types)). Each tab requires a per-protocol decision: applies as-is, reinterpreted, or dropped.

For the staking vault, six tabs are populated. The seventh (`Conversion`) is dropped: the standard tab's premise (reconstructing AMM token-amount drift) does not apply because the vault conserves token amounts by construction. The functional surface that an NFT's Conversion tab would carry — "what is the position currently offering economically?" — is covered by the Overview's Position State block plus the Withdraw wizard's preview, so a separate tab adds nothing.

### Tab: Overview

**Status: applies as-is, with a vault-specific Position State block.**

The Overview tab follows the existing pattern: a hero summary at the top, the price-range visualisation as the centrepiece, and supporting blocks below. The vault-specific addition is the Position State block, which surfaces operational status that has no NFT analog.

#### Hero Summary section

A compact top row with the four headline metrics, presented at larger size than on the card:

- **Current Value** — `currentValue` in quote, prominent
- **Total PnL** — `realizedPnl + unrealizedPnl + collectedYield + unclaimedYield`, with arrow and red/green tinting
- **Cost Basis** — `costBasis` in quote
- **Yield Target** — `state.yieldTarget` (or `Off` if `uint256.max`)

These are the same metrics as the card's Slot 3 block, recomposed for the larger detail-page surface.

#### Range Visualisation section

The shared range-visualisation component is reused as-is. Shows:

- The wrapped NFT's `[priceRangeLower, priceRangeUpper]` band
- The current pool price as a marker
- In-Range / Out-of-Range status, colour-coded consistently with the Slot 1 badge

No vault-specific adaptations. The range is displayed because the wrapped NFT does have a real range, even though the user's settlement is gated by yield-target satisfaction rather than range-crossings.

#### Position State block (vault-specific)

A three-indicator grid surfacing the operational state:

| Indicator | Possible values |
|---|---|
| **Vault State** | `Empty` / `Staking` / `Settled` (neutral colour) |
| **Swap Status** | `NotApplicable` / `NoSwapNeeded` (green, "settlement available without trade") / `Executable` (green, "settlement available via trade") / `Underwater` (red, "settlement blocked — lower yield target to enable") |
| **Yield Target** | `Off` / `<value> USDC` (with active-vs-off indicator inline) |

The Underwater condition surfaces here as one of the four Swap Status values, in red. No separate warning box and no card-level badge — the red Swap Status indicator carries the information without overdramatising. Underwater is a user-caused condition (the user set `T`), not a system emergency.

The "Pending Unstake" indicator from earlier drafts is dropped: the new contract has no `partialUnstakeBps` storage, and partial closes do not persist between calls (each `swap`/`settle` call is independent, with its own `liquidity` parameter).

#### Buffer Holdings section

The per-buffer breakdown that the card combines into a single Claimable Funds value:

| | Base | Quote | Total Value |
|---|---|---|---|
| Unstake Buffer | `<base>` | `<quote>` | `$<value>` |
| Reward Buffer | `<base>` | `<quote>` | `$<value>` |

Below the table, a **Claim Funds** quick-action button that opens the same modal as the card's `$ Claim Funds` action (see [§3.1 Slot 5](#slot-5--bottom-action-row)). This is convenience for the user already in the detail page; the button is duplicated by design — card buttons serve the list context, detail-page buttons serve the detail context.

The button follows the same multi-wallet handling as on the card: visible if `isOwnedByUser`, opens `SwitchConnectedWalletPrompt` if `isConnectedWalletOwner == false`.

### Tab: PnL Analysis

**Status: reinterpreted, with the Position Ledger acting as the full audit trail of position events.**

The shared PnL-Analysis tab structure is reused: a PnL Breakdown section followed by the Position Ledger.

#### PnL Breakdown section

Two-card layout (consistent with NFT/Vault-Share pattern):

**Realized PnL** card (recognised, lifetime-to-date):
- Realized from Withdrawals — `B × ΔP` component cumulated from `STAKING_DISPOSE` events
- Realized from Yield — `collectedYield` cumulated from `STAKING_DISPOSE` events
- Realized from FX Effect — quote→USD conversion drift
- = Subtotal

All three lines map directly to accounting accounts (see Accounting tab and [position-concept.md §2.3](./position-concept.md#account-mapping)). The Realized PnL card includes all yield that has been recognised at the disposal — even if the corresponding tokens still sit in the reward buffer waiting to be drained. This is consistent with the disposal-time recognition rule from [position-concept.md §2.1](./position-concept.md#21-common-metric-mapping).

**Unrealized PnL** card (live mark-to-market):
- Current Position Value — `currentValue`
- Cost Basis — `costBasis`
- = Subtotal: `currentValue − costBasis` = `unrealizedPnl`

Unlike the NFT pattern, the Unrealized card does not have a separate "Unclaimed Fees" line. The vault has no continuous fee accumulation visible to the user; what the NFT pattern would call "unclaimed" is in the vault either already-recognised (in the reward buffer post-disposal) or not yet existing (no disposal has occurred). Buffer-tokens at-cost are baked into both `currentValue` (mark-to-market) and the Pending Settlement liability that offsets them.

#### Position Ledger section

The Position Ledger is the chronological audit trail of all events affecting the position, including PnL-neutral events. Five event types appear:

- **`STAKING_DEPOSIT`** — initial stake or top-up; affects cost basis. Discriminated via `config.depositKind`.
- **`STAKING_DISPOSE`** — settlement (owner-side or keeper-side); recognises PnL and yield. Discriminated via `config.disposalKind`.
- **`STAKING_UNSTAKE`** — drain of unstake-buffer; PnL-neutral
- **`STAKING_CLAIM_REWARDS`** — drain of reward-buffer; PnL-neutral
- **`STAKING_CHANGE_CONFIG`** — owner-intent change (only `setYieldTarget` produces this event in the new contract); PnL-neutral

All events render with identical visual treatment, consistent with the existing NFT/Vault-Share Position Ledger. PnL-neutral events display `0` or `—` in the Realized PnL column; the chronological context makes their role clear.

Table columns: **Date & Time**, **Event Type**, **Value**, **Realized PnL**, **Details**, **Transaction**.

**Details column content** per event type:

| Event Type | Details column |
|---|---|
| `STAKING_DEPOSIT` (initial) | `Initial stake: +<base> + <quote>` |
| `STAKING_DEPOSIT` (increase) | `Top-up: +<base> + <quote>; T scaled to <newT>` |
| `STAKING_DISPOSE` (`owner-swap`) | `Owner swap: <X>% closed, principal $<Y>, yield $<Z>` |
| `STAKING_DISPOSE` (`owner-settle`) | `Owner settle: <X>% closed, principal $<Y>, yield $<Z>` |
| `STAKING_DISPOSE` (`keeper-swap`) | `Keeper swap: <100>% closed by <truncatedCaller>, principal $<Y>, yield $<Z>` |
| `STAKING_DISPOSE` (`keeper-settle`) | `Keeper settle: <100>% closed by <truncatedCaller>, principal $<Y>, yield $<Z>, bounty $<B>` |
| `STAKING_UNSTAKE` | `<base> + <quote> drained` (token amounts) |
| `STAKING_CLAIM_REWARDS` | `<base> + <quote> drained` (token amounts) |
| `STAKING_CHANGE_CONFIG` | `Yield target: <oldValue> → <newValue>` (with `Off` rendering for `uint256.max` on either side) |

The Transaction column links to the on-chain explorer for the transaction hash, identical to the NFT pattern. For keeper-side disposals, the truncated caller address has its own copy and explorer-link icons inline with the details text.

### Tab: APR Analysis

**Status: reinterpreted.**

The shared APR-Analysis tab structure is reused, but the Unrealized-APR card is dropped because the vault has no continuous yield-accumulation between settlements. Yield is recognised at disposal events; between disposals the position has zero realised yield, and there is no meaningful live projection of "yield in flight" comparable to NFT `tokensOwed`.

#### APR Breakdown section

Single-card layout (instead of the NFT pattern's two-card Realized/Unrealized split):

- **Total APR** — header line, e.g. `Total APR: 12.4% (over 47.3 days)`. Equals the Realized APR below; no Unrealized component contributes.
- **Realized APR** card with the breakdown:
  - Total Yield Collected — `collectedYield` from [position-concept.md §2.1](./position-concept.md#21-common-metric-mapping)
  - Time-Weighted Cost Basis — weighted average of `costBasis` across all completed periods
  - Active Days — sum of days across all completed periods
  - `= Realized APR` — `(Total Yield Collected / Time-Weighted Cost Basis) × (365 / Active Days)`

The Unrealized-APR card from the NFT pattern is omitted entirely. The vault's yield mechanic does not support a "yield in flight" estimate: between disposals, no yield is accumulating in any meaningful sense — the yield substance materialises atomically at the settlement moment.

#### APR Periods section

Chronological list of completed APR periods. Each period spans from one bracket event to the next.

**Bracket events**: `STAKING_DEPOSIT` and `STAKING_DISPOSE` only. Per [position-concept.md §2.1](./position-concept.md#21-common-metric-mapping), `STAKING_CLAIM_REWARDS` does not bracket because it is a pure asset/liability movement, not a recognition event — `collectedYield` was already incremented at the prior `STAKING_DISPOSE`.

Per period, the table shows:

- Start event (date, type)
- End event (date, type)
- Cost Basis (the average during the period)
- Yield Collected (= `collectedYield` recognised at the period's end event, if it was a `STAKING_DISPOSE`; otherwise zero)
- Days
- APR

If no APR periods exist yet (the position has had no `STAKING_DISPOSE` events), the section displays a hint: _"No completed APR periods yet. Periods are computed at disposal events."_ — analogous to the NFT pattern's empty-state.

#### Automation-off-phase treatment in APR computation

When the owner has disabled automation (`yieldTarget == uint256.max`),
the position remains staked and capital remains committed, but no
keeper-driven settlement can occur. These phases **count toward
`Active Days`** in the APR computation.

Rationale: APR's definition is `(yield / capital × time)`, and capital
is committed throughout the automation-off phase. Excluding such
phases would overstate the effective return. If the owner chooses to
forgo settlement opportunities, the resulting lower APR should be
visible — it reflects an investment decision with consequences.

### Tab: Automation

**Status: applies as a vault-specific tab; structurally specified in
Phase 3, fleshed out in Phase 4.**

The Automation tab makes the vault's automated settlement
infrastructure visible to the owner. The vault is a keeper-settled
construct (RFC-0003 §8.2): permissionless callers monitor on-chain
conditions and trigger settlement (`executeSwap` / `executeSettle`)
without owner action. Phase 3 specifies the read-side surface
(status, preview, history). Phase 4 will extend with owner-side
controls for the externally-financed Position Closer Contract and any
required keeper notification or registration mechanics.

#### Automation status block

A single-row block at the top of the tab, three indicators:

| Indicator | Possible values |
|---|---|
| **Automation Status** | `Active` (green, `yieldTarget < uint256.max`) / `Off` (grey, `yieldTarget == uint256.max`) |
| **Settlement Availability** | `NoSwapNeeded` (green) / `Executable` (green) / `Underwater` (red) / `NotApplicable` (grey) — mirrors `state.swapStatus` |
| **Lifetime Bounty Paid** | `<value> USDC` (cumulative `state.lifetimeBountyPaid`) |

Automation Status reflects the on-chain condition that gates whether
keepers can act. With `yieldTarget == uint256.max` the position is
permanently in Case 4 (`q < (Q + T) × frac` is trivially true, since
`T` is unreachably large), so all settlement paths revert and no
keeper can settle.

#### Settlement preview block

Live preview of what would happen if a keeper acted right now,
based on the current `swapQuote` / `settleQuote`:

- **`Executable` (Cases 2/3)** — keeper-settlement preview based on
  `state.swapQuote`: keeper provides `<X> tokenIn`, receives `<Y>
  tokenOut`, vault buffers fill with `<base> + <quote>`. The keeper's
  external profit (spread vs. spot) is computed and shown for
  context.
- **`NoSwapNeeded` (Case 1)** — keeper-settlement preview based on
  `state.settleQuote`: vault buffers fill with `<base> + <quote>`,
  bounty `<X> + <Y>` flows to the calling keeper.
- **`Underwater` (Case 4)** — *"Settlement not available. The position
  is Underwater. Lower the yield target via the Yield Target
  Component to make settlement available."*
- **`NotApplicable`** — *"Position not staked."*

This is informational; no action button. The owner can use the
Withdraw wizard if they want to settle directly rather than wait
for a keeper.

#### Keeper activity log

Chronological list of past `executeSwap` / `executeSettle` calls
against this vault, sourced from `STAKING_DISPOSE` events with
`config.disposalKind ∈ {keeper-swap, keeper-settle}`. Owner-side
disposals do not appear here — they are owner actions, visible in the
PnL Analysis Position Ledger. The Automation tab's keeper log is
specifically the third-party-keeper history.

Table columns:

- Date & Time
- Disposal Kind (`keeper-swap` / `keeper-settle`)
- Caller Address (with copy and explorer-link icons)
- Disposed Liquidity (always 100% in the current contract — keeper
  paths are full-close only per RFC-0003 §8.2)
- Bounty Paid (only for `keeper-settle`; otherwise `—`)
- Transaction (with explorer link)

Keeper recognition (mapping caller addresses to known keeper services
or bot operators) is out of scope for this iteration. The truncated
address with explorer-link icons is sufficient for the owner to
investigate which keeper acted.

#### Phase 4 dependencies

The structure above covers the read-side of automation. Phase 4 will
add to this tab (without restructuring it):

- An owner-side block exposing the Position Closer Contract: the
  externally-financed counterpart to the self-funded Withdraw
  wizard, used when the owner wants to exit without providing
  the deficit-side liquidity from their own wallet.
- Keeper-notification or registration mechanics, if any are needed
  to ensure keepers reliably watch this vault.

### Tab: Accounting

**Status: applies as-is, with vault-specific content.**

The shared `PositionAccountingTab` component is reused without changes — it is protocol-agnostic. The vault integration provides:

- A `useUniswapV3StakingVaultPositionAccounting` hook that fetches accounting data from the protocol-specific endpoint.
- The `UniswapV3StakingVaultPostJournalEntriesRule` (per [position-concept.md §2.3](./position-concept.md#23-pnl-decomposition)) that produces journal entries from the five `STAKING_*` events.

#### Balance Sheet section

Three account classes appear in the vault-specific balance sheet:

**Assets**
- `1010 Staking Position at Cost` — active UV3 liquidity at acquisition cost.
- `1020 Position Cash Holdings` — buffered tokens at disposal value.

**Liabilities** (new class for the vault)
- `2000 Pending Settlement` — obligation to owner for buffered tokens.

**Equity**
- Standard structure: Contributed Capital, Capital Returned, Retained Earnings (with Realized: Withdrawals, Realized: Yield, Realized: FX Effect as breakdown).

The Pending Settlement liability is the visibility-anchor for buffered amounts: it ensures that a position with `$6,000` total economic value but `$2,000` returned to the owner shows correctly as `$6,000` total assets, `$4,000` pending settlement, `$2,000` net equity returned. Without the liability class, the buffered tokens would either appear as full equity (overstating returned capital) or vanish from the balance sheet (understating total position).

#### P&L Statement section

Three line items, all recognised at disposal time:

- **Realized from Withdrawals** — the `B × ΔP` quantity from `STAKING_DISPOSE`, booked to `4100 Realized Gains` or `5000 Realized Losses`.
- **Realized from Yield** — yield component from `STAKING_DISPOSE`, booked to `4400 Realized Yield`.
- **Realized from FX Effect** — quote→USD conversion drift, booked to `4300 FX Gain / Loss`.

The drain events (`STAKING_UNSTAKE`, `STAKING_CLAIM_REWARDS`) produce no P&L lines, since they are pure asset/liability movements.

For owner-swap dispositions, the cycled `amountIn` capital is captured in the addendum journal lines (per [position-concept.md §2.3](./position-concept.md#staking_dispose--disposalkind-specific-addenda)) but does not produce a P&L line — it is balanced cash-cycling, not income.

For keeper-settle dispositions, the bounty paid to the keeper does not appear in the owner's P&L. The bounty leaves the vault directly to the keeper's recipient and is tracked metadata-only via `state.lifetimeBountyPaid` (visible on the Automation tab); the owner's `Realized from Yield` for these events is exactly the configured `T` portion.

#### Journal Entries section

Standard chronological list of journal entries, one per non-marker event. Each entry shows the date, a descriptive line referencing the event (e.g. `Vault disposal (keeper-swap): uniswapv3-staking-vault/<chainId>/<vaultAddress>`), and the debit/credit lines per the account-mapping in [position-concept.md §2.3](./position-concept.md#account-mapping).

`STAKING_CHANGE_CONFIG` events do not appear in the Journal Entries section, only in the Position Ledger (PnL Analysis tab).

### Tab: Technical Details

**Status: applies as-is.**

The shared `PositionTechnicalDetailsTab` layout is reused: two columns, Vault Configuration (left, immutable) and Vault State (right, mutable). Each field renders as a read-only input with copy and (where applicable) explorer-link icons.

#### Vault Configuration column

Immutable fields from [position-concept.md §2.2](./position-concept.md#22-type-specific-metrics) plus the immutable owner address:

- Vault Address (with explorer link)
- Factory Address (with explorer link)
- Kind Label (`keeper-staking-vault-v1` for all currently-deployed vaults; future Cow variants will display their respective label)
- Wrapped NFT Token ID (with link to the NFT manager view on the explorer)
- Pool Address (with explorer link)
- Token0 Address, Token1 Address (with explorer links)
- Fee Tier
- Tick Spacing
- Tick Lower, Tick Upper
- Is Token0 Quote (Yes / No)
- Price Range Lower, Price Range Upper (in quote)
- Owner Address (with explorer link) — set immutably at clone initialisation; conceptually belongs in Configuration despite being read from `vault.owner()` at runtime

#### Vault State column

Mutable fields from [position-concept.md §2.2](./position-concept.md#22-type-specific-metrics):

- `vaultState` (Empty / Staking / Settled)
- `swapStatus` (NotApplicable / NoSwapNeeded / Executable / Underwater)
- `swapQuote` — full struct as a multi-line readable display, or `null`
- `settleQuote` — full struct as a multi-line readable display, or `null`
- `stakedBase`, `stakedQuote`
- `yieldTarget` (with `uint256.max` rendering as `Off (automation disabled)`)
- `currentLiquidity`
- `unstakeBufferBase`, `unstakeBufferQuote`
- `rewardBufferBase`, `rewardBufferQuote`
- `sqrtPriceX96`, `currentTick`, `poolLiquidity`
- `lifetimeBountyPaid`

Wrapped-NFT internal accumulators (`feeGrowthInside*X128`, `tokensOwed*`, tick-level fee growth) are deliberately excluded from this tab. They are implementation details of how `currentValue` and `unclaimedYield` are computed and have no power-user value over what the wrapped NFT's explorer view already shows.

## 3.3 Add-position flow

The Add Position dropdown (per [`docs/ui.md`](../../ui.md)) currently exposes four entry points: Create New Position, Import NFT by ID, Import Tokenized Position by Address, and Scan Wallet. This iteration specifies only the **Create New Position wizard** for the staking vault. The other three entry points are deferred to a separate iteration.

### Approach: extend the existing Create Wizard, do not build a parallel one

The existing four-step Create Wizard (Step 1: Select Pool → Step 2: Capital Allocation / Position Range / SL-TP Setup → Step 3: Acquire Required Tokens → Step 4: Execute Transactions) is reused as-is for the staking vault, with minimal targeted extensions.

Rationale: the wizard's overall structure is shared by both position types — pool selection, base/quote/chain selection, capital allocation, and range selection are identical operations. Only the final transaction list differs materially. Building a parallel wizard would duplicate the majority of the surface for marginal gain. A future refactor of the Add Position flow may consolidate position-type handling more comprehensively as more position types are added; this iteration is deliberately pragmatic.

### Step 1 — Select Pool: extension

A new **Position Type** section is added to the Summary panel on the right, between `Selected Pool` and `Allocated Capital`:

```
Position Type
[ Standard UniswapV3 ▾ ]
   Standard UniswapV3
   Uniswap V3 Staking Vault
```

Default: `Standard UniswapV3` (preserves existing behaviour). The selection is persisted across all subsequent wizard steps via the wizard's existing query-string state mechanism.

The single product label `Uniswap V3 Staking Vault` is used; no subclass picker is offered. The wizard always deploys a `KeeperStakingVault` clone behind the scenes.

Pool selection, base/quote token selection, and chain selection are unchanged — both position types operate on the same Uniswap V3 pool set.

### Step 2 — Capital Allocation / Position Range / SL-TP Setup: per-tab treatment

The three-tab structure of step 2 is preserved for visual consistency.

**Capital Allocation tab** — identical for both position types. The wizard collects `(B, Q)` token amounts; for the staking vault these become the `(B, Q)` of the initial stake passed to `factory.createVault(...)`.

**Position Range tab** — identical for both position types. The selected `[lowerTick, upperTick]` becomes the wrapped NFT's range, set immutably at vault creation.

**SL/TP Setup tab** — when `Position Type == Staking Vault`, the tab is visible but inactive. It displays an info panel:

> _**Stop-loss and take-profit are not applicable to staking vaults.** The vault's settlement is governed by a yield target instead, set in quote-token units. The yield target defaults to `uint256.max` (Off) at creation, leaving the vault in the strong-guarantee state where principal recovery is structurally always honourable (per [position-concept.md §1.3](./position-concept.md#13-economic-invariant), Strong guarantee at T=0). It can be configured after creation via the position card's Yield Target Component (per [§3.1 Slot 5](#slot-5--bottom-action-row))._

No yield-target input is collected in the wizard. The yield target is **only** configurable post-creation via the card's Yield Target Component. Rationale: keeping the wizard's `createVault()` call as a single atomic transaction (deploy + initial stake) without forcing the user to commit to a target before they've seen the position in their portfolio. The vault is fully usable in the `uint256.max` / Strong-guarantee state; the user is not blocked. Automation is off in this default state, but principal recovery is guaranteed.

The Summary panel's `Risk Profile` section adapts when `Position Type == Staking Vault`: the Stop Loss / Take Profit / Max Drawdown / Max Runup lines are replaced by a single line:

```
Yield Target    Off
                (configure after creation)
```

This is informational — no interaction.

### Step 3 — Acquire Required Tokens: identical

The wallet-balance check is token-and-amount based, which is independent of how the tokens will be consumed downstream. No change.

### Step 4 — Execute Transactions: position-type-specific transaction list

The transaction list differs based on `Position Type`:

| Step | Standard UniswapV3 (existing) | Staking Vault (new) |
|---|---|---|
| 1 | Approve token0 → NPM | Approve token0 → Factory |
| 2 | Approve token1 → NPM | Approve token1 → Factory |
| 3 | Pool price drift check | Pool price drift check (identical) |
| 4 | **Open** UniswapV3 Position (`NPM.mint(...)`) | **Create** Staking Vault (`factory.createVault(kindLabel, ...)`) |

The pool price drift check is a generic sanity pattern and runs identically for both position types.

For the staking vault, the final transaction calls `factory.createVault(kindLabel = keccak256("keeper-staking-vault-v1"), ...)` which atomically (a) consults the implementation registry (SPEC-0003d) for the `KeeperStakingVault` implementation address, (b) deploys an EIP-1167 clone of that implementation, (c) initialises ownership (immutably setting `vault.owner()` to the connected wallet), and (d) performs the initial stake — closing the standard EIP-1167 front-running race per [position-concept.md §1.1](./position-concept.md#11-identity).

The exact factory-call signature is determined by SPEC-0003d; this Phase 3 specification only fixes that the wizard hardcodes `kindLabel = keccak256("keeper-staking-vault-v1")` rather than offering a choice.

The button label changes from `Open UniswapV3 Position` to `Create Staking Vault` accordingly. Approval targets change from NPM to Factory, but this is implementation detail not surfaced to the user beyond the transaction count being identical.

The Summary panel's `Selected Pool` block remains identical; only the Risk Profile section reflects the position-type difference (configured in Step 2).

### Post-creation handoff

After successful execution of the final transaction, the wizard navigates to the position list. For a staking vault, the new card appears with `Yield Target: Off` in Slot 5 of the bottom action row (per [§3.1 Slot 5](#slot-5--bottom-action-row)). The user can either leave the vault in the strong-guarantee state (the default) or click `+ Yield Target` on the card to enable yield expectation with an explicit target.

### What is deliberately not in the wizard

- **Subclass picker.** Only `KeeperStakingVault` is deployed. Future subclasses (e.g. `CowStakingVault`) will either replace or extend this surface, but no choice is offered to the user in this iteration.
- **Yield target input.** Out of scope for this iteration; configured post-creation only via the card's Yield Target Component. The default `uint256.max` is a fully functional state, not a placeholder.
- **Approval-target distinction in the UI.** The user does not see whether the approval target is the NPM or the Factory.
- **Vault address preview.** Counterfactual (CREATE2-based) address computation could let the wizard show the upcoming vault address before creation. Out of scope; the address appears in the position card after the transaction confirms.
- **Other entry points.** Import NFT by ID, Import Tokenized Position by Address, and Scan Wallet are deferred. The Import Tokenized entry point is a natural future extension for vault-by-address import; Scan Wallet would require indexing of the factory's `VaultCreated` events.

## 3.4 Backend requirements derived

This section consolidates the requirements that the lower phases (5+ in the renumbered guide) will need to fulfil.

### Confirmed from §3.1

- **`SwitchConnectedWalletPrompt` component.** Reusable across position types; not vault-specific. Must be built.
- **localStorage cleanup hook on position delete.** When a position is deleted, the keys `vault-card-slot:<positionHash>` (and any future per-position UI preferences) must be removed.
- **Withdraw-wizard preview service.** A service that, given a vault position and a `liquidity` parameter (derived from the user's slider position), returns the simulated outcome at the current pool state: which `swapStatus` the call will hit, the resulting buffers (`unstakeBufferBase/Quote`, `rewardBufferBase/Quote` deltas), the trade preview if applicable (Cases 2/3), and the resulting claimable-funds delta. The service must compute the post-T=0 outcome when the current state is Underwater. Phase 4 will extend this service to also preview the externally-financed (Position Closer Contract) execution path.
- **Yield Target Component is on-chain-driven only.** No client-side memo, no off-chain pause/resume mechanism, no Phase 4 dependency. The component derives entirely from `state.yieldTarget`, with `uint256.max` as the off-state sentinel. Disabling automation is `setYieldTarget(uint256.max)`; re-enabling is `setYieldTarget(<newValue>)`.

### Confirmed from §3.2 (Accounting & Technical Details)

- **Chart of Accounts extension.** Four new accounts (`1010 Staking Position at Cost`, `1020 Position Cash Holdings`, `2000 Pending Settlement`, `4400 Realized Yield`) plus the new `2xxx` Liability class. Database migration required to extend the `account_definitions` table with the new entries. Final account codes are subject to alignment with existing conventions; the codes proposed here are suggestions.
- **`UniswapV3StakingVaultPostJournalEntriesRule`.** New journal-posting rule consuming the five `STAKING_*` domain events (with all four `disposalKind` variants on `STAKING_DISPOSE`) and producing journal entries per the account mapping in [position-concept.md §2.3](./position-concept.md#account-mapping). Includes the owner-swap addendum lines and the keeper-settle no-addendum logic.
- **`UniswapV3StakingVaultReconcileRule`.** New reconciliation rule checking the two invariants from [position-concept.md §2.3](./position-concept.md#reconciliation): `1010` balance equals `Position.costBasis`, and `1020` balance equals `2000` balance equals booked value of all four buffer slots (with the owner-swap `amountInValue` adjustment).
- **`useUniswapV3StakingVaultPositionAccounting` hook.** Frontend data hook for the Accounting tab.

### Confirmed from §3.2 (APR Analysis)

- **APR period bracketing on `STAKING_DEPOSIT` and `STAKING_DISPOSE` only.** The `position_apr_periods` table population logic must skip `STAKING_CLAIM_REWARDS` events when forming periods. Automation-off phases (`yieldTarget == uint256.max`) are counted as Active Days.
- **APR computation hook.** A `useUniswapV3StakingVaultPositionApr` hook (or extension of an existing APR hook with vault-discriminator support) feeding the single-card APR breakdown plus the periods list.

### Confirmed from §3.2 (PnL Analysis)

- **Position Ledger query** must return all five `STAKING_*` event types, including PnL-neutral events (`STAKING_UNSTAKE`, `STAKING_CLAIM_REWARDS`, `STAKING_CHANGE_CONFIG`). The `useUniswapV3StakingVaultPositionEvents` hook (or equivalent) feeds the Position Ledger table; the `STAKING_CHANGE_CONFIG` events are sourced from the ledger like any other event despite producing no journal entry. The Details column rendering must discriminate on `config.depositKind` (for deposits) and `config.disposalKind` (for disposals).
- **PnL Breakdown computation hook.** A `useUniswapV3StakingVaultPositionPnL` hook (or extension of an existing PnL hook with vault-discriminator support) feeding the two-card Realized/Unrealized breakdown.

### Confirmed from §3.2 (Overview & Automation)

- **Overview composition.** No new endpoints; the Overview tab composes from data already exposed for §3.1 (card metrics, vault state) and shares the range-visualisation component with the NFT pattern. A thin `useUniswapV3StakingVaultPositionOverview` aggregation hook is recommended for the page-level data fetch but is largely a composition over existing hooks.
- **Automation tab data hook.** A `useUniswapV3StakingVaultPositionAutomation` hook providing the three indicators (Automation Status, Settlement Availability, Lifetime Bounty Paid), the live settlement preview (composing `state.swapQuote` and `state.settleQuote`), and the keeper activity log (filtered list of `STAKING_DISPOSE` events with `config.disposalKind ∈ {keeper-swap, keeper-settle}`).
- **`state.lifetimeBountyPaid` aggregation.** A consumer subscribing to `STAKING_DISPOSE` events and incrementing the field on every `disposalKind == 'keeper-settle'` occurrence. Quote-valued at `P_settle` of each event.

### Confirmed from §3.3 (Create Wizard extension)

- **Wizard state extension.** A `positionType: 'standard' | 'staking_vault'` field added to the Create Wizard's query-string state and React state machine. Default `'standard'`. Persisted across all four wizard steps.
- **Step 1 Position Type dropdown.** New Summary-panel section between `Selected Pool` and `Allocated Capital`, two options. No subclass picker — the staking_vault option always deploys a Keeper subclass.
- **Step 2 SL/TP tab inactivation.** When `positionType == 'staking_vault'`, the SL/TP Setup tab renders an info panel instead of the input fields. The Summary panel's Risk Profile section replaces the SL/TP lines with a single Yield Target informational line.
- **Step 4 transaction-list resolver.** Produces the position-type-specific transaction list including approval targets (NPM for standard, Factory for staking vault) and the final mint vs. createVault call. Button label is parametrised on position type.
- **Factory ABI integration.** `factory.createVault(kindLabel, ...)` call construction, with `kindLabel = keccak256("keeper-staking-vault-v1")` hardcoded for this iteration. The complete signature is fixed by SPEC-0003d (Vault Implementation Registry). Yield target is **not** a parameter — vault is initialised with `yieldTarget = uint256.max`.

### Phase 4 dependencies

The following Phase 3 surfaces have Phase-4 extension points:

- **Withdraw wizard** — the externally-financed execution path (via Position Closer Contract) attaches as a second branch in Step 2's multicall composition. The wizard's slider-and-preview UI is stable; only the execution mechanism extends.
- **Automation tab** — a new owner-side block exposes the Position Closer Contract as the externally-financed counterpart to the self-funded Withdraw wizard. Keeper notification or registration mechanics, if any, also attach here.

### TBD

- Other Add-position entry points (Import NFT by ID, Import Tokenized by Address, Scan Wallet) — separate iteration.
- Future `CowStakingVault` integration: contingent on the watch-tower spike (per RFC-0003 §8.3). When it lands, the single-product UI framing in the document head will be revisited.
