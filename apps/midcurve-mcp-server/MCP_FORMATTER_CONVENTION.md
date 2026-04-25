# Midcurve MCP Formatter Convention

> Status: living document.
> Scope: `apps/midcurve-mcp-server/src/formatters.ts` and every new MCP tool formatter.
> Audience: humans and coding agents adding/modifying MCP tool outputs.

## 1. Why this document exists

The MCP server is Midcurve's **math and state layer**. It owns protocol mathematics
(V3 liquidity, tick conversions, decimals), it owns the canonical view of user state
(positions, pools, on-chain reads), and it exposes both through tools that LLM-driven
agents call. The agent **orchestrates**; it does not do V3 math, decimal arithmetic,
or sqrt manipulations — LLMs are unreliable at those tasks, and duplicating math in
prompt logic undermines the canonical implementation in this repo.

Two consequences shape every formatter:

1. Tool outputs must be **safe to feed into further tool calls without precision loss**.
   A `priceRangeLower` value extracted from one tool's output may legitimately become
   the input to `simulate_position_at_price`, `compute_token_amounts_for_range`, or a
   downstream chart. Truncating it to 2 decimals at emit time silently corrupts the
   round-trip.

2. Tool outputs must be **easy for an LLM to render directly into a user-facing reply**
   without performing decimal arithmetic. `"49,771.65 USDC"` is something the model
   can quote verbatim; `49771649085 / 10^6` is something the model will sometimes get
   wrong, especially for negative numbers, very small fractions, or fields where it
   has guessed the wrong decimal count.

The single rule below resolves both requirements.

## 2. The core rule

> **Scaled numerics are dual-emitted. Canonical numerics are single-emitted in their canonical form.**

A field is **scaled** when its on-the-wire integer value differs from what a human
reads, because the integer has been multiplied by `10^decimals` of some token (or
similarly transformed). For these fields, emit a humanized display string AND a
raw companion (see the definition of *Raw* below). The raw form is canonical;
display is derived.

A field is **canonical** when its on-the-wire form is already the form math operates
on — no decimal scaling, no display reinterpretation. For these fields, emit the
single canonical value, unchanged.

**Raw** is the canonical lossless form in which upstream delivers the value —
typically a bigint scaled by 10^decimals, but may also be a fixed-point bigint
(Q64.96), a 10^8-scaled accounting bigint, or a float string when upstream is
itself float-based (e.g. subgraph USD metrics). The defining property is that
the consumer can reconstruct the exact value without precision loss.

A **display sidecar** is a humanized field emitted alongside a *different*
canonical field for narration convenience, without a `*Raw` companion of its
own. The canonical field remains the single source of truth; the sidecar is
derived at format time. Example: a notification carrying
`currentSqrtPriceX96` may include a humanized `currentPrice` next to it.
Consumers needing exact arithmetic derive from the canonical field, not by
parsing the sidecar. This is distinct from dual-emit — sidecars are
single-emit *display* (their canonical lives elsewhere in the same object),
not single-emit *canonical*.

### Decision table

| Field category               | Examples                                                  | Treatment           | Reason                                                                  |
| ---                          | ---                                                       | ---                 | ---                                                                     |
| Token-decimal-scaled bigints | `currentValueRaw`, `priceRange.lowerRaw`, `unrealizedPnl` | **Dual-emit**       | Integer ≠ human reading; truncation loses precision                     |
| Fee-tier identifiers         | `feeBps` + `feeTier`                                      | **Dual-emit**       | Two domains (Uniswap raw, percent string), both directly used downstream |
| Tick indices                 | `tickLower`, `tickUpper`, `currentTick`, `tickSpacing`    | **Single-emit int** | Already canonical; "human form" of a tick is a *price*, emitted separately |
| Q64.96 sqrt prices           | `sqrtPriceX96`                                            | **Single-emit**     | Already canonical bigint; humanization is `priceRange.current`          |
| Unscaled bigint scalars      | `liquidity`, `totalSupply`, `sharesBalance`, `poolLiquidity` | **Single-emit**  | No decimals; bigint string is canonical                                 |
| Q128 fee-growth accumulators | `feeGrowthGlobal0/1`                                      | **Single-emit**     | Already canonical; only useful raw                                      |
| Per-token fee raws           | `unclaimedFees0`, `unclaimedFees1`                        | **Single-emit**     | Aggregate user-facing value is `unclaimedYield`/`Raw`                   |
| APR / percentage strings     | `apr.total`, `apr.base`                                   | **Single-emit**     | Already humanized; raw bps form rarely needed by consumers              |
| Display sidecar              | `currentPrice` next to `currentSqrtPriceX96`              | **Single-emit display** | Canonical lives in a sibling field; sidecar is for narration only |
| Booleans, enums, status      | `inRange`, `isArchived`, `protocol`, `type`               | **Single-emit**     | No alternate form                                                       |
| Addresses, hashes, IDs       | `poolAddress`, `positionHash`, `ownerWallet`              | **Single-emit**     | Opaque strings                                                          |

The negative space matters as much as the positive: do **not** dual-emit ticks
(`tickLower`/`tickLowerRaw` would be identical), `sqrtPriceX96`, `liquidity`, etc.
Such pairs would either be duplicates or would re-derive a different field
(e.g. tick→price duplicates `priceRange`).

## 3. Required field shapes

### 3.1 `pool` object

There are two pool shapes — same convention, different token-pair naming, picked
by whether the parent has a base/quote pivot.

#### 3.1.a Embedded pool summary

Used on items that already carry a base/quote pivot (positions, close orders,
pnl-curve outputs, simulation outputs). Token roles are named by their
*economic* role in the parent item:

```jsonc
"pool": {
  "chainId": 8453,
  "poolAddress": "0xd0b53D9277642d899DF5C87A3966A349A798F224",
  "pair": "WETH/USDC",
  "feeBps": 500,
  "feeTier": "0.05%",
  "baseToken": {
    "address": "0x4200000000000000000000000000000000000006",
    "symbol": "WETH",
    "decimals": 18
  },
  "quoteToken": {
    "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "symbol": "USDC",
    "decimals": 6
  }
}
```

Source: [`formatPoolSummary`](src/formatters.ts) — every item that needs this
shape calls it.

#### 3.1.b Standalone pool detail

Used by `get_pool` and any future *pool-centric* (not user-centric) tool.
Outside a position context there is no canonical base/quote pivot, so the
canonical Uniswap pool ordering wins:

```jsonc
{
  "chainId": 8453,
  "poolAddress": "0xd0b53D9277642d899DF5C87A3966A349A798F224",
  "protocol": "uniswapv3",
  "pair": "WETH/USDC",      // <token0Symbol>/<token1Symbol>
  "feeBps": 500,
  "feeTier": "0.05%",
  "tickSpacing": 10,
  "token0": { "address", "symbol", "decimals" },
  "token1": { "address", "symbol", "decimals" }
}
```

Source: [`formatPool`](src/formatters.ts).

#### Shared rules (both shapes)

All fields required, no nulls. `feeTier = (feeBps / 10_000).toFixed(2) + "%"` —
note the divisor is `10_000` (Uniswap fees are denominated in hundredths of a basis
point), **not** `100`. `pair` is `"<firstSymbol>/<secondSymbol>"` (base/quote for
3.1.a, token0/token1 for 3.1.b). Token addresses are EIP-55 checksummed.
`decimals` is an integer.

The pool object must be self-contained: a consumer should never need to drop into
`rawConfig` or a sibling `state`/`config` block to resolve the pool address or
token decimals. If you find yourself wanting `rawConfig.token0Address` from a
downstream caller, the formatter is incomplete.

### 3.2 Money fields (dual-emit)

The dual-emit rule applies to **any scaled numeric** in any formatter — the
canonical examples below cover the position-shaped tools, but the same pattern
extends to PnL, accounting, conversion, and pool-metrics outputs (see §3.2.b).

#### 3.2.a Position-shaped money fields (quote-token-denominated)

Each of the following fields is emitted as a pair `<name>` + `<name>Raw`,
scaled to the position's quote-token decimals:

| Display                | Raw                       | Type                    |
| ---                    | ---                       | ---                     |
| `currentValue`         | `currentValueRaw`         | quote-token units       |
| `costBasis`            | `costBasisRaw`            | quote-token units       |
| `realizedPnl`          | `realizedPnlRaw`          | quote-token units       |
| `unrealizedPnl`        | `unrealizedPnlRaw`        | quote-token units       |
| `collectedYield`       | `collectedYieldRaw`       | quote-token units       |
| `unclaimedYield`       | `unclaimedYieldRaw`       | quote-token units       |

Both forms always present, even when zero or null. When the underlying value is
unavailable from upstream (e.g. not yet computed), emit `null` for both members of
the pair, never `"0.00 USDC"` for one and `null` for the other.

#### 3.2.b Other dual-emit field families

The same pattern applies in non-position-shaped tools. Reference list (not
exhaustive — any new scaled numeric joins this convention):

- **Reporting-currency amounts** (`get_pnl`, `get_position_accounting`):
  `<field>` formatted via `formatReportingAmount` (e.g. `"$1,234.56"`),
  `<field>Raw` is the upstream bigint string scaled to **10^8**
  (the accounting domain's reporting-currency precision).
  Pairs: `netPnl`/`netPnlRaw`, `realizedFromWithdrawals`/`...Raw`, etc. at
  every nesting level (portfolio, instruments[], positions[], journal lines).
- **Conversion-summary amounts** (`get_position_conversion`): base- and
  quote-denominated, named explicitly per §7. Pairs: `base`/`baseRaw` (scaled
  to base-token decimals), `quote`/`quoteRaw` and `avgPrice`/`avgPriceRaw`
  (scaled to quote-token decimals).
- **APR cost-basis and yield amounts** (`get_position_apr`): the
  quote-token-denominated inputs feeding APR computation. Per-period:
  `costBasis`/`costBasisRaw`, `collectedYieldValue`/`...Raw`. Summary:
  `realizedFees`/`...Raw`, `realizedTWCostBasis`/`...Raw`,
  `unrealizedFees`/`...Raw`, `unrealizedCostBasis`/`...Raw`. All scaled to
  the position's quote-token decimals. The APR percentages themselves
  (`totalApr`, `realizedApr`, `unrealizedApr`, `baseApr`, `rewardApr`)
  remain single-emit per §2.
- **Trigger-price** (`list_close_orders`): `triggerPrice`/`triggerPriceRaw`
  derived from canonical `triggerTick` via `tickToPrice` — bigint scaled to
  quote-token decimals. Both null when `triggerTick` is null.
- **Pool USD metrics** (`get_pool`): `tvl`/`tvlRaw`, `volume24h`/`volume24hRaw`,
  `fees24h`/`fees24hRaw`. Display is the compact form (`"$123.5M"`); raw is the
  USD float string the subgraph returned. This is a case where the raw form is
  itself a float string — still canonical because the subgraph delivers it that
  way and there is no precision loss in passing it through unmodified.
- **Notification payloads** (`list_notifications`): per-event-type. Range
  events single-emit `currentSqrtPriceX96` as the canonical form (the
  humanized prices alongside it are display-only — see §2). Execution-success
  events dual-emit `amount0Out`/`amount0OutRaw`, `amount1Out`/`amount1OutRaw`
  (each scaled to its individual token's decimals).

### 3.3 `priceRange`

Emit a list-tier (cheap) shape and a detail-tier (extended) shape.

**List-tier** (used by `list_positions` and any future bulk listing):

```jsonc
"priceRange": {
  "lower":    "3,808.49 USDC",
  "lowerRaw": "3808498901",
  "upper":    "5,239.46 USDC",
  "upperRaw": "5239463844"
}
```

**Detail-tier** (used by `get_position` and any future single-position detail tool):

```jsonc
"priceRange": {
  "lower":      "2,250.74 USDC",
  "lowerRaw":   "2250745333",
  "upper":      "2,460.23 USDC",
  "upperRaw":   "2460235238",
  "current":    null,         // humanized current pool price; null until upstream API populates it
  "currentRaw": null,         // bigint-string companion of current; populated together
  "inRange":    true          // tickLower <= currentTick <= tickUpper, computed locally
}
```

**Cost asymmetry rationale.** `current` requires reading current pool state
(sqrtPriceX96 → tick → human price). For a list endpoint, that's an extra
on-chain or RPC read per position — multiplied by 20 items per page, that's a
20× cost amplification for a field most list consumers do not need. The detail
endpoint reads pool state anyway, so adding `current` there is free.

`inRange` is computed from already-available raw fields (`tickLower`, `tickUpper`,
`currentTick`) and so can be safely emitted in the detail tier even when `current`
is null. It is not added to the list tier for the same cost reason.

## 4. Display formatting rules

### 4.1 Money display strings — construction rule

All money display strings on quote-token-denominated fields are produced
via:

    formatCompactValue(rawValue, quoteToken.decimals) + " " + quoteToken.symbol

For non-position-shaped tools, the analogue per §3.2.b applies:
`formatReportingAmount` for accounting amounts (10^8 scale, currency
prefix), `formatUSDValue` for pool USD metrics (compact `$123.5M`
notation). In every case, the helper is the single source of truth for
the numeric portion — its branch logic (magnitude-dependent decimal
handling, zero-skip subscript notation for tiny values, truncation
policy) lives in source. This spec illustrates the rule; the
implementation governs.

Illustrative outputs for a USDC-quoted (6 decimals) money field:

| raw                  | rendered           |
| ---                  | ---                |
| `0n`                 | `"0.00 USDC"`      |
| `22_000_000n`        | `"22.00 USDC"`     |
| `22_500_000n`        | `"22.50 USDC"`     |
| `22_499_999n`        | `"22.49 USDC"`     |
| `4_891_215_408n`     | `"4,891.21 USDC"`  |
| `-65_858_588n`       | `"-65.85 USDC"`    |
| `1_499n`             | `"0.001 USDC"`     |
| `499n`               | `"0.000499 USDC"`  |
| sub-1, ≥4 leading zeros | `"0.₍7₎1234 USDC"` |

Locale within `formatCompactValue` defaults to `FORMAT_PRESET_EN`
(`,` thousands, `.` decimal, Unicode subscript). Override only via
explicit `FormatOpts`, never by post-processing the returned string.

### 4.2 Edge cases

- Null raw → null display. Never emit `"null USDC"`, `"NaN USDC"`, or
  `"0.00 USDC"` as a stand-in for missing data.
- Truncation/rounding policy: governed by `formatCompactValue` (currently
  truncation toward zero). Raw remains the lossless source of truth;
  consumers needing exact arithmetic must read `*Raw`.

### 4.3 Address strings

EIP-55 checksum case. Never lowercase, never uppercase.

## 5. Tool descriptions

Tool descriptions are part of the contract — an LLM agent reads them to decide
how to use the tool. They must accurately describe the response shape. Two
rules:

1. **No promise without delivery.** If the description says a field exists, the
   response must contain it. The reverse is also enforced: every dual-emitted
   field appears in the description.

2. **Templated convention fragment.** Every tool emitting scaled numerics
   includes this paragraph (or its closest variant) verbatim:

   > Money and price fields are dual-emitted: `<field>` is a humanized display
   > string in the position's quote token (e.g. `"49,771.65 USDC"`); `<field>Raw`
   > is the bigint as decimal string in quote-token base units. Raw is canonical
   > — use it for further computation; display is for narration/rendering.

## 6. Worked examples

### 6.1 `list_positions` item (full)

```jsonc
{
  "positionHash": "uniswapv3-vault/8453/0x9F59…/0x60Cc…",
  "protocol": "uniswapv3-vault",
  "type": "VAULT_SHARES",
  "pool": {
    "chainId": 8453,
    "poolAddress": "0xd0b53D9277642d899DF5C87A3966A349A798F224",
    "pair": "WETH/USDC",
    "feeBps": 500,
    "feeTier": "0.05%",
    "baseToken":  { "address": "0x4200…0006", "symbol": "WETH", "decimals": 18 },
    "quoteToken": { "address": "0x8335…2913", "symbol": "USDC", "decimals":  6 }
  },
  "currentValue":     "4,891.21 USDC",
  "currentValueRaw":  "4891215408",
  "costBasis":        "4,957.07 USDC",
  "costBasisRaw":     "4957073996",
  "realizedPnl":      "0.00 USDC",
  "realizedPnlRaw":   "0",
  "unrealizedPnl":    "-65.85 USDC",
  "unrealizedPnlRaw": "-65858588",
  "collectedYield":     "0.00 USDC",
  "collectedYieldRaw":  "0",
  "unclaimedYield":     "31.50 USDC",
  "unclaimedYieldRaw":  "31506848",
  "apr": { "total": "75.3%", "base": "75.3%", "reward": "0.0%" },
  "priceRange": {
    "lower":    "2,250.74 USDC",
    "lowerRaw": "2250745333",
    "upper":    "2,460.23 USDC",
    "upperRaw": "2460235238"
  },
  "openedAt": "Apr 22, 2026, 10:49:55 AM (3 days ago)",
  "isArchived": false,
  "archivedAt": null
}
```

### 6.2 `get_position` (delta vs. list item)

Add `current` / `currentRaw` / `inRange` to `priceRange`; otherwise the same
`pool` and money-pair shapes:

```jsonc
"priceRange": {
  "lower":      "2,250.74 USDC",
  "lowerRaw":   "2250745333",
  "upper":      "2,460.23 USDC",
  "upperRaw":   "2460235238",
  "current":    null,
  "currentRaw": null,
  "inRange":    true
}
```

`get_position` may additionally emit `rawConfig` and `rawState` blocks for
advanced/debug consumers. Those blocks are protocol-specific and do **not**
follow dual-emit — every field there is canonical (ticks, sqrtPriceX96,
liquidity, accumulators).

### 6.3 `get_pnl` portfolio block (non-position-shaped reference)

Reporting-currency amounts use the same dual-emit shape as position-shaped
money fields, only with a different formatter (`formatReportingAmount`) and a
different scale (10^8 rather than per-token decimals):

```jsonc
{
  "period": "month",
  "startDate": "Apr 1, 2026, 12:00:00 AM (24 days ago)",
  "endDate":   "Apr 30, 2026, 11:59:59 PM (in 5 days)",
  "reportingCurrency": "USD",
  "portfolio": {
    "netPnl":                       "$3,124.56",
    "netPnlRaw":                    "312456000000",
    "realizedFromWithdrawals":      "$2,800.00",
    "realizedFromWithdrawalsRaw":   "280000000000",
    "realizedFromCollectedFees":    "$324.56",
    "realizedFromCollectedFeesRaw": "32456000000",
    "realizedFromFxEffect":         "$0.00",
    "realizedFromFxEffectRaw":      "0"
  },
  "instruments": [ /* same dual-emit pairs */ ]
}
```

The Raw companion is the upstream bigint string scaled to 10^8 — feed it back
into any consumer that needs exact arithmetic on accounting amounts.

## 7. Anti-patterns

Do not do any of the following:

- **Locale-formatted strings as load-bearing data.** `"3,808.49 USDC"` is for
  the user. Anything that needs to be parsed back into a number lives in the
  `*Raw` companion.
- **Re-deriving raw from display.** `parseFloat(display.replace(/[^0-9.-]/g, ""))`
  in any consumer is the symptom; the structural issue is *missing raw
  companions*. Whether the `*Raw` value is inline next to its display or
  inside a parallel `{ formatted, raw }` block is stylistic — but **inline
  is preferred for consistency** (every example in §6 uses inline). New
  tools should use inline. Existing tools that use parallel blocks should
  migrate to inline when next touched.
- **Dual-emitting canonical fields.** `tickLower` + `tickLowerRaw` (identical),
  `liquidity` + `liquidityRaw` (identical), `sqrtPriceX96` + a "humanized" sqrt
  price (different field entirely — that's `priceRange.current`).
- **Renaming fields to "fix" inconsistency.** Migration is additive (§8).
  Inconsistency is fixed by adding the missing companion, not by renaming the
  existing one.
- **Promising a field in the description without populating it.** If the field
  is not yet implemented, omit it from the description until it is.
- **Mixing token denominations silently.** Money fields are quote-token-denominated
  unless the field name explicitly says otherwise. If a tool needs to expose
  base-token amounts (e.g. `simulate_position_at_price` returning `baseAmount` /
  `quoteAmount`), name them explicitly and dual-emit each in its own token.

## 8. Migration / additive-only rule

When evolving an existing tool's output:

- **Never rename or remove an existing field** in a single PR. Existing clients
  (LLM agents, dashboards, scripts) silently break on `undefined`.
- **Add the missing form alongside the existing one.** If the response currently
  has only `currentValueRaw`, add `currentValue`. If it has only `currentValue`,
  add `currentValueRaw`. End state: both present, both documented.
- **A coordinated rename across the whole API surface** (e.g. dropping the `Raw`
  suffix everywhere) is its own versioned migration with a deprecation window
  and updated description block. It does not piggyback on a feature PR.

## 9. Acceptance test pattern

> **Status (2026-04-25):** No test harness exists in `apps/midcurve-mcp-server/`
> yet. The patterns below are aspirational — once the harness lands (vitest is
> the planned choice, matching the rest of the monorepo), every tool emitting
> scaled numerics must assert these patterns. Until then, verification is
> manual: run the MCP server against a live API and inspect outputs.

Once a test suite is in place, for any tool emitting scaled numerics it must
assert (illustrative; adapt field names per tool):

```ts
// pool shape
expect(item.pool.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
expect(item.pool.feeBps).toBeTypeOf("number");
expect(item.pool.feeTier).toMatch(/^\d+\.\d{2}%$/);
expect(item.pool.feeTier).toBe(`${(item.pool.feeBps / 10_000).toFixed(2)}%`);
expect(item.pool.baseToken.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
expect(item.pool.baseToken.decimals).toBeTypeOf("number");
expect(item.pool.quoteToken.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
expect(item.pool.quoteToken.decimals).toBeTypeOf("number");

// money pairs
for (const f of [
  "currentValue", "costBasis",
  "realizedPnl", "unrealizedPnl",
  "collectedYield", "unclaimedYield",
]) {
  expect(item[f]).toMatch(/^-?[\d,]+\.\d{2} \w+$/);
  expect(item[`${f}Raw`]).toMatch(/^-?\d+$/);
  // round-trip: humanize(raw, quote.decimals, quote.symbol) === display
  expect(humanize(item[`${f}Raw`], item.pool.quoteToken)).toBe(item[f]);
}

// priceRange list-tier
expect(item.priceRange.lower).toMatch(/^[\d,]+\.\d{2} \w+$/);
expect(item.priceRange.lowerRaw).toMatch(/^\d+$/);
expect(item.priceRange.upper).toMatch(/^[\d,]+\.\d{2} \w+$/);
expect(item.priceRange.upperRaw).toMatch(/^\d+$/);

// detail-tier additions (get_position only)
expect(typeof detail.priceRange.inRange).toBe("boolean");
expect("current"    in detail.priceRange).toBe(true); // may be null
expect("currentRaw" in detail.priceRange).toBe(true); // may be null

// canonical fields are NOT dual-emitted
expect("tickLowerRaw"     in detail.rawConfig).toBe(false);
expect("liquidityRaw"     in detail.rawState ).toBe(false);
expect("sqrtPriceX96Raw"  in detail.rawState ).toBe(false);
```

## 10. Future tools — adoption checklist

When adding a new MCP tool that emits position-level or pool-level data
(`list_close_orders`, `list_notifications`, `generate_position_pnl_curve`, future
yield/swap/order tools, etc.), the formatter must:

- [ ] Embed the `pool` object (§3.1) on any item that references a pool, even if
      the upstream API delivers only `poolAddress`. Resolve to full token metadata.
- [ ] Dual-emit every scaled numeric per §3.2 / §3.3.
- [ ] Single-emit every canonical numeric per §2 decision table.
- [ ] Include the templated convention paragraph in the tool description (§5).
- [ ] Use `"0.00 <SYMBOL>"` for zero, `null`/`null` for missing pairs (§4.2).
- [ ] Add the per-tool acceptance assertions from §9, adapted to the tool's
      money-field set.
- [ ] Stay strictly additive vs. any prior version of the tool's output (§8).

**Current state (2026-04-25):** every shipping tool satisfies items 1–5 and 7
after the post-convention sweep landed. Item 6 (acceptance assertions) is
pending — see §9 for the harness status.
