# How to Implement a New Position Protocol

This guide describes the methodology for adding a new position protocol to Midcurve (e.g. a new AMM, a new vault family, a new derivatives venue). It is written for the team member who will own the integration end to end, from on-chain primitive to UI.

The methodology is **outside-in for the first three phases**: start from what the position *is*, then from what the user needs to *see and do*, and only afterwards build the data pipeline that feeds it. The order is deliberate — see [Background](#background) for why.

For the data model the integration plugs into, see [positions.md](./positions.md). For the UI surface, see [ui.md](./ui.md). For the system architecture, see [architecture.md](./architecture.md). For the philosophy that drives metric decisions, see [philosophy.md](./philosophy.md).

---

## Background

Adding a new position protocol is a vertical-stack change: it touches the on-chain reads, the ledger service, the journal-posting rule, the REST API, the MCP tools, and the UI. The temptation, when starting from a working integration of a similar protocol, is to clone its folder structure, rename, and adapt as you go. That works when two protocols genuinely share the same semantics — but breaks when they only look similar on the surface.

The friction points show up late and are expensive to fix:

- An unbalanced disposal entry surfaces in accounting tests after the journal-posting rule is already in production-ready shape.
- A REST endpoint turns out to be meaningless for the new protocol after the route, the service method, and the wire types have all been written.
- A refresh cache silently swallows user actions because it was tuned for one protocol's lifecycle and inherited unmodified by another.

In every case, the root cause is the same: a downstream decision was made before the upstream concept was nailed down. The folder structure inherited semantics that were never argued for; the metrics inherited definitions that didn't apply; the endpoints inherited shapes that the UI didn't need.

This guide exists to invert that order. The first three phases produce concept documents that gate the build phases. Phase 1 forces a written answer to "what is this position?", Phase 2 forces a written derivation rule for every metric, Phase 3 forces a written specification for every UI surface that will render it. Only when those three documents are in place — and only with them as inputs — do the data-layer phases begin.

---

## How to use this guide

The guide is structured as eight phases. Phases 1–3 produce **concept documents** that gate the build phases 4–8.

- **Phase 1** produces a one-page **Position Concept Document** answering "what is this position?".
- **Phase 2** produces a **Position Metric Specification** mapping every common metric to a derivation rule for this protocol, plus the type-specific metrics that fill the gaps.
- **Phase 3** produces a **Position UI Concept Document** filling the standard UI templates from [ui.md](./ui.md) and listing the backend requirements that follow.
- **Phases 4–8** are the build phases. Each consumes the concept documents above as inputs.

Two documents land in the repo per integration: this generic guide stays under `docs/how-to-implement-new-positions.md`, and the position-specific concept document lands at `docs/positions/<protocol>.md` (e.g. `docs/positions/uniswapv3-staking.md`).

This guide is a **living methodology**. Phases 1–3 are detailed; phases 4–8 are deliberately under-specified at first writing and will be filled in as we walk concrete retrospectives.

---

## Phase 1 — Position Concept

Three questions must be answered before any metric or UI decision. Together they define the position's vocabulary; everything downstream refers back to them.

### 1.1 Identity

- Which `protocol` discriminator? (lower-kebab-case, e.g. `uniswapv3-staking`)
- Which `type` discriminator from the existing union (`LP_CONCENTRATED`, `VAULT_SHARES`, ...) or a new value? Reusing a type implies that the **risk shape** matches; do not reuse a type just because the underlying primitive is similar.
- What is the `positionHash` format? (slash-separated, see [positions.md §Supported Position Types](./positions.md#supported-position-types) for the convention)
- What is the **owner model**? Three patterns exist today:
  - **Read-only watching** (NFT) — multiple users may track the same on-chain position; ownership is queried at read time.
  - **Owner-bound 1:1** (staking vault) — a single user owns a single contract clone; ownership is encoded on chain and immutable.
  - **Multi-user share-of-vault** (vault shares) — many users hold ERC-20-like shares of one underlying position; one Position row per (vault, holder) tuple.

### 1.2 Lifecycle

States that the position can be in *from the user's perspective*, distinct from on-chain storage states. NFT positions: `open` (`liquidity > 0`) → `closed` (`liquidity == 0` but reopenable) → `burned` (terminal). Staking vaults: `Empty` (clone exists, never staked) → `Staked` → `Settled` (terminal for new ops, but `unstake`/`claim` still callable to drain buffers). Each transition needs to map to one or more on-chain events.

Two questions to nail down here:

- Which transitions are **owner-initiated** vs. **permissionless** vs. **automatic** (chain-driven)?
- Which transitions are **reversible**? (NFT: `closed → open` is normal. Staking: `Staked → Settled` is one-way.)

### 1.3 Economic invariant

This is the question that the staking vault retrospective showed is most often missed. State, in one or two paragraphs:

- What does the position *do* economically? What is the user's exposure?
- What is **invariant** about it (i.e. true in every observable state) versus **emergent** (depending on market conditions)?
- Where does the **yield** come from, and what is its mechanism?
- Where does the **risk** come from, and at which points does it crystallize?

For NFT positions: the user provides token0 and token1; the AMM rebalances continuously while price is in range; fees accrue to the position; range exit halts fee accrual; recovery is path-dependent. There is no invariant on token amounts.

For staking vaults: the user provides token0 and token1; the vault stakes them in a UV3 NFT; an executor calling `swap()` restores the original `(B, Q)` token amounts and pays a yield surplus on top. The token-conservation invariant holds while `swap()` is reachable (Cases 1–3); it breaks if the vault becomes Underwater (Case 4), where only `flashClose()` exits with realized loss.

The ask here is not to be poetic; it is to write down the property that lets you decide whether two positions of the same family have the same risk profile. If the answer is "the staking vault is just an NFT with a wrapper", the integration will inherit NFT-shaped metrics whether it should or not.

### Output

A one-page document at `docs/positions/<protocol>.md` titled "What is a `<protocol>` position?" with three sections matching 1.1–1.3. This is the north star for phases 2 and 3.

---

## Phase 2 — Metric Methodology

Every metric on a Midcurve position has a derivation rule. This phase produces the table of rules, drawing the common metrics from [positions.md §Common Metric Fields](./positions.md#common-metric-fields) and adding the type-specific gaps.

### 2.1 Common metric mapping

The common metric catalog is fixed (see [positions.md](./positions.md#common-metric-fields)). For each row, a new protocol must specify:

| Question | Why it matters |
|---|---|
| What does this field **mean** for this position? | Some fields are degenerate. `realizedCashflow` is `0` for AMM LPs but non-zero for perps. `priceRangeLower/Upper` may not be meaningful at all (lending positions have no range). |
| Which **on-chain reads** populate it? | Names the contract calls and the block at which they are read. |
| What is the **unit and quote-side mapping**? | All values are quote-token bigints. The decomposition `base × poolPrice + quote` needs to use the right `isToken0Quote`. |
| Is it **derived from the ledger** or **read live from chain**? | `costBasis`, `realizedPnl`, `collectedYield`, `realizedCashflow`: ledger. `currentValue`, `unclaimedYield`, `unrealizedCashflow`: live. APR fields: aggregated from ledger periods. |

Two pitfalls to call out explicitly:

- **`priceRangeLower/Upper` is semantic, not literal.** For a staking vault, the range is not the wrapped NFT's `[tickLower, tickUpper]` — it is the price band in which `swap()` is executable in Case 1. These are two different things; the latter is what the user cares about.
- **`currentValue` requires a definition.** For an NFT it is "what would I get if I closed the position at the current pool price + collected fees". For a staking vault it is a different question entirely: is it the swap-now amount, the unstake-now amount (which equals the original deposit if not Underwater), or the unstake-buffer + reward-buffer + unrealized-quote-value of remaining staked liquidity? The choice has to be argued, not assumed.

### 2.2 Type-specific metrics

The common catalog is a floor, not a ceiling. Every protocol has metrics that determine **success** or **state** that don't fit the common slots. These go into the typed `state` JSON.

The right test for whether a metric belongs in `state`: ask whether the UI needs it to render a badge, gate an action, or label a status. If yes, it belongs in `state`. If it is purely an implementation detail of how `currentValue` is computed, it does not.

Examples from the staking vault:

- `vaultState` (`Empty` / `Staked` / `Settled`) — drives the lifecycle badge in the card.
- `swapStatus` (`NoSwapNeeded` / `Executable` / `Underwater`) — drives a health indicator that has no analog in the NFT card.
- `pendingBps` and `effectiveBps` — drive a "partial unstake pending" indicator.
- `yieldTargetCoverage` (≈ `currentQuoteValue / (Q + T)`) — drives a "distance from underwater" health metric.

Internal accumulators of the wrapped primitive (the NFT's `liquidity`, `feeGrowthInside0LastX128`, `tickLower`/`Upper`, etc.) are *not* type-specific metrics for the staking vault. They are implementation details of the position service's internals. If the UI doesn't read them, they don't go in `state`.

### 2.3 PnL decomposition

The four-component decomposition is fixed (`realizedPnl` / `realizedCashflow` / `collectedYield` / unrealized-trio). For the new protocol:

- Which on-chain event triggers a write to which delta field?
- Where is the line between "Capital Returned" (account 3100) and "Realized Gain" (account 4100)? This is decided by the **principal anchor** for the position. For NFT positions, principal is what was deposited, so any positive disposal value above proportional cost basis is gain. For staking vaults, principal is `(stakedBase, stakedQuote)`, and the yield-target share `T × bps / 10000` is income, not gain — booked to `Fee Income` (account 4000), independent of the gain/loss check.
- Is the protocol **Model A** (yield ∉ pnl, booked as income) or **Model B** (yield rolled into pnl)? Default is Model A; deviating requires a written argument.

### 2.4 Computation as code

Once 2.1–2.3 are settled, lock the derivation rules in TypeScript so the spec and the implementation stay in sync. Convention:

- New folder `packages/midcurve-shared/src/metrics/<protocol>/`.
- Two files: `common-metrics.ts` (one function per common metric from 2.1) and `specific-metrics.ts` (one function per type-specific metric from 2.2).
- Each metric is a `compute<MetricName>()` function. Function signatures are deliberately *not* fixed — even for common metrics where the metric name matches across protocols. Different protocols may need different inputs (live chain reads vs. ledger aggregates vs. config snapshots), and the convention's value is in the *naming*, not the call shape.
- **`compute*` functions are pure.** All inputs come in as arguments; the output is deterministic. No RPC reads, no database queries, no API calls, no file-system access, no clock or randomness, no global state, no argument mutation. I/O lives in the service layer that *calls* `compute*` — the function itself only computes.
- The purity rule means metric correctness is testable without mocks: a unit test against `computeXyz()` is a few lines, fully reproducible, and isolates any bug in the math from any bug in the data plumbing.

The point is to have a single source of truth for *how* a metric is computed. Service code, tests, and review can all reference these functions by name; the tables in 2.1/2.2 say *what* gets computed, the file in `metrics/<protocol>/` says *how*.

### Output

Two artefacts. **Documentation:** a section appended to `docs/positions/<protocol>.md` with two tables — one for the common metric mapping (one row per common field, four columns matching the questions in 2.1), one for the type-specific metrics (name, semantics, on-chain source, UI consumer). **Code:** the `packages/midcurve-shared/src/metrics/<protocol>/` folder with `common-metrics.ts` and `specific-metrics.ts` per 2.4.

---

## Phase 3 — UI Surface

The UI defines the **observable contract** of the position. If the UI cannot render a fact, that fact does not need to leave the data layer; if the UI must render a fact, the data layer must produce it. Phase 3 turns the [ui.md](./ui.md) standard templates into a concrete specification for the new protocol — and as a byproduct, surfaces the backend requirements that drive phases 4–7.

This phase does *not* repeat the [ui.md "Implementation checklist for a new position type"](./ui.md#implementation-checklist-for-a-new-position-type). That checklist is the *build instruction*; phase 3 produces its *input*.

### 3.1 Card layout slots

The per-card layout in [ui.md §Per-card layout](./ui.md#per-card-layout) has fixed slots. Walk each one and answer:

- **Header status badges.** Which badges from the standard set apply (`Burned`, `In Range`, `Out of Range`, `Closed`)? Which are reinterpreted (`In Range` for staking might mean `swap()` is in Case 1, which is a different condition than NFT range membership)? Which new badges are needed (e.g. `Underwater`, `Pending Partial`, `Settled`)?
- **Header protocol-line badges.** Chain badge stays; which identifier replaces `#nftId` or the truncated vault address (e.g. clone address with NFT-id sub-line)? Which owner badge variant?
- **Metrics block.** Are the five standard slots (`Current Value`, `PnL Curve`, `Total PnL`, `Unclaimed Fees`, `est. APR`) all meaningful? If a slot is degenerate, what replaces it? `Unclaimed Fees` for a staking vault has no analog in `tokensOwed` form — it is the reward-buffer state plus the prospective yield at the current `swap()` quote.
- **Right-side common buttons.** `View Details` and `Refresh` always apply. The 3-dot menu has three default items (`Reload History`, `Switch Quote Token`, `Delete Position`); decide which apply. `Switch Quote Token` is *not applicable* for the staking vault because `isToken0Quote` is on-chain immutable.
- **Bottom action row.** This is the most variable part. List every button, its label, its visibility condition (which `state` fields decide whether it is shown / disabled / hidden), and its target (modal? dedicated wizard page? inline action?).

### 3.2 Detail page tabs

The detail page has seven canonical tabs (see [ui.md §Tabs](./ui.md#tabs-common-to-both-types)). For each:

- Does the tab apply, with what content?
- Is the tab semantically replaced (same slot, different content)?
- Is the tab dropped entirely?

Three categories of decisions, applied to each of the seven tabs:

- **Applies as-is.** Protocol events and metrics fit the tab's existing template; backend reuses the endpoint shape, only the wire-type discriminator changes.
- **Reinterpreted.** The slot is meaningful but content is computed differently — e.g. an APR tab whose periods bracket on a different ledger event than the default. Backend exposes the same endpoint path with protocol-specific aggregation logic.
- **Dropped.** The tab's premise does not apply — e.g. a Conversion tab that reconstructs AMM token-amount drift on a protocol where token amounts are conserved by construction. The corresponding endpoint is not implemented; document the omission so future readers understand the gap is deliberate.

Tab decisions feed directly into the REST endpoint catalog in phase 7. If a tab is dropped, the endpoint that fed it is dropped. If a tab is reinterpreted, the endpoint is replaced or extended.

### 3.3 Add-position flow

[ui.md §Add Position Menu](./ui.md#c-add-position-menu) lists four canonical entry points: Create Wizard, Import by NFT ID, Import by Address, Scan Wallet. Decide which apply, with what flow:

- **Create Wizard** — does the protocol support user-driven creation? What are the steps? For the staking vault: pool selection → range → yield target → initial deposit amount → factory call (deploys clone + stakes atomically). The wizard's transaction step composes both `factory.createVault()` and the initial `stake()` in a single user signature.
- **Import by ID / by address** — what is the natural identifier? For the staking vault: vault address.
- **Scan Wallet** — does it apply? For the staking vault: yes, by querying the factory's `VaultCreated(owner indexed, vault indexed)` for the connected wallet.

Each supported flow produces requirements for phase 7 (an endpoint per flow) and phase 4 (an event-source-of-truth for the discovery scan).

### 3.4 Backend requirements derived

The output of 3.1–3.3 is a list of requirements for the lower phases. Concretely:

- **`state` field list** — every fact the UI conditions on. Becomes the `state` JSON shape consumed in phases 2 and 4.
- **Endpoint list** — every read or write the UI invokes. Becomes the route list in phase 7.
- **Wizard flows** — every multi-step interaction. Drives both API endpoints and the wizard UI components. Out of scope for the data layer but in scope for the route list.
- **Action conditional gating** — every button visibility rule. Each rule needs to be encodable from `state` alone; if it requires a fresh on-chain read at click time, the read becomes a service method.

### Output

A document at `docs/positions/<protocol>.md` (UI section) with four sub-sections matching 3.1–3.4. This document is the input to phases 4–7.

---

## Phase 4 — Onchain data pipeline

*This phase will be detailed as we walk concrete retrospectives.* In skeleton form:

- Event taxonomy: which on-chain events map to which `EventType` values (`STAKING_DEPOSIT`, `STAKING_DISPOSE`, etc.)? Which events are *markers* (no financial impact)?
- Ledger event mapping: per `EventType`, which delta fields are written, what goes into the `config` JSON, and how is `tokenValue` computed?
- Chain-context reads: chain-from-previous (default for sequential events) vs. RPC anchor (only for genesis or unbacked first reads). See the SPEC-0003b PR2 discussion in issue #63 for the canonical pattern.
- Reorg handling: `deleteAllByBlockHash` cascade, revert event publishing.
- Domain events on the `position-liquidity-events` exchange: routing key conventions, payload shapes.

## Phase 5 — Service topology

*To be detailed.* In skeleton form: `LedgerService` (canonical reference: `UniswapV3LedgerService`), `PositionService` (closer reference: `UniswapV3VaultPositionService` for clone-shaped protocols, `UniswapV3PositionService` for tracked-NFT protocols), optional `AprService` if period-bracketing logic diverges from the NFT default.

## Phase 6 — Accounting / business-logic rule

*To be detailed.* In skeleton form: lot token identity (synthetic share token), Chart of Accounts mapping under [philosophy.md](./philosophy.md)'s Model A, disposal logic with proportional cost basis allocation, FX adjustment.

## Phase 7 — REST API

*To be detailed.* In skeleton form: the canonical endpoint catalog from [positions.md §Manual Actions](./positions.md#manual-actions) is the starting menu; phase 3.4 has already pruned and extended it. Wire types under `@midcurve/api-shared` mirror the existing position-typed responses.

## Phase 8 — MCP server tools

*To be detailed.* In skeleton form: read-only tools (`list_<proto>_positions`, `get_<proto>_position`, `get_<proto>_apr`, `get_<proto>_accounting`); reuse `simulate_position_at_price` and `generate_position_pnl_curve` if the protocol's domain class implements `simulatePnLAtPrice`.

---

## Common pitfalls

These are anti-goals. If you find yourself doing one of these, stop and reread phase 1.

- **Mirror-shaped integration.** Cloning an existing protocol's folder structure and renaming. The folder structure is downstream of the metric structure, which is downstream of the position's economic invariant. If you skip the upstream phases, you inherit semantics that may not apply.
- **Treating internal accumulators as state.** Storage slots of an underlying primitive are implementation details of how metrics are computed. They do not belong in `state` unless the UI reads them.
- **Building endpoints before the UI concept exists.** The endpoint catalog *is* the UI concept's contract. Specifying endpoints first creates pressure to keep them when the UI later finds them irrelevant.
- **Adding a refresh cache before the lifecycle is mapped.** Caches that are blind to lifecycle transitions silently break user actions. Cache by block number, not by wall-clock.
- **Deferring accounting-line decisions to the journal-posting rule.** Decisions about which proceeds component is principal vs. income vs. gain belong in phase 2.3 (PnL decomposition). Pushing them down causes balance bugs that surface only in test.

---

## See also

- [positions.md](./positions.md) — Common metric catalog, type-specific metric examples, ledger event taxonomy, automation lifecycle
- [ui.md](./ui.md) — UI templates: card layout, detail page tabs, add-position flows, implementation checklist
- [philosophy.md](./philosophy.md) — Quote/base paradigm, risk definition, Model A/B argument
- [architecture.md](./architecture.md) — Monorepo layout, services, deployment
- [`packages/midcurve-shared/src/types/position/`](../packages/midcurve-shared/src/types/position/) — Authoritative position type definitions
- [`packages/midcurve-database/prisma/schema.prisma`](../packages/midcurve-database/prisma/schema.prisma) — Position model and ledger event enums
