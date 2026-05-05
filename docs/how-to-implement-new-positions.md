# How to Implement a New Position Protocol

This guide describes the methodology for adding a new position protocol to Midcurve (e.g. a new AMM, a new vault family, a new derivatives venue). It is written for the team member who will own the integration end to end, from on-chain primitive to UI.

The methodology is **outside-in for the first four phases**: start from what the position *is*, then from what the user needs to *see and do*, then from how the position is *automated*, and only afterwards build the data pipeline that feeds it. The order is deliberate — see [Background](#background) for why.

For the data model the integration plugs into, see [positions.md](./positions.md). For the UI surface, see [ui.md](./ui.md). For the system architecture, see [architecture.md](./architecture.md). For the philosophy that drives metric decisions, see [philosophy.md](./philosophy.md).

---

## Background

Adding a new position protocol is a vertical-stack change: it touches the on-chain reads, the ledger service, the journal-posting rule, the REST API, the MCP tools, and the UI. The temptation, when starting from a working integration of a similar protocol, is to clone its folder structure, rename, and adapt as you go. That works when two protocols genuinely share the same semantics — but breaks when they only look similar on the surface.

The friction points show up late and are expensive to fix:

- An unbalanced disposal entry surfaces in accounting tests after the journal-posting rule is already in production-ready shape.
- A REST endpoint turns out to be meaningless for the new protocol after the route, the service method, and the wire types have all been written.
- A refresh cache silently swallows user actions because it was tuned for one protocol's lifecycle and inherited unmodified by another.

In every case, the root cause is the same: a downstream decision was made before the upstream concept was nailed down. The folder structure inherited semantics that were never argued for; the metrics inherited definitions that didn't apply; the endpoints inherited shapes that the UI didn't need.

This guide exists to invert that order. The first four phases produce concept documents that gate the build phases. Phase 1 forces a written answer to "what is this position?", Phase 2 forces a written derivation rule for every metric, Phase 3 forces a written specification for every UI surface that will render it, Phase 4 forces an explicit account of what automates the position and how the owner controls it. Only when those four documents are in place — and only with them as inputs — do the data-layer phases begin.

---

## How to use this guide

The guide is structured as nine phases. Phases 1–4 produce **concept documents** that gate the build phases 5–9.

- **Phase 1** produces a one-page **Position Concept Document** answering "what is this position?".
- **Phase 2** produces a **Position Metric Specification** mapping every common metric to a derivation rule for this protocol, plus the type-specific metrics that fill the gaps.
- **Phase 3** produces a **Position UI Concept Document** filling the standard UI templates from [ui.md](./ui.md) and listing the backend requirements that follow.
- **Phase 4** produces a **Position Automation Surface Document** classifying the position's automation needs, owner controls, and off-chain components.
- **Phases 5–9** are the build phases. Each consumes the concept documents above as inputs.

Two documents land in the repo per integration: this generic guide stays under `docs/how-to-implement-new-positions.md`, and the position-specific concept document lands at `docs/positions/<protocol>.md` (e.g. `docs/positions/uniswapv3-staking.md`).

This guide is a **living methodology**. Phases 1–4 are detailed; phases 5–9 are deliberately under-specified at first writing and will be filled in as we walk concrete retrospectives.

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

A one-page document at `docs/positions/<protocol>.md` titled "What is a `<protocol>` position?" with three sections matching 1.1–1.3. This is the north star for phases 2, 3, and 4.

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

### 2.4 Domain events

Ledger events trigger downstream consumers (journal-posting rule, reconciliation rule, APR service, notifications) via domain events on the `position-liquidity-events` exchange. The question to answer here is whether the existing event family suffices or whether the new protocol needs new routing keys, payload extensions, or a dedicated exchange.

Default answer: the existing infrastructure suffices. Routing keys follow the convention `position.liquidity.<protocol>.<eventType>`, and consumers filter by topic — adding a new protocol means adding a new `<protocol>` segment to the routing key, not a new exchange. The payload shape (positionId, eventId, eventType, blockNumber, txHash, plus event-specific `config`) generalises across protocols.

A new protocol needs to deviate only when one of the following holds: it produces an event that has no analog in the existing taxonomy and demands a payload field outside the `config` envelope; it requires a different delivery guarantee (e.g. ordered per-vault delivery vs. unordered per-position); or it introduces a new consumer that cannot be satisfied by adding a topic subscription to the existing exchange. None of these is common.

Decide here, not in phase 5 or 7. Phase 7 (accounting rule) presupposes that domain events exist and have a known shape; deferring this decision causes the phase-7 work to either invent an ad-hoc shape or block on retroactive guide updates. If the answer is "reuse existing", say so explicitly in the spec section; if "new", specify the routing key family and any payload deltas.

### 2.5 Computation as code

Once 2.1–2.4 are settled, lock the derivation rules in TypeScript so the spec and the implementation stay in sync. Convention:

- New folder `packages/midcurve-shared/src/metrics/<protocol>/`.
- Two files: `common-metrics.ts` (one function per common metric from 2.1) and `specific-metrics.ts` (one function per type-specific metric from 2.2).
- Each metric is a `compute<MetricName>()` function. Function signatures are deliberately *not* fixed — even for common metrics where the metric name matches across protocols. Different protocols may need different inputs (live chain reads vs. ledger aggregates vs. config snapshots), and the convention's value is in the *naming*, not the call shape.
- **`compute*` functions are pure.** All inputs come in as arguments; the output is deterministic. No RPC reads, no database queries, no API calls, no file-system access, no clock or randomness, no global state, no argument mutation. I/O lives in the service layer that *calls* `compute*` — the function itself only computes.
- The purity rule means metric correctness is testable without mocks: a unit test against `computeXyz()` is a few lines, fully reproducible, and isolates any bug in the math from any bug in the data plumbing.

The point is to have a single source of truth for *how* a metric is computed. Service code, tests, and review can all reference these functions by name; the tables in 2.1/2.2 say *what* gets computed, the file in `metrics/<protocol>/` says *how*.

### Output

Two artefacts. **Documentation:** a section appended to `docs/positions/<protocol>.md` with two tables — one for the common metric mapping (one row per common field, four columns matching the questions in 2.1), one for the type-specific metrics (name, semantics, on-chain source, UI consumer), plus the domain-event decision from 2.4. **Code:** the `packages/midcurve-shared/src/metrics/<protocol>/` folder with `common-metrics.ts` and `specific-metrics.ts` per 2.5.

---

## Phase 3 — UI Surface

The UI defines the **observable contract** of the position. If the UI cannot render a fact, that fact does not need to leave the data layer; if the UI must render a fact, the data layer must produce it. Phase 3 turns the [ui.md](./ui.md) standard templates into a concrete specification for the new protocol — and as a byproduct, surfaces the backend requirements that drive phases 5–8.

This phase does *not* repeat the [ui.md "Implementation checklist for a new position type"](./ui.md#implementation-checklist-for-a-new-position-type). That checklist is the *build instruction*; phase 3 produces its *input*.

The automation-related parts of the UI (the automation tab in 3.2; automation-related buttons in 3.1's bottom action row) are a first pass here and may be revisited in phase 4 once the automation surface is fully specified. Where 3.1 or 3.2 leaves automation slots open, mark them as such and complete them after phase 4.

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

Tab decisions feed directly into the REST endpoint catalog in phase 8. If a tab is dropped, the endpoint that fed it is dropped. If a tab is reinterpreted, the endpoint is replaced or extended.

### 3.3 Add-position flow

[ui.md §Add Position Menu](./ui.md#c-add-position-menu) lists four canonical entry points: Create Wizard, Import by NFT ID, Import by Address, Scan Wallet. Decide which apply, with what flow:

- **Create Wizard** — does the protocol support user-driven creation? What are the steps? For the staking vault: pool selection → range → yield target → initial deposit amount → factory call (deploys clone + stakes atomically). The wizard's transaction step composes both `factory.createVault()` and the initial `stake()` in a single user signature.
- **Import by ID / by address** — what is the natural identifier? For the staking vault: vault address.
- **Scan Wallet** — does it apply? For the staking vault: yes, by querying the factory's `VaultCreated(owner indexed, vault indexed)` for the connected wallet.

Each supported flow produces requirements for phase 8 (an endpoint per flow) and phase 5 (an event-source-of-truth for the discovery scan).

### 3.4 Backend requirements derived

The output of 3.1–3.3 is a list of requirements for the lower phases. Concretely:

- **`state` field list** — every fact the UI conditions on. Becomes the `state` JSON shape consumed in phases 2 and 5.
- **Endpoint list** — every read or write the UI invokes. Becomes the route list in phase 8.
- **Wizard flows** — every multi-step interaction. Drives both API endpoints and the wizard UI components. Out of scope for the data layer but in scope for the route list.
- **Action conditional gating** — every button visibility rule. Each rule needs to be encodable from `state` alone; if it requires a fresh on-chain read at click time, the read becomes a service method.

### Output

A document at `docs/positions/<protocol>.md` (UI section) with four sub-sections matching 3.1–3.4. This document, together with the phase-4 automation surface, is the input to phases 5–8.

---

## Phase 4 — Automation Surface

A position rarely runs purely on owner-initiated transactions. Concentrated-liquidity positions reach for stop-losses; staking vaults wait for executors to call `swap()`; lending positions face liquidation by external bots; perps support a multi-typed order surface (SL, TP, Stop-Limit, Take-Limit, Take-Market, possibly trailing). Each of these is automation, with its own requirements, owner controls, and off-chain pieces.

Phase 4 makes the automation surface explicit, before the build phases assume one. The questions below partition the space the same way phases 1-3 partition identity, metrics, and UI: state what the automation is for, who controls it, and what off-chain machinery it requires. The output feeds phase 5 (pipeline) and phase 8 (REST), and reinterprets the automation slot in phase 3 (UI).

### 4.1 Automation requirements

What automation must run for the position to function — and what is optional convenience? Three classes:

- **Constitutive.** The position does not function without this automation. Example: the staking vault relies on external executors calling `swap()`; with no executors watching, the vault collects fees but never settles. Constitutive automation is part of the position's economic invariant (phase 1.3) and must be explicitly designed, not assumed.
- **Optional, owner-elected.** The position functions without it; the owner can opt in. Example: a UV3 NFT works without close orders; the owner can register a stop-loss / take-profit on the closer Diamond. Phase 1's lifecycle is unchanged whether the owner opts in or not.
- **Externalised.** Automation exists, but lives outside the Midcurve integration. Example: liquidation on a lending position is performed by external keepers Midcurve does not run. Document the existence and the integration's posture (do we surface the risk, do we display the liquidation history, do we offer self-liquidation tooling), but no automation engineering is owned by Midcurve.

The classification matters because it determines what phase 5 must build, what phase 3 must surface, and what risks (phase 1.3) the user actually carries.

### 4.2 Owner controls

For automation classified as constitutive or optional in 4.1, what levers does the owner have over it?

- **Trigger types available.** Static price-thresholds (NFT close orders), dynamic conditions tied to position state (vault yield-target as the implicit settlement trigger), time-bounded triggers (orders with expiry), conditional on external state (oracle thresholds, gas-price ceilings).
- **Trigger composition.** Can multiple triggers coexist on one position? Are they alternative (first-to-fire wins) or combined (all must fire)? NFT close orders today: one SL plus one TP, alternative. Perp-style protocols: often multiple TP layers plus one SL.
- **State controls.** Pause, resume, cancel, modify in place, replace. NFT close orders today: cancel + recreate (no in-place modify). For constitutive automation, "pause" may not be available at all — the staking vault cannot pause `swap()` callability without breaking its mechanism.
- **Visibility.** Does the owner see automation activity (logs, attempts, failures)? Does the user see automation activity from third parties (which executor settled their vault)? This drives the automation-tab content in phase 3.

The reasonable default for new protocols: minimal controls. Add levers only when there is a clear user need; do not import the full perp-style surface for a position type that has one trigger.

### 4.3 Off-chain components

What off-chain machinery does the automation require, and where does it live?

- **In-house, Midcurve-operated.** Workers that listen for triggers, build transactions, and submit on behalf of the user. Examples today: the automation worker that watches close orders, the operator EOA that submits transactions, the gas-refuel rule. New protocols typically add a new worker rule (NFT close orders → vault close orders → ...).
- **External, Midcurve-integrated.** Third-party infrastructure the integration registers with or reads from. Examples: registering the position as a standing intent on a solver network (CoW), reading oracle feeds, subscribing to subgraph webhooks. The integration owns the registration and refresh; the third party owns the execution.
- **External, observed only.** Infrastructure Midcurve does not interact with directly but whose effects show up on chain. Example: third-party liquidator bots on lending markets — Midcurve sees the resulting events and reflects them in the position state.

Each in-house component becomes a phase-5 service (or extends an existing one). Each Midcurve-integrated component becomes a phase-5 + phase-8 surface (a service that does the registration, an endpoint the UI calls to manage it). Each observed-only component is a phase-5 indexer concern, not an automation concern in the build sense.

### 4.4 Backend requirements derived

Same shape as 3.4. The output of 4.1-4.3 produces:

- **Service additions.** New worker rules, new registration services, extensions of existing services.
- **Endpoint list.** Owner-control endpoints (pause, resume, cancel, modify, add-trigger), status endpoints (is the position registered with the external service, when did the last automation attempt fire, what was the result).
- **State field additions.** Whatever the UI needs to render automation status — pending registrations, last-attempt timestamps, failure reasons. These extend the type-specific `state` from phase 2.2.
- **UI reinterpretation.** Phase 3.2's automation-tab content is rewritten in light of 4.1-4.3. Phase 3.1's bottom-action-row may need automation buttons (or may need to lose them, if the protocol's automation is constitutive and not owner-controllable).

### Output

A section appended to `docs/positions/<protocol>.md` with four sub-sections matching 4.1-4.4. Plus, where 4.4 introduces UI changes, a back-edit on the phase 3 sections of the same document. The complete Phase 1-4 document is the input to phases 5-9.

---

## Phase 5 — Onchain data pipeline

*This phase will be detailed as we walk concrete retrospectives.* In skeleton form:

- Event taxonomy: which on-chain events map to which `EventType` values (`STAKING_DEPOSIT`, `STAKING_DISPOSE`, etc.)? Which events are *markers* (no financial impact)?
- Ledger event mapping: per `EventType`, which delta fields are written, what goes into the `config` JSON, and how is `tokenValue` computed?
- Chain-context reads: chain-from-previous (default for sequential events) vs. RPC anchor (only for genesis or unbacked first reads). See the SPEC-0003b PR2 discussion in issue #63 for the canonical pattern.
- Reorg handling: `deleteAllByBlockHash` cascade, revert event publishing.
- Domain-event publishing mechanics: routing-key construction (per phase 2.4 decision), payload assembly, retry/redelivery semantics.
- Automation pipeline integration: workers and registrations from phase 4.3 plug in here.

## Phase 6 — Service topology

*To be detailed.* In skeleton form: `LedgerService` (canonical reference: `UniswapV3LedgerService`), `PositionService` (closer reference: `UniswapV3VaultPositionService` for clone-shaped protocols, `UniswapV3PositionService` for tracked-NFT protocols), optional `AprService` if period-bracketing logic diverges from the NFT default. Automation services from phase 4.3 also slot in here.

## Phase 7 — Accounting / business-logic rule

*To be detailed.* In skeleton form: lot token identity (synthetic share token), Chart of Accounts mapping under [philosophy.md](./philosophy.md)'s Model A, disposal logic with proportional cost basis allocation, FX adjustment.

## Phase 8 — REST API

*To be detailed.* In skeleton form: the canonical endpoint catalog from [positions.md §Manual Actions](./positions.md#manual-actions) is the starting menu; phases 3.4 and 4.4 have already pruned and extended it. Wire types under `@midcurve/api-shared` mirror the existing position-typed responses.

## Phase 9 — MCP server tools

*To be detailed.* In skeleton form: read-only tools (`list_<proto>_positions`, `get_<proto>_position`, `get_<proto>_apr`, `get_<proto>_accounting`); reuse `simulate_position_at_price` and `generate_position_pnl_curve` if the protocol's domain class implements `simulatePnLAtPrice`.

---

## Common pitfalls

These are anti-goals. If you find yourself doing one of these, stop and reread phase 1.

- **Mirror-shaped integration.** Cloning an existing protocol's folder structure and renaming. The folder structure is downstream of the metric structure, which is downstream of the position's economic invariant. If you skip the upstream phases, you inherit semantics that may not apply.
- **Treating internal accumulators as state.** Storage slots of an underlying primitive are implementation details of how metrics are computed. They do not belong in `state` unless the UI reads them.
- **Building endpoints before the UI concept exists.** The endpoint catalog *is* the UI concept's contract. Specifying endpoints first creates pressure to keep them when the UI later finds them irrelevant.
- **Adding a refresh cache before the lifecycle is mapped.** Caches that are blind to lifecycle transitions silently break user actions. Cache by block number, not by wall-clock.
- **Deferring accounting-line decisions to the journal-posting rule.** Decisions about which proceeds component is principal vs. income vs. gain belong in phase 2.3 (PnL decomposition). Pushing them down causes balance bugs that surface only in test.
- **Deferring the domain-event decision to phase 5 or 7.** The shape and routing of domain events is a phase-2 concept question, not a phase-5 wiring question. Phase 7 (accounting rule) presupposes a known event shape; deferring forces ad-hoc shapes or retroactive guide updates.
- **Treating automation as a phase-3 UI checkbox.** Whether the position is automated, by whom, with what owner controls, is a concept-level question (phase 4) that produces UI requirements as a byproduct — not the other way around. Designing automation as "what buttons should the action row have" misses constitutive automation entirely (the staking vault's `swap()` callability is not a button) and inflates optional automation into UI clutter.

---

## See also

- [positions.md](./positions.md) — Common metric catalog, type-specific metric examples, ledger event taxonomy, automation lifecycle
- [ui.md](./ui.md) — UI templates: card layout, detail page tabs, add-position flows, implementation checklist
- [philosophy.md](./philosophy.md) — Quote/base paradigm, risk definition, Model A/B argument
- [architecture.md](./architecture.md) — Monorepo layout, services, deployment
- [`packages/midcurve-shared/src/types/position/`](../packages/midcurve-shared/src/types/position/) — Authoritative position type definitions
- [`packages/midcurve-database/prisma/schema.prisma`](../packages/midcurve-database/prisma/schema.prisma) — Position model and ledger event enums
