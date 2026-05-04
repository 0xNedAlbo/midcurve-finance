# Midcurve Finance - UI Reference (Positions)

This document is a structural reference for the position-related surface of the [`apps/midcurve-ui/`](../apps/midcurve-ui/) Vite SPA. It covers the positions list, position detail page, and the "Add Position" entry points — what is shown, which actions are available, and which features are common to all position types versus specific to one.

For the data model behind the UI, see [positions.md](./positions.md). For the overall app architecture, routing, and tech stack, see [architecture.md](./architecture.md) and [`apps/midcurve-ui/CLAUDE.md`](../apps/midcurve-ui/CLAUDE.md).

The two position types currently rendered by the UI are:

- **UniswapV3 NFT position** — `protocol: 'uniswapv3'`, route segment `uniswapv3/{chain}/{nftId}`
- **UniswapV3 Vault Share position** — `protocol: 'uniswapv3-vault'`, route segment `uniswapv3-vault/{chain}/{vaultAddress}/{ownerAddress}`

---

## a) Positions List

The list lives on the dashboard at [`/dashboard`](../apps/midcurve-ui/src/pages/DashboardPage.tsx) under the **Positions** tab. The page header shows the app title, a notification bell, and a user dropdown; the section header carries the **Add Position** dropdown (described in section [c](#c-add-position-menu)). Below it sits a tab switcher for **Positions** / **Accounting**; the latter is a separate dashboard summary, not position-specific.

The list itself is implemented in [`PositionList`](../apps/midcurve-ui/src/components/positions/position-list.tsx) and renders one row per position via protocol-specific card components.

### Filter and sort controls

All filter/sort state lives in URL search params, so the view is shareable and back/forward-navigable.

| Control | Param | Values | Default |
|---|---|---|---|
| Status filter | `status` | `all` · `active` · `archived` | `active` |
| Protocol filter | `protocol` | `all` · `uniswapv3` · `uniswapv3-vault` | `all` |
| Sort by | `sortBy` | `positionOpenedAt` · `totalApr` · `currentValue` | `positionOpenedAt` |
| Sort direction | `sortDirection` | `asc` · `desc` (icon toggle) | `desc` |
| Pagination offset | `offset` | integer, page size **20** | `0` |

There is no free-text search, no fee-tier or token filter, and no per-column sorting — sort options are limited to the three above.

A **refresh** icon button next to the sort controls is shown only when `status=active`. It just refetches the current page; for finding *new* positions on chain, use the **Scan Wallet** option in the Add Position dropdown (section [c](#c-add-position-menu)).

### Per-card layout

Every card has a uniform three-region layout, with a per-protocol action row beneath it.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [icons] PAIR + status badges  │   metrics block   │  view  refresh  ⋮   │
│         protocol-line badges  │                   │                     │
├──────────────────────────────────────────────────────────────────────────┤
│ protocol-specific action buttons row (Increase / Withdraw / Collect …)  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Left — header** ([`PositionCardHeader`](../apps/midcurve-ui/src/components/positions/position-card-header.tsx)):
- Token logo pair (base + quote, overlapping circles)
- Pair name + position-opened timestamp
- Status-line badges:
  - `Burned` (red) — UniswapV3 NFT only, when the NFT has been burned on-chain
  - Range status: `In Range` (green) · `Out of Range` (red) · `Closed` (grey)
- Protocol-line badges: chain badge, identifier (`#nftId` or truncated vault address), owner badge / share-owner badge

**Middle — metrics** ([`PositionCardMetrics`](../apps/midcurve-ui/src/components/positions/position-card-metrics.tsx), protocol-agnostic):
- **Current Value** in quote token
- **PnL Curve** — small SVG sparkline of position value vs base price (mini PnL curve, type-specific component)
- **Total PnL** in quote token, with up/down arrow and red/green tinting (`realizedPnl + unrealizedPnl`)
- **Unclaimed Fees** in quote token (amber when > 0)
- **est. APR** — `totalApr` from the backend; renders `–` with a clock icon when below the noise threshold (~5 minutes of history)

**Right — common buttons:**
- **View Details** (search icon) — navigates to the protocol-specific detail page; stores the current dashboard URL so the detail page's "back" navigates correctly
- **Refresh** (rotate icon) — POSTs to the position's `/refresh` endpoint to re-read on-chain state; spins while pending. The card also auto-refreshes on-chain every 60s, polls the DB every 3s, and patches live pool price every 5s in the background.
- **Three-dot menu** ([`PositionActionsMenu`](../apps/midcurve-ui/src/components/positions/position-actions-menu.tsx)) with three entries:
  - **Reload History** — opens a confirmation modal; re-imports all ledger events from chain/subgraph and rebuilds cumulatives
  - **Switch Quote Token** — opens a confirmation modal; flips `isToken0Quote` and recomputes every quote-denominated field
  - **Delete Position** (destructive, red) — opens a confirmation modal; removes the tracking row (and ledger/journal cascades)

**Bottom — protocol-specific action row.** See [Action button rows](#action-button-rows) below.

### Action button rows

The row beneath each card mixes position-management buttons with automation buttons. Visibility depends on (1) connected wallet vs. on-chain owner, (2) on-chain liquidity / shares / fees state.

#### UniswapV3 NFT — [`UniswapV3Actions`](../apps/midcurve-ui/src/components/positions/protocol/uniswapv3/uniswapv3-actions.tsx)

| Button | Visibility | Action |
|---|---|---|
| **Increase Deposit** / **Reopen Position** | Always (label flips when `liquidity == 0`) | Navigates to `/positions/increase/uniswapv3/{chain}/{nftId}` |
| **Withdraw** | Only when `liquidity > 0` | Navigates to `/positions/withdraw/uniswapv3/{chain}/{nftId}` |
| **Collect Fees** | When `liquidity > 0` OR has unclaimed fees; disabled (grey) when no fees | Opens `UniswapV3CollectFeesModal` |
| **Burn NFT** | Only when `liquidity == 0` AND `tokensOwed{0,1} == 0` AND no unclaimed fees | Opens `UniswapV3BurnNftModal` |
| **Archive Position** | When `liquidity == 0` AND no unclaimed fees | Toggles `isArchived` via `useArchivePosition` |
| ◇ divider ◇ | | |
| **Stop-Loss (SL)** | Always shown; disabled with reason when burned / no liquidity / chain unsupported | Opens close-order modal (LOWER trigger) |
| **Current Price label** | Always | Live-updating flashing price between SL and TP |
| **Take-Profit (TP)** | Same as SL | Opens close-order modal (UPPER trigger) |
| ◇ divider ◇ | | |
| **Tokenize** | Only when `liquidity > 0` | Opens `UniswapV3TokenizePositionModal` (NFT → vault conversion) |

When the connected wallet is **not** the NFT owner *or* the position is archived, the entire row collapses to a single **Archive Position** / **Unarchive Position** button (so the user can hide it from their dashboard).

#### UniswapV3 Vault — [`UniswapV3VaultActions`](../apps/midcurve-ui/src/components/positions/protocol/uniswapv3-vault/uniswapv3-vault-actions.tsx)

| Button | Visibility | Action |
|---|---|---|
| **Increase Deposit** / **Reopen Position** | Always (label flips when `sharesBalance == 0`) | Navigates to `/positions/increase/uniswapv3-vault/{chain}/{vaultAddress}/{ownerAddress}` |
| **Withdraw** | Only when `sharesBalance > 0` | Navigates to `/positions/withdraw/uniswapv3-vault/...` |
| **Collect Fees** | When has shares OR has unclaimed fees | Opens `UniswapV3VaultCollectFeesModal` |
| **Archive Position** | When no shares AND no unclaimed fees | Toggles `isArchived` |
| ◇ divider ◇ | | |
| **Stop-Loss (SL)** | Always shown; disabled when no shares | Opens vault close-order modal |
| **Current Price label** | Always | |
| **Take-Profit (TP)** | Same as SL | Opens vault close-order modal |

There is **no Burn NFT** (vaults are share-based — empty share balances are not destroyed) and **no Tokenize** (it is already tokenized).

The connected wallet must equal the position's `ownerAddress` (the share-holder) to see the full row; otherwise it collapses to the same single **Archive / Unarchive** button.

### Empty state

When the list is empty, [`EmptyStateActions`](../apps/midcurve-ui/src/components/positions/empty-state-actions.tsx) shows a 3-card grid:

1. **Create Position** → opens the wizard at [`/positions/create`](../apps/midcurve-ui/src/pages/CreatePositionPage.tsx)
2. **Import by NFT ID** → inline form (chain dropdown + NFT ID input) using `useImportPositionByNftId`
3. **Scan for Positions** → opens [`ScanPositionsModal`](../apps/midcurve-ui/src/components/positions/scan-positions-modal.tsx)

The empty state intentionally omits **Import Tokenized Position by Address** — that option is only available from the Add Position dropdown when the list is non-empty.

### Pagination

Below the grid: a **Load More (N remaining)** button when `hasMore`, plus a status line `Showing X of Y positions`. The page size is fixed at 20.

---

## b) Position Detail Page

Routes:

- NFT: `/positions/uniswapv3/:chain/:nftId` → [`PositionDetailPage`](../apps/midcurve-ui/src/pages/PositionDetailPage.tsx) → [`UniswapV3PositionDetail`](../apps/midcurve-ui/src/components/positions/protocol/uniswapv3/uniswapv3-position-detail.tsx)
- Vault: `/positions/uniswapv3-vault/:chain/:vaultAddress/:ownerAddress` → [`VaultPositionDetailPage`](../apps/midcurve-ui/src/pages/VaultPositionDetailPage.tsx) → [`UniswapV3VaultPositionDetail`](../apps/midcurve-ui/src/components/positions/protocol/uniswapv3-vault/uniswapv3-vault-position-detail.tsx)

Both pages share the same skeleton: a [`PositionDetailHeader`](../apps/midcurve-ui/src/components/positions/position-detail-header.tsx) on top and a tab strip with **seven** tabs (defined in [`PositionDetailTabs`](../apps/midcurve-ui/src/components/positions/position-detail-tabs.tsx) for NFT and inlined in vault detail). The active tab is in the URL (`?tab=...`); `overview` is the default.

### Detail header (common)

- Token icon pair + pair name
- Status badge: `Active` / `Archived`
- In-range badge
- Chain badge (chain name + colour)
- Fee-tier display (`%`), identifier (`#nftId` or truncated vault address) with explorer link
- "Last updated" timestamp
- Refresh button (manual on-chain sync via the `/refresh` endpoint)
- **Vault adds:** a `Tokenized` badge and a `XX.XX% Shares` badge (`sharesBalance / totalSupply`)

### Tabs (common to both types)

| # | Tab | Icon | Contents | Actions enabled |
|---|---|---|---|---|
| 1 | **Overview** | `BarChart3` | Range status line. Big metric cards: Current Value · Total PnL · Unclaimed Fees · Break-Even Price. **Position States** section: three cards (Current / Lower Range / Upper Range), each with token amounts, pool price, position value, PnL excluding fees, and a mini PnL curve at that tick. | **Simulation** toggle button — replaces the three states with a [`PortfolioSimulator`](../apps/midcurve-ui/src/components/positions/portfolio-simulator.tsx) where the user can drag a price slider to see hypothetical states |
| 2 | **PnL Analysis** | `Clock` | [`PnLBreakdown`](../apps/midcurve-ui/src/components/positions/pnl-breakdown.tsx) (realized vs. unrealized) + [`LedgerEventTable`](../apps/midcurve-ui/src/components/positions/ledger/ledger-event-table.tsx) (full chronological event list). | Read-only |
| 3 | **APR Analysis** | `TrendingUp` | [`AprBreakdown`](../apps/midcurve-ui/src/components/positions/apr-breakdown.tsx) (time-weighted summary) + [`AprPeriodsTable`](../apps/midcurve-ui/src/components/positions/apr-periods-table.tsx) (per-`PositionAprPeriod` row). | Read-only |
| 4 | **Conversion** | `Repeat` | [`ConversionSummary`](../apps/midcurve-ui/src/components/positions/protocol/uniswapv3/conversion-summary.tsx) (net deposits/withdrawals/holdings, average rebalancing direction, fee premium) + [`RebalancingHistoryTable`](../apps/midcurve-ui/src/components/positions/protocol/uniswapv3/rebalancing-history-table.tsx). | Read-only |
| 5 | **Automation** | `Shield` | [`PositionCloseOrdersPanel`](../apps/midcurve-ui/src/components/positions/automation/PositionCloseOrdersPanel.tsx) / [`VaultCloseOrdersPanel`](../apps/midcurve-ui/src/components/positions/automation/VaultCloseOrdersPanel.tsx) listing existing close orders, plus the [`AutomationLogList`](../apps/midcurve-ui/src/components/positions/automation/AutomationLogList.tsx). | **Create / Edit / Cancel** close orders. Edit a close order via [`CloseOrderModal`](../apps/midcurve-ui/src/components/positions/automation/CloseOrderModal.tsx) (4-step wizard: Configure → Review → Processing → Success). Cancel via [`CancelOrderConfirmModal`](../apps/midcurve-ui/src/components/positions/automation/CancelOrderConfirmModal.tsx). |
| 6 | **Accounting** | `BookOpen` | [`PositionAccountingTab`](../apps/midcurve-ui/src/components/positions/accounting/position-accounting-tab.tsx) (shared between protocols): balance sheet section, P&L section, journal entries audit trail. | Read-only |
| 7 | **Technical Details** | `Settings` | Raw position config/state, on-chain references, copy-to-clipboard fields for addresses, NFPM/vault links to block explorer. | Read-only |

### Tab actions versus card actions

The card-row actions (Increase / Withdraw / Collect / Burn / Tokenize / Archive) are **not** repeated on the detail page header — those are reached only from the list. The detail page's only state-mutating actions are the **header Refresh** button and the **close-order management** inside the Automation tab. To increase, withdraw, etc., the user goes back to the list (or navigates to the dedicated wizard pages directly).

---

## c) Add Position Menu

The **Add Position** button in the dashboard header opens a dropdown ([`CreatePositionDropdown`](../apps/midcurve-ui/src/components/positions/create-position-dropdown.tsx)) with **four** options. The first two and the fourth are also available from the empty state (option 3 is intentionally not in the empty state).

### Option 1 — Create New Position (wizard)

Navigates to [`/positions/create`](../apps/midcurve-ui/src/pages/CreatePositionPage.tsx) → [`CreatePositionWizard`](../apps/midcurve-ui/src/components/positions/wizard/create-position/uniswapv3/CreatePositionWizard.tsx). Steps:

1. **Pool Selection** — search a token-pair, see candidate pools sorted by APR/TVL/volume
2. **Position Config** — quote-token assignment, fee tier review
3. **Range** — interactive price-range picker
4. **Swap** — optional pre-deposit token swap to balance amounts
5. **Risk Triggers** — optional initial close-order configuration
6. **Summary** — review all settings
7. **Transaction** — approval(s) → mint NFT → register close order(s)
8. **Autowallet** — optional handoff so closes execute without user signing

This is **UniswapV3 NFT only** today — there is no parallel "Create Vault Position" wizard (vaults are deployed by an operator separately, then users *join* an existing vault via Option 3).

### Option 2 — Import NFT by ID

Inline form inside the dropdown (chain dropdown + NFT ID text input). Uses [`useImportPositionByNftId`](../apps/midcurve-ui/src/hooks/positions/uniswapv3/useImportPositionByNftId.ts) → `POST /api/v1/positions/uniswapv3/import`. Imports the on-chain NFT into the user's tracked set; the user does **not** need to own the NFT to track it (read-only watching is allowed).

### Option 3 — Import Tokenized Position by Address

Inline form inside the dropdown (chain dropdown + vault contract address input). Uses [`useImportVaultPosition`](../apps/midcurve-ui/src/hooks/positions/uniswapv3/vault/useImportVaultPosition.ts). The connected wallet is automatically used as the share-holder address — so the user must have a wallet connected and that wallet's share balance in the named vault is what gets tracked.

This is the only path to add a **vault share** position to the dashboard.

### Option 4 — Scan Wallet (modal)

Opens [`ScanPositionsModal`](../apps/midcurve-ui/src/components/positions/scan-positions-modal.tsx). Lets the user pick which production chains to scan (checkboxes, "select all" shortcut), then `POST /api/v1/positions/discover` for the connected wallet's address. Returns a result summary; new positions show up on the next list refetch. Currently scans **UniswapV3 NFT** positions only — vault scanning is separate (`POST /api/v1/positions/uniswapv3-vault/discover`) and not surfaced from this modal.

---

## Common UI features (apply to every position type)

- **Routing pattern**: `/positions/{protocol}/{...identity}` for detail; `/positions/{action}/{protocol}/{...identity}` for actions. URLs carry chain *slugs* (e.g. `arbitrum`), not numeric chain IDs.
- **Filters and sort** in URL search params (shareable, back-button-friendly).
- **Card layout**: header / metrics / right-side common actions / protocol-specific action row.
- **Common metrics block** (`PositionCardMetrics`): Current Value, PnL Curve sparkline slot, Total PnL, Unclaimed Fees, est. APR.
- **Right-side icon buttons**: View Details, Refresh, Three-dot menu (Reload History · Switch Quote Token · Delete Position).
- **Auto-refresh stack**: 60s on-chain refresh + 3s DB polling + 5s live pool-price patch — applies to both card and detail page.
- **Quote/base swap**: every quote-denominated metric flips when the user switches quote token; the underlying field is `isToken0Quote`.
- **Archive lifecycle**: archive when empty, unarchive any time; archived positions only show the Archive button.
- **Detail page skeleton**: 7-tab strip (Overview · PnL Analysis · APR Analysis · Conversion · Automation · Accounting · Technical Details), URL-driven active tab, shared header with Refresh.
- **Accounting tab is fully shared** (`PositionAccountingTab`) — protocol-agnostic.
- **Close orders UI**: SL/TP buttons in the card row, full close-order panel + 4-step wizard modal in the Automation tab, automation log feed.
- **Connected-wallet gating**: the action row collapses to "Archive only" when the connected wallet does not match the on-chain owner.

## Type-specific UI features

| Feature | UniswapV3 NFT | UniswapV3 Vault |
|---|---|---|
| Add-via-wizard | ✅ Full create wizard | ❌ (vaults are joined via Option 3) |
| Add-via-NFT-ID | ✅ | ❌ |
| Add-via-address | ❌ | ✅ (vault contract address + connected wallet as share owner) |
| Add-via-scan | ✅ (`/positions/discover`) | ❌ in this UI (separate endpoint exists) |
| Identifier on card | `#nftId` | Truncated vault address |
| Owner badge | NFT owner address | Share-owner address |
| `Burned` badge | ✅ when NFT burned | n/a |
| `Tokenized` badge | ❌ | ✅ |
| `XX.XX% Shares` badge | n/a | ✅ in detail header |
| **Burn NFT** action | ✅ when fully empty | n/a |
| **Tokenize** action | ✅ when has liquidity | n/a (already tokenized) |
| **Withdraw** | Liquidity → tokens | Shares → underlying liquidity |
| Liquidity check | `state.liquidity > 0` | `state.sharesBalance > 0` |
| Close-order contract | `UniswapV3PositionCloser` Diamond | `UniswapV3VaultPositionCloser` Diamond |
| SL/TP button components | `StopLossButton` / `TakeProfitButton` | `VaultStopLossButton` / `VaultTakeProfitButton` |
| Detail-page wrapper | `UniswapV3PositionDetail` | `UniswapV3VaultPositionDetail` |
| Per-tab components | `uniswapv3-{overview,history,apr,conversion,automation,technical}-tab.tsx` | `uniswapv3-vault-{overview,history,apr,conversion,automation,technical}-tab.tsx` |

The two implementations are deliberately parallel — same tab order, same metric headings, same detail-page skeleton — diverging only where the underlying primitive differs (NFT vs. ERC-20 share, on-chain owner vs. share-owner).

---

## Implementation checklist for a new position type

When introducing a new `protocol` discriminator (e.g. `aerodrome`, `orca-clmm`, `hyperliquid-perp`), the UI work below is required to bring it to feature parity with the existing two. File paths use `{proto}` as a placeholder for the new protocol's directory name (kebab-case, e.g. `aerodrome` or `hyperliquid-perp`).

### 1. Routing (in [`App.tsx`](../apps/midcurve-ui/src/App.tsx))
- [ ] Add `<Route path="/positions/{proto}/.../*" element={<{Proto}PositionDetailPage />}>`
- [ ] Add increase/withdraw/triggers routes mirroring the UniswapV3 set
- [ ] Update `parsePositionHash` in `@midcurve/shared` for the new protocol

### 2. Position Card (rendered by [`PositionList`](../apps/midcurve-ui/src/components/positions/position-list.tsx))
- [ ] Add the protocol value to `VALID_PROTOCOL_VALUES` and the protocol filter dropdown
- [ ] Add a `case '{proto}':` in the `parsePositionHash` switch returning the new card component
- [ ] Implement `{Proto}PositionCard` — fetches detail via the protocol's data hook, shows skeleton during load, renders the common header/metrics layout, and embeds the protocol-specific action row

### 3. Card sub-components (one each, under `components/positions/protocol/{proto}/`)
- [ ] `{proto}-position-card.tsx` (the entry point above)
- [ ] `{proto}-actions.tsx` (action button row — see [Action button rows](#action-button-rows))
- [ ] `{proto}-mini-pnl-curve.tsx` (sparkline used in the metrics slot and on the detail page)
- [ ] `{proto}-identifier.tsx` (the `#…` / `0x…` chip)
- [ ] `{proto}-chain-badge.tsx` (or reuse a shared one if chain semantics match)
- [ ] `{proto}-owner-badge.tsx` (or `{proto}-share-owner-badge.tsx` if applicable)
- [ ] `{proto}-range-status.tsx` (compact range badge for the card)
- [ ] `{proto}-range-status-line.tsx` (extended status line for the overview tab)

### 4. Card modals
- [ ] `{proto}-collect-fees-modal.tsx` + form
- [ ] `{proto}-delete-position-modal.tsx`
- [ ] `{proto}-reload-history-modal.tsx`
- [ ] `{proto}-switch-quote-token-modal.tsx`
- [ ] Lifecycle-cleanup modal if the protocol has one (e.g. NFT-style `Burn`)
- [ ] Tokenization / wrap modal if applicable

### 5. Detail page
- [ ] `{Proto}PositionDetailPage` page wrapper (parses URL params, fetches position, renders the detail component)
- [ ] `{Proto}PositionDetail` component with the seven-tab strip
- [ ] Per-tab components:
  - [ ] `{proto}-overview-tab.tsx` — three position-state cards + optional `PortfolioSimulator` integration
  - [ ] `{proto}-history-tab.tsx` — PnL breakdown + ledger event table (reuse the protocol-agnostic `PnLBreakdown` and `LedgerEventTable` if event shapes match)
  - [ ] `{proto}-apr-tab.tsx` — APR breakdown + periods table (`AprBreakdown` and `AprPeriodsTable` are reusable)
  - [ ] `{proto}-conversion-tab.tsx` — protocol-specific conversion summary + history (or omit if conversion is meaningless for the protocol)
  - [ ] `{proto}-automation-tab.tsx` — close-orders panel + automation logs
  - [ ] `{proto}-technical-tab.tsx` — raw config/state with explorer links
- [ ] **Accounting tab is shared** ([`PositionAccountingTab`](../apps/midcurve-ui/src/components/positions/accounting/position-accounting-tab.tsx)) — just wire up a `use{Proto}PositionAccounting` hook

### 6. Wizards
- [ ] Increase deposit wizard at `components/positions/wizard/increase-deposit/{proto}/` (4 steps: Configure → Swap → Transaction)
- [ ] Withdraw wizard at `wizard/withdraw/{proto}/`
- [ ] Risk triggers wizard at `wizard/risk-triggers/{proto}/`
- [ ] Page wrappers: `{Proto}IncreaseDepositPage`, `{Proto}WithdrawPage`, `{Proto}RiskTriggersPage`

### 7. Automation buttons & flows
- [ ] `{Proto}StopLossButton` and `{Proto}TakeProfitButton` (or reuse the existing ones if the close-order data shape is identical)
- [ ] `{Proto}CloseOrdersPanel` (or reuse `PositionCloseOrdersPanel` if the close-order shape matches)
- [ ] Wire `useSharedContract` to the new chain's deployed closer contract; gate disabled state with the same reasons (`burned`, `no liquidity`, `chain unsupported`)

### 8. Hooks (under `hooks/positions/{proto}/`)
- [ ] `use{Proto}Position(...)` — returns position detail; 3s DB polling
- [ ] `use{Proto}AutoRefresh(...)` — fires `/refresh` on mount + every 60s
- [ ] `use{Proto}LiveMetrics(position)` — patches live pool price every 5s
- [ ] `use{Proto}RefreshPosition` — manual refresh mutation
- [ ] `use{Proto}Ledger`, `use{Proto}AprPeriods`, `use{Proto}Conversion`, `use{Proto}PositionAccounting`
- [ ] `useImport{Proto}Position` (mutation) and `useDiscover{Proto}Positions` if scanning is supported

### 9. Add Position dropdown
- [ ] Decide which entry points the new protocol supports (wizard / import-by-id / import-by-address / scan)
- [ ] Add the option(s) to [`CreatePositionDropdown`](../apps/midcurve-ui/src/components/positions/create-position-dropdown.tsx)
- [ ] Add an entry to [`EmptyStateActions`](../apps/midcurve-ui/src/components/positions/empty-state-actions.tsx) for the most common option
- [ ] If scanning is supported, extend [`ScanPositionsModal`](../apps/midcurve-ui/src/components/positions/scan-positions-modal.tsx) (or add a parallel modal)

### 10. Per-protocol config
- [ ] Chain list under `config/protocols/{proto}/` (chain slug ↔ chain id mapping, contract addresses)
- [ ] Contract ABIs under `abis/` (NFT-manager-equivalent, vault-equivalent, etc.)

### 11. Visual & copy review
- [ ] Token logos resolve via the existing helper (CoinGecko / fallback)
- [ ] Range status semantics match the underlying primitive (some protocols don't have ranges — adapt or hide the range badges)
- [ ] All quote/base flips work; mini PnL curve renders correctly with `isToken0Quote = true` and `false`
- [ ] Action buttons collapse to Archive-only when the connected wallet is not the on-chain owner

---

## Out of scope — non-position UI pages

The pages below exist in the SPA but are **not** about positions and are deliberately omitted from this document. Each is listed here so a future doc can cover them.

| Page | Route | Purpose | Future doc |
|---|---|---|---|
| [`HomePage`](../apps/midcurve-ui/src/pages/HomePage.tsx) | `/` | Landing page, sign-in entry, marketing copy | `auth-and-onboarding.md` |
| [`SetupWizardPage`](../apps/midcurve-ui/src/pages/SetupWizardPage.tsx) | `/setup` (or auto-served when `configured == false`) | First-run admin wizard: WalletConnect project ID, operator address, allowlist | `auth-and-onboarding.md` |
| [`SystemConfigPage`](../apps/midcurve-ui/src/pages/SystemConfigPage.tsx) | `/system-config` | Admin: edit system config post-setup | `admin.md` |
| [`WalletManagementPage`](../apps/midcurve-ui/src/pages/WalletManagementPage.tsx) | `/wallets` | User-side: link/unlink wallets to the account, set primary wallet | `auth-and-onboarding.md` |
| [`ApiKeysPage`](../apps/midcurve-ui/src/pages/ApiKeysPage.tsx) | `/api-keys` | Create/revoke `mck_…` API keys for the MCP server and other clients | `mcp-and-api-keys.md` |
| [`NotificationsPage`](../apps/midcurve-ui/src/pages/NotificationsPage.tsx) | `/notifications` | In-app notification feed (range exits, close-order executions); webhook configuration | `notifications.md` |
| [Notification bell](../apps/midcurve-ui/src/components/notifications/notification-bell.tsx) | (header) | Compact unread-count badge on the dashboard header | `notifications.md` |
| [Accounting tab on dashboard](../apps/midcurve-ui/src/components/accounting/accounting-summary.tsx) | `/dashboard?tab=accounting` | Cross-position accounting summary (not the per-position Accounting tab — that one *is* covered here) | `accounting.md` |
| [`WizardExamplePage`](../apps/midcurve-ui/src/pages/WizardExamplePage.tsx) | `/wizard-example` | Internal example/playground for the wizard primitives | (developer-only, no user doc planned) |

The **swap** UI (under [`components/swap/`](../apps/midcurve-ui/src/components/swap/)) is also out of scope here — it is a standalone token-swap surface, not a position-management view.

---

## See also

- [positions.md](./positions.md) — Data model: position types, metric fields, ledger events, automation lifecycle
- [architecture.md](./architecture.md) — Monorepo layout, services, deployment
- [philosophy.md](./philosophy.md) — Quote/base paradigm, risk definition
- [`apps/midcurve-ui/CLAUDE.md`](../apps/midcurve-ui/CLAUDE.md) — UI tech stack, providers, query patterns
- [`.claude/rules/cursor-pointer.md`](../.claude/rules/cursor-pointer.md) — Every interactive element gets `cursor-pointer`
- [`.claude/rules/frontend-no-rpc.md`](../.claude/rules/frontend-no-rpc.md) — Why every blockchain read goes through the API, not wagmi
- [`.claude/rules/platform-agnostic-design.md`](../.claude/rules/platform-agnostic-design.md) — Why every protocol-specific file lives under a platform-named subdirectory
