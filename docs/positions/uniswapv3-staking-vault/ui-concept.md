# UI Concept — `uniswapv3-staking-vault`

> Phase 3 concept document for the Uniswap V3 Staking Vault integration,
> per [how-to-implement-new-positions.md](../../how-to-implement-new-positions.md).
> This document specifies the UI surface — card layout, detail page tabs,
> add-position flow, and the backend requirements those surfaces produce.
>
> Reference inputs:
> - [`mental-model.md`](./mental-model.md) — user-facing framing
> - [`position-concept.md`](./position-concept.md) — Phase 1 (identity, lifecycle, economic invariant) and Phase 2 (metrics)
> - [`docs/ui.md`](../../ui.md) — global UI templates for the existing position types (NFT, Vault Shares)
>
> Phase 4 (Automation Surface) for this position is not yet written.
> Several decisions in this document — particularly the technical
> realisation of the yield-target pause/resume mechanic — depend on
> the Phase 4 outcome and are explicitly marked as such.

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

- **`In Range`** / **`Out of Range`** — pool price relative to the wrapped NFT's `[tickLower, tickUpper]` range, projected into quote via `isToken0Quote`. Same semantics as the NFT card, same green/red colouring. Per the position concept (§2.1.6), the wrapped-NFT range is the productivity range; "In Range" means the position is actively rebalancing and accruing fees.
- **`Settled`** — when `vaultState == 'Settled'` (per Phase 1.2 forward-monotonic). Replaces the NFT pattern's `Closed` badge; the lifecycle semantics are different (forward-monotonic, not reopenable), so the name diverges deliberately.
- **`Staking`** — neutral type-identifier, analogous to `Tokenized` on the existing Vault-Share card. Always present (except when `Settled`).
- **`<n> days`** — age indicator computed from `positionOpenedAt`. Reused from existing card pattern, no protocol-specific behaviour.

Badges deliberately **not** included:

- `Burned` — the wrapped NFT may technically be burned after settlement and full drain, but this is irrelevant to the vault user. The vault clone's address is permanent (per SPEC §1) and is the user's reference, not the NFT.
- `Underwater` — the underwater state is an internal vault condition that surfaces in the Overview tab's Position State block via the `swapStatus` indicator (see §3.2, Overview tab); it does not warrant a card-level badge.
- `Pending Partial` — the partial-unstake-pending state (`pendingBps > 0`) is surfaced in the Overview tab's Position State block (see §3.2), not on the card.
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

The wrapped NFT's `tokenId` is **not** displayed on the card. It is an implementation detail (per §1.1) and lives in the Technical Details tab of the detail page (see §3.2).

### Slot 3 — Metrics block

Five fields, replacing or reinterpreting the standard NFT slots:

| Slot | Vault-card content |
|---|---|
| 1 | **`Current Value` (USDC) / `Current Stake` (Token-Pair)** — toggle-able, default `Current Value`. Shows mark-to-market in quote (per §2.1.1) or the staked inventory as a token-pair (e.g. `1 WETH / 2,000 USDC`). User toggle persists via localStorage, keyed on `positionHash`. |
| 2 | **PnL Curve** — mini-sparkline of position value vs. base price, identical visualisation to the NFT card with vault-specific `computeCurrentValue` as input. Acceptable as a starting visualisation; vault-specific refinements (e.g. underwater-region marking at `T > 0`) are deferred. |
| 3 | **Total PnL (USDC)** — `realizedPnl + unrealizedPnl + collectedYield + unclaimedYield` per the standard four-component decomposition (§2.3). Up/down arrow with red/green tinting, identical to NFT card. |
| 4 | **`Claimable Funds` (USDC)** — combined value of both buffers: `(unstakeBufferBase + rewardBufferBase) × P_pool + unstakeBufferQuote + rewardBufferQuote`. Amber when > 0. The combined value avoids breaking the five-slot pattern; the per-buffer breakdown is available in the detail page. |
| 5 | **`Yield Target` (USDC)** — `state.yieldTarget`, replacing the NFT card's `est. APR` slot. The vault has no continuous yield rate; the target is the meaningful number. When `yieldTarget == uint256.max`, displays as `–` or `Not set`. |

**localStorage key convention** for the Slot 1 toggle: `vault-card-slot:<positionHash>`. Cleanup hook required when the position is deleted (see §3.4).

### Slot 4 — Right-side common buttons

| Button | Vault behaviour |
|---|---|
| **View Details** | Identical to NFT pattern. Navigates to detail page; stores current dashboard URL for back-navigation. |
| **Refresh** | Identical to NFT pattern. `POST /refresh`. |
| **3-dot menu** | Two items: **Reload History** (identical to existing pattern), **Delete Position** (with localStorage cleanup, see §3.4). **`Switch Quote Token` is dropped** — `isToken0Quote` is on-chain immutable per SPEC §1, and a switch would violate the vault's case-classification semantics. |

### Slot 5 — Bottom action row

The action row mirrors the NFT pattern as closely as the protocol allows. Owner-only buttons follow the multi-wallet handling described above.

**Layout**:

```
[+ Stake More] [- Unstake] [$ Claim Funds]   ◇   [Pool Price] [Yield Target Component]   ◇   [Archive Position]
```

#### Position management buttons (left section)

| Button | Visibility | Action |
|---|---|---|
| **`+ Stake More`** | Visible if `isOwnedByUser`. Always enabled when `vaultState != 'Settled'`. | Navigates to a top-up wizard page, analogous to the existing `IncreaseDepositPage` pattern. Atomic deposit + stake. |
| **`- Unstake`** | Visible if `isOwnedByUser`. Enabled if `vaultState != 'Empty'`. | Opens the unstake wizard (specified below). |
| **`$ Claim Funds`** | Visible if `isOwnedByUser`. Enabled if `claimableFunds > 0`. | Opens the claim-funds modal (specified below). |

#### Unstake wizard

The unstake wizard is status-centric, not configuration-centric: the user selects how much to unstake, and the wizard previews exactly what will happen (resulting swap, economic impact, claimable funds delta).

**Step 1 — Configure & Preview**:

- **Withdrawal slider** (0%–100% in basis points). The user picks one number.
- **Status section** below the slider, live-updating as the slider moves:
  - The resulting swap (`<base in> → <quote out>` or vice versa, with effective rate vs. spot, e.g. `1 WETH → 1,300 USDC, 700 USDC under spot`).
  - Economic impact: realized PnL, claimable funds delta, with red/green tinting.
  - Implicit T-mechanics are **not surfaced**: when the position is underwater, the wizard internally performs `setYieldTarget(0)` before the swap and restores `yieldTarget` to the proportional residual (`T_old × (1 − bps/10000)`) afterwards. This is pure mechanics; the user does not see it. The user sees only the resulting swap and its economic effect.
- **Toggle row** below the status section, two states:
  - Self-execute mode (default): _"You need <X> USDC additional funds, which will be returned in the same transaction. [ ] Use flashloan instead"_
  - Flashloan mode (after toggle): _"Flash loan cost: <Y> USDC. [ ] No flashloan, self execute"_
  - Toggling switches the entire status section to the alternative path and updates economic figures accordingly.

**Step 2 — Execute Transaction**:

A multicall, contents depending on the chosen path:

- **Self-execute path**:
  1. (conditional, if underwater) `setYieldTarget(0)`
  2. `swap(bps)` with the user supplying deficit-side liquidity from their wallet
  3. (conditional, if partial unstake and underwater) `setYieldTarget(T_old × (1 − bps/10000))`
  4. `unstake()`
  5. `claimRewards()`
- **Flashloan path**:
  1. `flashClose(bps)` (which auto-drains internally per SPEC §15)

The wizard preview requires a backend service that simulates the post-action state for any given `bps` and path (self-execute vs. flashloan). This service does not exist today and is a Phase 3.4 requirement. See §3.4.

#### Claim-funds modal

A modal dialog with two checkboxes, allowing the user to drain principal and yield independently or together:

- **`[ ] Claim Unstaked Funds`** — value: `unstakeBufferBase × P_pool + unstakeBufferQuote`. Defaults to checked if `unstakeBuffer*` is non-zero; disabled and unchecked if zero.
- **`[ ] Claim Rewards`** — value: `rewardBufferBase × P_pool + rewardBufferQuote`. Defaults to checked if `rewardBuffer*` is non-zero; disabled and unchecked if zero.

Execution is a multicall containing the user-selected drains. Critically, **the two ledger events remain separate**: a `STAKING_UNSTAKE` event for principal drain, a `STAKING_CLAIM_REWARDS` event for yield drain, each with its own `tokenValue` and accounting impact. The combined-modal UX is purely a transaction-batching convenience; the underlying domain separation (principal vs. yield) is preserved per the position concept (§2.3).

#### Pool Price and Yield Target Component (middle section)

Between the position-management buttons and the archive button, two informational/control elements:

- **Pool Price** — live-updating display, identical to the NFT card's `Current Price` element. Reuse the existing component as-is.
- **Yield Target Component** — vault-specific, structurally analogous to the NFT card's stop-loss/take-profit element. Three states:

  | State | Display | Click targets |
  |---|---|---|
  | No target set (`yieldTarget == uint256.max`) | `+ Yield Target` button | Click opens a modal to set an initial value via `setYieldTarget(<value>)`. |
  | Active target (`yieldTarget < uint256.max`, not paused) | `[Pause-Icon] | <value> USDC [Pen-Icon] | X` | **Pause-Icon**: pauses automation (mechanism TBD per Phase 4). **Centre section**: opens edit modal. **X**: removes target via `setYieldTarget(uint256.max)`. |
  | Paused target | `[Resume-Icon] | <value> USDC [Pen-Icon] | X` | **Resume-Icon**: re-activates the previously-set target. Centre and X behave as in the active state. |

  All click targets that trigger a wallet transaction display a **pending state** during transaction submission (e.g. a spinner overlay, with other targets disabled). The state changes only after the transaction confirms; if it fails or is cancelled, an error popup is shown and the component reverts.

  **The technical realisation of pause/resume is a Phase 4 decision.** Three plausible architectures exist:
  - On-chain `setYieldTarget(uint256.max)` plus off-chain memo of the previous value.
  - On-chain `yieldTarget` unchanged, plus an off-chain automation flag that the solver/keeper layer respects.
  - Hybrid: on-chain `uint256.max` plus off-chain notification to the automation layer.

  Which architecture is correct depends on the Phase 4 outcome of how the vault's settlement automation is realised (constitutive permissionless `swap()`, plus possibly active solver-network registration). Phase 4 will fill this in; the UI specification above is stable across all three options.

#### Archive button (right section)

- **Archive Position** — visible when `vaultState == 'Settled' AND claimableFunds == 0`. Toggles `isArchived` via `useArchivePosition`. Identical to the existing pattern.

#### Multi-wallet treatment summary

`+ Stake More`, `- Unstake`, `$ Claim Funds`, and the Yield Target Component's three click targets all follow the multi-wallet handling defined at the top of this document. They are visible whenever `isOwnedByUser == true`; on click, if `isConnectedWalletOwner == false`, `SwitchConnectedWalletPrompt` opens before the actual action.

`Archive Position`, `View Details`, `Refresh`, and the 3-dot-menu items are not owner-only — they manage the user's tracking record, not the on-chain vault — and have no `SwitchConnectedWalletPrompt` requirement.

## 3.2 Detail page tabs

The detail page has seven canonical tabs (see [`docs/ui.md` §Tabs](../../ui.md#tabs-common-to-both-types)). Each tab requires a per-protocol decision: applies as-is, reinterpreted, or dropped.

This section is filled in incrementally as the tabs are walked. Five tabs are specified below; the two remaining (Conversion → Swap, Automation) are Phase 4 dependent.

### Tab: Overview

**Status: applies as-is, with a vault-specific Position State block.**

The Overview tab follows the existing pattern: a hero summary at the top, the price-range visualisation as the centrepiece, and supporting blocks below. The vault-specific addition is the Position State block, which surfaces operational status that has no NFT analog.

#### Hero Summary section

A compact top row with the four headline metrics, presented at larger size than on the card:

- **Current Value** — `currentValue` in quote, prominent
- **Total PnL** — `realizedPnl + unrealizedPnl + collectedYield + unclaimedYield`, with arrow and red/green tinting
- **Cost Basis** — `costBasis` in quote
- **Yield Target** — `state.yieldTarget` (or `Not set` if `uint256.max`)

These are the same metrics as the card's Slot 3 block, recomposed for the larger detail-page surface.

#### Range Visualisation section

The shared range-visualisation component is reused as-is. Shows:

- The wrapped NFT's `[priceRangeLower, priceRangeUpper]` band
- The current pool price as a marker
- In-Range / Out-of-Range status, colour-coded consistently with the Slot 1 badge

No vault-specific adaptations. The range is displayed because the wrapped NFT does have a real range, even though the user's settlement is gated by yield-target satisfaction rather than range-crossings.

#### Position State block (vault-specific)

A four-indicator grid surfacing the operational state. Each indicator with concise styling:

| Indicator | Possible values |
|---|---|
| **Vault State** | `Empty` / `Staking` / `Settled` (neutral colour) |
| **Swap Status** | `NotApplicable` / `NoSwapNeeded` / `Executable` (green) / `Underwater` (red) |
| **Yield Target** | `Not set` / `<value> USDC active` / `<value> USDC paused` (single-row presentation combining value and pause state) |
| **Pending Unstake** | `None` / `<X>% pending` |

The Underwater condition surfaces here as one of the four Swap Status values, in red. No separate warning box and no card-level badge — the red Swap Status indicator carries the information without overdramatising. Underwater is a user-caused condition (the user set `T`), not a system emergency.

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
- Realized from Flash-Loan Fees — only if pipeline can extract `flashLoanFee` (see Phase 5 dependency)
- = Subtotal

All four lines map directly to accounting accounts (see Accounting tab and [position-concept.md §2.3](./position-concept.md#account-mapping)). The Realized PnL card includes all yield that has been recognised at the disposal — even if the corresponding tokens still sit in the reward buffer waiting to be drained. This is consistent with the disposal-time recognition rule from [position-concept.md §2.1.4](./position-concept.md#21-common-metric-mapping).

**Unrealized PnL** card (live mark-to-market):
- Current Position Value — `currentValue`
- Cost Basis — `costBasis`
- = Subtotal: `currentValue − costBasis` = `unrealizedPnl`

Unlike the NFT pattern, the Unrealized card does not have a separate "Unclaimed Fees" line. The vault has no continuous fee accumulation; what the NFT pattern would call "unclaimed" is in the vault either already-recognised (in the reward buffer post-disposal) or not yet existing (no disposal has occurred). Buffer-tokens at-cost are baked into both `currentValue` (mark-to-market) and the Pending Settlement liability that offsets them.

#### Position Ledger section

The Position Ledger is the chronological audit trail of all events affecting the position, including PnL-neutral events. Five event types appear:

- **`STAKING_DEPOSIT`** — initial stake or top-up; affects cost basis
- **`STAKING_DISPOSE`** — settlement (swap or flashClose); recognises PnL and yield
- **`STAKING_UNSTAKE`** — drain of unstake-buffer; PnL-neutral
- **`STAKING_CLAIM_REWARDS`** — drain of reward-buffer; PnL-neutral
- **`STAKING_CHANGE_CONFIG`** — owner-intent change (yield target, partial-unstake bps); PnL-neutral

All events render with identical visual treatment, consistent with the existing NFT/Vault-Share Position Ledger. PnL-neutral events display `0` or `—` in the Realized PnL column; the chronological context makes their role clear.

Table columns: **Date & Time**, **Event Type**, **Value**, **Realized PnL**, **Details**, **Transaction**.

**Details column content** per event type:

| Event Type | Details column |
|---|---|
| `STAKING_DEPOSIT` | `+<base> + <quote> staked` (token amounts consumed) |
| `STAKING_DISPOSE` | `bps: <X>, principal: $<Y>, yield: $<Z>` (settlement summary, optional flash-loan fee if extractable) |
| `STAKING_UNSTAKE` | `<base> + <quote> drained` (token amounts) |
| `STAKING_CLAIM_REWARDS` | `<base> + <quote> drained` (token amounts) |
| `STAKING_CHANGE_CONFIG` | `<param>: <oldValue> → <newValue>` (e.g. `yieldTarget: 400 USDC → 600 USDC`) |

The Transaction column links to the on-chain explorer for the transaction hash, identical to the NFT pattern.

### Tab: APR Analysis

**Status: reinterpreted.**

The shared APR-Analysis tab structure is reused, but the Unrealized-APR card is dropped because the vault has no continuous yield-accumulation between settlements. Yield is recognised at disposal events; between disposals the position has zero realised yield, and there is no meaningful live projection of "yield in flight" comparable to NFT `tokensOwed`.

#### APR Breakdown section

Single-card layout (instead of the NFT pattern's two-card Realized/Unrealized split):

- **Total APR** — header line, e.g. `Total APR: 12.4% (over 47.3 days)`. Equals the Realized APR below; no Unrealized component contributes.
- **Realized APR** card with the breakdown:
  - Total Yield Collected — `collectedYield` from [position-concept.md §2.1.4](./position-concept.md#21-common-metric-mapping)
  - Time-Weighted Cost Basis — weighted average of `costBasis` across all completed periods
  - Active Days — sum of days across all completed periods (see Pause handling below)
  - `= Realized APR` — `(Total Yield Collected / Time-Weighted Cost Basis) × (365 / Active Days)`

The Unrealized-APR card from the NFT pattern is omitted entirely. The vault's yield mechanic does not support a "yield in flight" estimate: between disposals, no yield is accumulating in any meaningful sense — the yield substance materialises atomically at the `swap()` or `flashClose()` moment.

#### APR Periods section

Chronological list of completed APR periods. Each period spans from one bracket event to the next.

**Bracket events**: `STAKING_DEPOSIT` and `STAKING_DISPOSE` only. Per [position-concept.md §2.1.5](./position-concept.md#21-common-metric-mapping), `STAKING_CLAIM_REWARDS` does not bracket because it is a pure asset/liability movement, not a recognition event — `collectedYield` was already incremented at the prior `STAKING_DISPOSE`.

Per period, the table shows:

- Start event (date, type)
- End event (date, type)
- Cost Basis (the average during the period)
- Yield Collected (= `collectedYield` recognised at the period's end event, if it was a `STAKING_DISPOSE`; otherwise zero)
- Days
- APR

If no APR periods exist yet (the position has had no `STAKING_DISPOSE` events), the section displays a hint: _"No completed APR periods yet. Periods are computed at disposal events."_ — analogous to the NFT pattern's empty-state.

#### Pause-phase treatment in APR computation

When the owner pauses the yield-target component (per [§3.1 Slot 5](#slot-5--bottom-action-row), Yield Target Component pause/resume), the position remains staked and capital remains committed, but no settlement can occur. Pause phases **count toward `Active Days`** in the APR computation.

Rationale: APR's definition is `(yield / capital × time)`, and capital is committed throughout the pause. Excluding pause phases would overstate the effective return. If the owner chooses to forgo settlement opportunities, the resulting lower APR should be visible — it reflects an investment decision with consequences.

This treatment is independent of the underlying technical realisation of pause/resume (Phase 4 dependency, see [§3.1 Slot 5](#slot-5--bottom-action-row)).

### Tab: Conversion → Swap

*To be specified.* Tentative direction: the Conversion tab's premise (reconstructing AMM token-amount drift) does not apply to the vault, since token amounts are conserved by construction. The slot will be replaced by a Swap tab presenting the current `swapQuote` and the executor invitation. Final design depends on Phase 4 (Automation Surface).

### Tab: Automation

*To be specified.* Phase 4 dependency.

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

Four line items, all recognised at disposal time:

- **Realized from Withdrawals** — the `B × ΔP` quantity from `STAKING_DISPOSE`, booked to `4100 Realized Gains` or `5000 Realized Losses`.
- **Realized from Yield** — yield component from `STAKING_DISPOSE`, booked to `4400 Realized Yield`.
- **Realized from FX Effect** — quote→USD conversion drift, booked to `4300 FX Gain / Loss`.
- **Realized from Flash-Loan Fees** — present only if the on-chain pipeline can extract `flashLoanFee` separately (see [position-concept.md §2.3](./position-concept.md#staking_dispose-with-non-zero-flashloanfee)). Otherwise, the fee is implicit in Realized from Withdrawals and the row is omitted.

The drain events (`STAKING_UNSTAKE`, `STAKING_CLAIM_REWARDS`) produce no P&L lines, since they are pure asset/liability movements.

#### Journal Entries section

Standard chronological list of journal entries, one per non-marker event. Each entry shows the date, a descriptive line referencing the event (e.g. `Vault disposal: uniswapv3-staking-vault/<chainId>/<vaultAddress>`), and the debit/credit lines per the account-mapping in [position-concept.md §2.3](./position-concept.md#account-mapping).

`STAKING_CHANGE_CONFIG` events do not appear in the Journal Entries section, only in the Position Ledger (PnL Analysis tab).

### Tab: Technical Details

**Status: applies as-is.**

The shared `PositionTechnicalDetailsTab` layout is reused: two columns, Vault Configuration (left, immutable) and Vault State (right, mutable). Each field renders as a read-only input with copy and (where applicable) explorer-link icons.

#### Vault Configuration column

Immutable fields from [position-concept.md §2.2](./position-concept.md#22-type-specific-metrics) plus the immutable owner address:

- Vault Address (with explorer link)
- Factory Address (with explorer link)
- Wrapped NFT Token ID (with link to the NFT manager view on the explorer)
- Pool Address (with explorer link)
- Token0 Address, Token1 Address (with explorer links)
- Fee Tier
- Tick Spacing
- Tick Lower, Tick Upper
- Is Token0 Quote (Yes / No)
- Price Range Lower, Price Range Upper (in quote)
- Owner Address (with explorer link) — set immutably at clone initialisation per SPEC §1; conceptually belongs in Configuration despite being read from `vault.owner()` at runtime

#### Vault State column

Mutable fields from [position-concept.md §2.2](./position-concept.md#22-type-specific-metrics), excluding `swapQuote` (which is presented in the Automation tab where the executor invitation is the meaningful surface):

- `vaultState` (Empty / Staking / Settled)
- `swapStatus` (NotApplicable / NoSwapNeeded / Executable / Underwater)
- `stakedBase`, `stakedQuote`
- `yieldTarget`
- `pendingBps`, `effectiveBps`
- `unstakeBufferBase`, `unstakeBufferQuote`
- `rewardBufferBase`, `rewardBufferQuote`
- `sqrtPriceX96`, `currentTick`, `poolLiquidity`
- `wrappedNftLiquidity`

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

Pool selection, base/quote token selection, and chain selection are unchanged — both position types operate on the same Uniswap V3 pool set.

### Step 2 — Capital Allocation / Position Range / SL-TP Setup: per-tab treatment

The three-tab structure of step 2 is preserved for visual consistency.

**Capital Allocation tab** — identical for both position types. The wizard collects `(B, Q)` token amounts; for the staking vault these become the `(B, Q)` of the initial stake passed to `factory.createVault(...)`.

**Position Range tab** — identical for both position types. The selected `[lowerTick, upperTick]` becomes the wrapped NFT's range, set immutably at vault creation.

**SL/TP Setup tab** — when `Position Type == Staking Vault`, the tab is visible but inactive. It displays an info panel:

> _**Stop-loss and take-profit are not applicable to staking vaults.** The vault's settlement is governed by a yield target instead, set in quote-token units. The yield target defaults to `uint256.max` (Not set) at creation, leaving the vault in the strong-guarantee state where principal recovery is structurally always honourable (per [position-concept.md §1.3](./position-concept.md#13-economic-invariant), Strong guarantee at T=0). It can be configured after creation via the position card's Yield Target Component (per [§3.1 Slot 5](#slot-5--bottom-action-row))._

No yield-target input is collected in the wizard. The yield target is **only** configurable post-creation via the card's Yield Target Component. Rationale: keeping the wizard's `createVault()` call as a single atomic transaction (deploy + initial stake) without forcing the user to commit to a target before they've seen the position in their portfolio. The vault is fully usable in the `uint256.max` / Strong-guarantee state; the user is not blocked.

The Summary panel's `Risk Profile` section adapts when `Position Type == Staking Vault`: the Stop Loss / Take Profit / Max Drawdown / Max Runup lines are replaced by a single line:

```
Yield Target    Not set
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
| 4 | **Open** UniswapV3 Position (`NPM.mint(...)`) | **Create** Staking Vault (`factory.createVault(...)`) |

The pool price drift check is a generic sanity pattern and runs identically for both position types.

For the staking vault, the final transaction calls `factory.createVault(...)` which atomically deploys the EIP-1167 clone, initialises ownership (immutably setting `vault.owner()` to the connected wallet per SPEC §1), and performs the initial stake — closing the standard EIP-1167 front-running race per [position-concept.md §1.1](./position-concept.md#11-identity).

The button label changes from `Open UniswapV3 Position` to `Create Staking Vault` accordingly. Approval targets change from NPM to Factory, but this is implementation detail not surfaced to the user beyond the transaction count being identical.

The Summary panel's `Selected Pool` block remains identical; only the Risk Profile section reflects the position-type difference (configured in Step 2).

### Post-creation handoff

After successful execution of the final transaction, the wizard navigates to the position list. For a staking vault, the new card appears with `Yield Target: Not set` in Slot 5 of the bottom action row (per [§3.1 Slot 5](#slot-5--bottom-action-row)). The user can either leave the vault in the strong-guarantee state (the default) or click `+ Yield Target` on the card to enter the conditional-guarantee state with an explicit target.

### What is deliberately not in the wizard

- **Yield target input.** Out of scope for this iteration; configured post-creation only via the card's Yield Target Component. The default `uint256.max` is a fully functional state, not a placeholder.
- **Partial-unstake-bps configuration.** Defaults to `0` (no pending partial); the user does not need to think about this at creation.
- **Approval-target distinction in the UI.** The user does not see whether the approval target is the NPM or the Factory.
- **Vault address preview.** Counterfactual (CREATE2-based) address computation could let the wizard show the upcoming vault address before creation. Out of scope; the address appears in the position card after the transaction confirms.
- **Other entry points.** Import NFT by ID, Import Tokenized Position by Address, and Scan Wallet are deferred. The Import Tokenized entry point is a natural future extension for vault-by-address import; Scan Wallet would require indexing of the factory's `VaultCreated` events.

## 3.4 Backend requirements derived

This section consolidates the requirements that the lower phases (5+ in the renumbered guide) will need to fulfil.

### Confirmed from §3.1

- **`SwitchConnectedWalletPrompt` component.** Reusable across position types; not vault-specific. Must be built.
- **localStorage cleanup hook on position delete.** When a position is deleted, the keys `vault-card-slot:<positionHash>` (and any future per-position UI preferences) must be removed.
- **Unstake-wizard preview service.** A service that, given a vault position and a `bps` parameter, returns the simulated outcome for both the self-execute path and the flashloan path: resulting swap details, realized PnL, claimable funds delta, flash-loan fee estimate. This is a new service, parallel to the existing `simulate_position_at_price` for NFT positions, but with vault-specific economics.
- **Yield-target pause/resume mechanic.** Phase 4 dependency; see §3.1 Slot 5. The UI specification is stable; the technical realisation is open.

### Confirmed from §3.2 (Accounting & Technical Details)

- **Chart of Accounts extension.** Four new accounts (`1010 Staking Position at Cost`, `1020 Position Cash Holdings`, `2000 Pending Settlement`, `4400 Realized Yield`) plus the new `2xxx` Liability class. Database migration required to extend the `account_definitions` table with the new entries. Final account codes are subject to alignment with existing conventions; the codes proposed here are suggestions.
- **`UniswapV3StakingVaultPostJournalEntriesRule`.** New journal-posting rule consuming the five `STAKING_*` domain events and producing single-entry journal entries per the account mapping in [position-concept.md §2.3](./position-concept.md#account-mapping).
- **`UniswapV3StakingVaultReconcileRule`.** New reconciliation rule checking the two invariants from [position-concept.md §2.3](./position-concept.md#reconciliation): `1010` balance equals `Position.costBasis`, and `1020` balance equals `2000` balance equals booked value of all four buffer slots.
- **`useUniswapV3StakingVaultPositionAccounting` hook.** Frontend data hook for the Accounting tab.

### Confirmed from §3.2 (APR Analysis)

- **APR period bracketing on STAKING_DEPOSIT and STAKING_DISPOSE only.** The `position_apr_periods` table population logic must skip `STAKING_CLAIM_REWARDS` events when forming periods. Pause phases (yield-target paused) are counted as Active Days regardless of pause-resume mechanism (Phase 4).
- **APR computation hook.** A `useUniswapV3StakingVaultPositionApr` hook (or extension of an existing APR hook with vault-discriminator support) feeding the single-card APR breakdown plus the periods list.

### Confirmed from §3.2 (PnL Analysis)

- **Position Ledger query for the vault** must return all five `STAKING_*` event types, including PnL-neutral events (`STAKING_UNSTAKE`, `STAKING_CLAIM_REWARDS`, `STAKING_CHANGE_CONFIG`). The `useUniswapV3StakingVaultPositionEvents` hook (or equivalent) feeds the Position Ledger table; the `STAKING_CHANGE_CONFIG` events are sourced from the ledger like any other event despite producing no journal entry.
- **PnL Breakdown computation hook.** A `useUniswapV3StakingVaultPositionPnL` hook (or extension of an existing PnL hook with vault-discriminator support) feeding the two-card Realized/Unrealized breakdown.

### Confirmed from §3.2 (Overview)

- **Overview composition.** No new endpoints; the Overview tab composes from data already exposed for §3.1 (card metrics, vault state) and shares the range-visualisation component with the NFT pattern. A thin `useUniswapV3StakingVaultPositionOverview` aggregation hook is recommended for the page-level data fetch but is largely a composition over existing hooks.

### Confirmed from §3.3 (Create Wizard extension)

- **Wizard state extension.** A `positionType: 'standard' | 'staking_vault'` field added to the Create Wizard's query-string state and React state machine. Default `'standard'`. Persisted across all four wizard steps.
- **Step 1 Position Type dropdown.** New Summary-panel section between `Selected Pool` and `Allocated Capital`, two options.
- **Step 2 SL/TP tab inactivation.** When `positionType == 'staking_vault'`, the SL/TP Setup tab renders an info panel instead of the input fields. The Summary panel's Risk Profile section replaces the SL/TP lines with a single Yield Target informational line.
- **Step 4 transaction-list resolver.** Produces the position-type-specific transaction list including approval targets (NPM for standard, Factory for staking vault) and the final mint vs. createVault call. Button label is parametrised on position type.
- **Factory ABI integration.** `factory.createVault(pool, tickLower, tickUpper, baseAmount, quoteAmount, owner)` call construction, with `owner = connectedWallet.address`. Yield target is **not** a parameter — vault is initialised with `yieldTarget = uint256.max`.

### TBD

- Other Add-position entry points (Import NFT by ID, Import Tokenized by Address, Scan Wallet) — separate iteration.
- The two Phase-4-dependent tabs in §3.2 (Conversion → Swap, Automation).
