# RFC-0003: Staking Vault

**Status:** Draft (rewrite)
**Issue:** TBD
**Implementation:** SPEC-0003b
**Author:** @0xNedAlbo
**Last updated:** 2026-05-06

---

## 1. Summary

The Staking Vault wraps a single Uniswap V3 NFT position and turns it into
a yield-target-based staking primitive. The owner deposits a position with
a fixed quote-side reward target `T`. The vault closes the position
(fully or partially) when the on-chain conditions allow it to honor the
deposit `(B, Q)` plus the target `T`, paying the owner exactly that and
distributing any surplus along well-defined paths.

Settlement is permissionless. External actors — keepers, solvers, helper
bots — drive the close in exchange for either an LVR-implied rate
discount (when a token swap is needed) or an explicit bounty (when no
swap is needed). The owner has additional owner-only paths for direct
trades and for capital-light exits via flash callback.

The vault uses no oracle. All pricing is deterministic from the pool
state at execution time, classified by a four-case partition over the
`(b, q)`-balance after position close.

## 2. Motivation

A Uniswap V3 LP position is a complex, two-sided exposure with no
intrinsic exit signal. The provider holds two tokens that drift relative
to spot, accumulates fees, and must decide manually when to close — which
typically means writing a bot, paying for an aggregator, or eyeballing
the position in a UI.

This RFC turns the position into a position that **closes itself when
the right economic conditions are met**, without requiring the owner to
run infrastructure. The mechanism that makes this possible is a vault
contract that:

- Holds the NFT and the deposit accounting `(B, Q, T)`
- Exposes a permissionless close path that settles when on-chain state
  shows the deposit-plus-target is recoverable
- Compensates external actors via implicit (LVR rate) or explicit
  (bounty) rewards, so a third-party keeper has positive expected value
  for closing
- Falls back to owner-controlled paths (direct trade, flash exit) when
  external action does not materialize or the owner wants to override

The economic primitive being expressed is: **"I want exactly `B` base
plus `Q + T` quote out of this position. Close it as soon as the pool
allows. If it cannot be closed at this target, leave it staked."**

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

`(B, Q, T)` together form the *settlement contract* the vault makes with
the owner: on full settlement, the owner receives at least `(B, Q + T)`,
distributed across `unstakeBuffer` (B and Q) and `rewardBuffer` (T plus
any surplus).

### 3.3 Position close and balance after close

When a settlement path triggers, the vault calls UV3's
`decreaseLiquidity` (proportional to the close fraction) and `collect`
(all uncollected fees, not pro-rated — UV3 fee collection is
all-or-nothing per `tokenId`). The resulting fresh balance the vault
receives is denoted `(b, q)`.

This is the central observable: `(b, q)` is what the position can
deliver right now, and the four-case classification compares it to the
targets `(B × frac, (Q + T) × frac)` where `frac` is the close fraction.

### 3.4 LVR-implied rate

LVR ("loss versus rebalancing") is the structural feature of UV3
positions where the average price the position trades at across its
range is below the current spot price. The vault exposes this rate
mechanically: in Cases 2 and 3 below, the vault offers a swap at the
exact `(b, q)`-derived rate from the partial close, which is by
construction the LVR-implied rate. The keeper accepts that rate (or
declines).

The vault never quotes "spot minus X%". It quotes "this much in, this
much out, take it or leave it." The fact that this rate corresponds to
a discount versus current spot is not a parameter — it is the structural
property of the close itself.

## 4. The four cases

After closing the position, the vault holds `(b, q)` of base and quote
respectively. Compare against `(targetBase, targetQuote) = (B × frac,
(Q + T) × frac)`:

| Case | Condition | Status |
|------|-----------|--------|
| 1 | `b ≥ targetBase AND q ≥ targetQuote` | NoSwapNeeded |
| 2 | `b > targetBase AND q < targetQuote` | Executable |
| 3 | `b < targetBase AND q > targetQuote` | Executable |
| 4 | `b < targetBase AND q < targetQuote` | Underwater |

**Case 1 (NoSwapNeeded).** The vault holds enough of both tokens. No
trade is needed; settlement is purely accounting. Surplus over
`(B, Q + T)` is the *bounty* paid to the caller of the permissionless
`settle()` path (see §5.3).

**Case 2 (Executable, base surplus).** Vault has too much base, not
enough quote. It offers `(b − targetBase)` base to a keeper in exchange
for at least `(targetQuote − q)` quote. The keeper sells the base on
the market and keeps the LVR-implied rate as profit.

**Case 3 (Executable, quote surplus).** Symmetric to Case 2: vault has
too much quote, offers it for base.

**Case 4 (Underwater).** The position cannot deliver `(B, Q + T)` at the
current price. This is **only reachable when `T > 0`**. Mathematically,
a UV3 position close always yields either `(b ≥ B AND q ≤ Q)` or
`(b ≤ B AND q ≥ Q)` plus non-negative fees on both sides. So `b < B`
implies `q ≥ Q`, and Case 4's `q < Q + T` requires `T > fees_quote`.

This means Underwater is always a yield-target phenomenon, never a pool
phenomenon. The owner controls whether the position is in Case 4: if
`setYieldTarget(0)` is called, the vault transitions to Case 2 or 3 and
becomes Executable. The owner trades reward expectation for exit
optionality.

### 4.1 Boundary handling

Comparisons use `≥` consistently. Boundary equalities (`b == B`, `q ==
Q+T`) fall into Case 1. Degenerate sub-amounts (`amountIn == 0` or
`amountOut == 0` in Cases 2/3) are handled by the standard token-flow
path with zero transfers — they do not constitute special cases.

### 4.2 Why no fifth case

A previous draft of this RFC proposed a fifth "discount swap" case
(both surpluses, swap at oracle-discounted rate to incentivize a
keeper). It was rejected because:

1. It required a TWAP oracle, contradicting the no-oracle goal.
2. It introduced an arbitrary 5% discount parameter.
3. The case it addressed — both surpluses — is now handled cleanly by
   `settle()` with surplus-as-bounty, no oracle needed.

The four-case partition is final.

## 5. Settlement paths

The vault exposes four mutually exclusive settlement paths, each
matching exactly one role × case combination.

| Function | Caller | Cases | Close size | Token flow |
|----------|--------|-------|------------|------------|
| `swap` | Owner | 2, 3 | partial or full | atomic in/out |
| `flashSwap` | Public | 2, 3 | full | callback push/pull |
| `settle` | Public | 1 | full | bounty push to recipient |
| `flashSettle` | Owner | 1, 2, 3, 4 | partial or full | callback push/pull |

### 5.1 `swap()` — owner trade

The owner trades against the vault at the LVR-implied rate. The owner
specifies the close size as a `liquidity` parameter (an explicit number
of NFPM liquidity units), and the vault dictates the resulting
`(amountIn, amountOut)` from the post-close state.

Slippage bounds (`amountInMax`, `amountOutMin`) protect against pool
drift between off-chain quote and on-chain execution. The owner pays
`amountIn` of `tokenIn`; the recipient receives `amountOut` of
`tokenOut`. Reverts in Case 1 (use `settle`) and Case 4 (reduce T or
use `flashSettle`).

This is the "I want to close manually and trade against my own vault"
path. It is partial-capable because the owner is in control of close
size and is aware of the implications.

### 5.2 `flashSwap()` — keeper trade

Permissionless. Always full close. The keeper provides a callback
contract; the vault pushes `tokenOut` to the callback and expects
`tokenIn ≥ amountInMin` returned. The frame is reentrancy-locked via
the `FlashSwapInProgress` state.

This is the **primary keeper integration point**. A standalone keeper
bot:

1. Polls `quoteSwap()` across vaults
2. For Executable status, evaluates whether the LVR-implied rate is
   profitable after gas and external swap costs
3. Calls `flashSwap()` with a callback that takes a UV3-pool flash
   loan, executes the trade, sells the result on AMM, repays
4. Keeps the LVR-discount as profit

Why always full? Yield-target preservation. Partial close shrinks `T`
proportionally, leaving the remainder exposed to further drift. If
keeper #1 closes 30%, keeper #2 may find a Case-4 position. The
yield-target promise breaks. Owners reaching `q ≥ Q + T` want the full
position closed atomically.

### 5.3 `settle()` — Case 1 with bounty

Permissionless. Always full close. Used when the position is in
NoSwapNeeded — both surpluses present, no trade needed.

Mechanics:

- Position fully closed, vault holds `(b, q)` with `b ≥ B`, `q ≥ Q+T`
- `unstakeBuffer` filled with exactly `(B, Q)`
- `rewardBuffer` filled with exactly `(0, T)`
- Surplus `(b − B, q − (Q+T))` transferred to caller's `recipient` as
  bounty

The bounty exists because Case 1 has no implicit keeper reward (no
trade, no LVR discount). It compensates for gas and incentivizes
permissionless settlement, so the owner's yield target is realized
without owner action.

In practice the bounty is small. Case 1 only arises when UV3 fees push
both `b` past `B` and `q` past `Q + T` simultaneously. If either
inequality were strict by more than a dust amount, the position would
already have been in Case 2 or 3 and a `flashSwap()` keeper would have
settled it earlier. Case 1 is an edge case at the four-quadrant origin,
and its bounty reflects that.

The owner trades the surplus over `(B, Q + T)` against the guarantee
that the position settles automatically when T is reached. For typical
positions with small Case-1 surplus, this is a favorable trade.

### 5.4 `flashSettle()` — owner exit

Owner only. Any case (including Underwater). Partial-capable.

Mechanics:

- Position closes `liquidity` units, freeing `(b, q)` proportional to
  the close fraction
- All freed `(b, q)` is pushed to `callbackTarget`
- Callback must return `(B × frac, (Q + T) × frac)` to the vault
- Vault verifies and fills buffers additively
- Owner subsequently calls `unstake()` and `claimRewards()` to drain

This is **not a swap**. The helper receives whatever the pool gave at
execution time and must return the deposit-plus-target. Whether the
helper needs to swap, top up from inventory, or use a flash loan
depends on the case classification at execution time:

- Case 1 (b > B, q > Q+T): helper holds surplus, returns the targets,
  keeps the rest (functionally a private `settle` for the owner)
- Cases 2/3: helper has imbalance, swaps externally, returns targets
- Case 4: helper has shortfalls on both sides, must source liquidity
  via flash loan or owner inventory

Overpayment is accepted on both sides and flows to `rewardBuffer`. This
makes defensive helper implementations safe — round-up buffers,
slippage cushions, and flash-loan fee margins all over-return without
revert risk, and the surplus flows back to the owner.

Purpose: enable owner exit (full or partial) without requiring the
owner to bring matched capital. The helper bridges the capital gap; the
owner recovers only the bridging cost plus flash fees plus gas. This
contrasts with the alternative path `swap → unstake → claimRewards`,
which requires the owner to bring full `amountIn` from external
inventory.

## 6. State machine

```
            ┌─────────┐
            │  Empty  │
            └────┬────┘
                 │ stake()
                 ▼
            ┌─────────┐
            │ Staked  │ ───────┐
            └────┬────┘        │ swap (partial)
                 │             │ flashSettle (partial)
                 │             │
                 │ swap (full) │
                 │ flashSwap   │
                 │ settle      │
                 │ flashSettle (full)
                 │             │
                 ├──◄──── FlashSwapInProgress (transient)
                 ├──◄──── FlashSettleInProgress (transient)
                 │             │
                 │             ▼
                 │        ┌─────────┐
                 └───────►│ Settled │
                          └─────────┘
```

States:

- **Empty** — clone initialized, no position yet
- **Staked** — active position, all settlement paths available
- **FlashSwapInProgress** — transient, between callback push and verification
- **FlashSettleInProgress** — transient, between callback push and verification
- **Settled** — position fully closed, buffers filled, drains pending

`unstake()` and `claimRewards()` are available in `Staked` and `Settled`.
`stakeTopUp()` and `setYieldTarget()` are available only in `Staked`.

The state lock during the two flash callbacks ensures all other vault
functions revert during the callback frame, preventing reentrancy
attacks and racing modifications.

## 7. Buffer mechanics

The vault holds two pairs of buffers:

- `unstakeBufferBase`, `unstakeBufferQuote` — accumulating principal
  reclaimed via settlement. Drained by `unstake()`.
- `rewardBufferBase`, `rewardBufferQuote` — accumulating yield reward
  including target T and any surplus. Drained by `claimRewards()`.

Buffers fill **additively** across multiple settlement calls. A vault
may settle in pieces (multiple partial swaps, then a full flashSettle,
etc.); each call adds to existing buffer balances. Drains zero out the
respective buffers and transfer to owner.

Per-case buffer increments:

| Path | unstakeBase += | unstakeQuote += | rewardBase += | rewardQuote += |
|------|----------------|------------------|---------------|----------------|
| `swap` (Case 2) | B × frac | Q × frac | (b − B × frac) | (q + amountIn − Q × frac) |
| `swap` (Case 3) | B × frac | Q × frac | (b + amountIn − B × frac) | (q − Q × frac) |
| `flashSwap` (Case 2) | B | Q | (b − B) | (q + amountIn − Q) |
| `flashSwap` (Case 3) | B | Q | (b + amountIn − B) | (q − Q) |
| `settle` | B | Q | 0 | T |
| `flashSettle` (any case) | B × frac | Q × frac | (postBase − B × frac) | (postQuote − Q × frac) |

In `flashSettle`, `postBase` and `postQuote` are the actual amounts the
helper returned (`≥ B × frac`, `≥ (Q+T) × frac`). Overpayment flows to
reward.

In `settle`, the surplus over `(B, Q+T)` does *not* flow to reward —
it goes to the caller as bounty (see §5.3). The reward buffer receives
exactly `T`.

## 8. Top-up

`stakeTopUp()` adds liquidity to the existing position. The vault adds
the consumed `(amount0, amount1)` to `(B, Q)` proportionally. The yield
target `T` is scaled by the new-to-old quote ratio:

```
T_new = T_old × (Q + ΔQ) / Q   (rounded up)
```

Rounding up prevents downward drift on repeated tiny top-ups. Skipped if
`Q == 0` (no anchor to scale against — a base-only initial deposit
with later top-up keeps T constant).

The implicit yield rate `T / Q` stays constant (modulo rounding). An
owner who originally deposited 1000 quote at T = 100 (10%) and later
adds another 1000 quote ends up with `B' = 2 × B`, `Q' = 2000`,
`T' = 200` — same 10% rate over the larger position.

## 9. Yield target mutability

`setYieldTarget()` allows the owner to change `T` while staked. This
serves three purposes:

1. **Lower T to escape Underwater.** Setting `T = 0` always makes the
   position Executable (Cases 2 or 3). Useful when the owner concedes
   the target and wants to exit at break-even on principal alone.

2. **Raise T to take more risk.** Owner extends their reward
   expectation, accepting that the position stays open longer.

3. **Adjust to changed pool conditions.** Volume regime shifts may
   warrant target recalibration without forcing a close + re-stake.

Mutability is protected against keeper front-running by the slippage
parameters at the keeper's call site. The keeper specifies its accepted
bounds via `amountInMax` / `amountOutMin`; if the owner raises T
between the keeper's quote and execution, the keeper's bounds are
violated and the call reverts cleanly. No locking or commit-reveal is
needed.

## 10. Pricing and oracle stance

The vault uses **no external price oracle and no pool TWAP**. All
pricing is deterministic from the pool state at execution time:

- `pool.slot0().sqrtPriceX96` — current spot price, used to compute
  `(b, q)` from the partial close
- NFPM `positions(tokenId)` — current liquidity, fee growth, owed amounts
- `LiquidityAmounts.getAmountsForLiquidity` — to convert liquidity ×
  sqrtPrice to token amounts

The four-case classification depends only on `(b, q)` versus
`(B × frac, (Q + T) × frac)`. There is no rate-decision step that
requires an oracle.

Consequences:

- No deployment dependency on Chainlink, third-party feeds, or
  cross-pool basis
- No TWAP-manipulation surface
- Per-call gas is reduced (no oracle round-trip)
- Pricing is exactly the LVR-implied rate, which is always at or below
  current spot — keepers self-select based on whether external markets
  give them better prices (in which case they don't act and the vault
  stays open)

The trade-off is that the vault cannot offer a "spot-priced" trade. In
particular, a Case-4 position cannot be closed by the vault itself
without owner action (either lower T or use flashSettle). This is by
design: the no-oracle stance is non-negotiable and Case 4 is rare and
recoverable.

## 11. Solver-network compatibility

Each settlement path moves exactly one token in and exactly one token
out per call (or zero in the no-trade paths). This single-direction
property is essential for solver-network compatibility — limit-order
solvers (Composable CoW, similar) cannot express "executor sends X
base AND Y quote, receives Z quote" in a single atomic intent.

The vault's `quoteSwap()` returns the exact `(bidToken, bidAmount,
askToken, askAmountMin)` at full close. A solver-network adapter or
keeper bot can read this view, decide whether to act, and call
`flashSwap()` (or `swap()` for owner-side flows) without further
negotiation.

The atomic-trade form of `swap()` matches solver-routing patterns where
the settlement contract holds `tokenIn` from another order in the same
batch. The callback form of `flashSwap()` matches keeper patterns where
the bot needs to bridge funds via a flash loan.

The vault thus supports both **direct keepers** (no solver network,
take the LVR rate directly) and **solver-network integration** (vault
appears as a venue in a routed order), without requiring different
contract paths.

## 12. Reward direction

The yield target is quote-denominated. The owner's reward is
quote-denominated. Base-side fees collected during settlement flow into
the swap step (executor takes them in Cases 2/3) or into the bounty
(caller takes them in Case 1) or into the reward buffer (in
flashSettle's overpayment path).

The owner sees a clean quote-denominated outcome on `claimRewards()`,
plus base-side amounts only when surplus flows through `flashSettle`'s
overpayment path or through `swap`'s buffer increments. The latter is
typically small (fee accumulation, not principal drift).

## 13. Reentrancy and state locks

All state-mutating functions use OpenZeppelin's `nonReentrant` modifier
as a baseline guard against unexpected reentrancy from non-standard
tokens (ERC-777, fee-on-transfer hooks, transfer hooks).

The two flash paths add explicit state locks:

- `flashSwap` sets state to `FlashSwapInProgress` before the callback
- `flashSettle` sets state to `FlashSettleInProgress` before the callback

While in either of these states, all other vault functions revert via
the state-check modifiers. This is a stronger, semantically richer guard
than `nonReentrant` alone — it prevents not just direct reentrancy but
also any cross-function interaction during the callback frame.

The state lock also makes the in-progress condition observable. An
indexer seeing a `FlashSwapInitiated` event without a matching `Swap`
event in the same transaction knows the call reverted.

## 14. Multicall

The vault inherits OpenZeppelin's `Multicall` mixin, allowing the owner
to bundle multiple calls atomically. Common patterns:

- `setYieldTarget` then `flashSettle`, to lower T just-in-time for an
  Underwater exit
- `unstake` then `claimRewards`, to drain both buffers in one tx
- `swap` (partial) then `unstake` then `claimRewards`, for an owner-
  driven manual close cycle

Per-call state checks remain authoritative — `multicall` does not bypass
them. The `nonReentrant` modifier across calls in the same multicall
is handled per individual call (each enters and exits its own guard).

## 15. Out of scope

The following are explicitly out of scope for this RFC:

- **CoW-Swap adapter**. A separate concern that wraps the vault's
  `flashSwap()` and `quoteSwap()` to make vaults visible to a CoW
  solver network. The vault's interface is designed to be compatible
  but the adapter itself is not part of the vault.

- **Multi-position vaults**. Each vault wraps exactly one NFT. Owners
  with multiple positions deploy multiple vaults via the factory.

- **Cross-vault accounting**. Each vault is fully self-contained. There
  is no protocol-level treasury, fee, or shared state.

- **Vault transferability**. The owner is bound at clone init time and
  cannot be changed. Owners who want to transfer ownership use
  `flashSettle` to exit and re-stake under the new owner.

- **Per-vault TWAP windows or oracle configuration**. Removed in this
  rewrite — the vault is fully oracle-free.

## 16. Design decisions log

Decisions made during chat-mode design that are now baked in:

- **Liquidity over basis points**. NFPM liquidity units (uint128) are
  used as the close-size parameter, replacing the earlier `bps`-based
  approach. Liquidity is the natural primitive for UV3, makes top-up
  semantics simpler, and avoids the implicit-vs-explicit-fraction
  confusion of `pendingBps`.

- **No `pendingBps` mechanism**. Removed. The owner uses the explicit
  `liquidity` parameter at the call site of `swap` or `flashSettle`.
  Permissionless paths (`flashSwap`, `settle`) are always full close.

- **Four settlement paths, not one**. Earlier drafts had a single
  `swap()` that handled all roles and cases. Splitting into `swap`
  (owner-trade), `flashSwap` (keeper-trade), `settle` (Case 1 bounty),
  `flashSettle` (owner-exit-with-helper) gives each path a single,
  clear responsibility and matches the actual economic actor in each
  scenario.

- **Bounty-as-surplus in settle**. The bounty for Case 1 is the surplus
  over `(B, Q + T)`. Owner trades this surplus against the
  permissionless settlement guarantee. In practice the surplus is
  small (Case 1 only arises near the four-quadrant origin), so the
  trade is favorable.

- **Underwater = T-escapable**. Mathematically Case 4 is only reachable
  when `T > 0`. Setting `T = 0` always makes the position Executable.
  This is documented as the recommended path out of Underwater, in
  addition to `flashSettle` with helper.

- **No oracle, no TWAP**. Earlier drafts proposed a 5%-discount Case
  for both-surplus situations using TWAP-spot pricing. Replaced by
  `settle` with surplus-as-bounty. The vault is now fully oracle-free.

- **Overpayment to reward in flash callbacks**. Both `flashSwap` and
  `flashSettle` accept callback over-return as overpayment that flows
  to the reward buffer. This makes defensive helper implementations
  safe (round-up buffers, slippage cushions).

- **`callbackTarget == address(0)` rejected**. Earlier draft proposed a
  no-callback mode for `flashSettle`. Removed because the use cases
  it would address are already covered by `swap`, `settle`, or direct
  pre-funding plus drain. Keeping `flashSettle` callback-only
  simplifies the contract and clarifies the function's purpose.

## 17. Open questions

- **Bounty floor for `settle()`**. Should `settle` revert if both
  surpluses are zero (boundary case)? Current decision: no, because the
  position *is* settle-able and an owner-affiliated helper may want to
  trigger settlement even without bounty. A bot operator who only
  cares about profit will simply not call when the bounty is zero.

- **Recipient for `swap()`**. Currently `recipient` is mandatory and
  cannot be `address(0)`. Should `address(0)` be interpreted as
  "owner"? Decision: no, explicitness preferred. Owner specifies
  `recipient = msg.sender` if they want to send to themselves.

- **Slippage protection for `flashSettle`**. Currently no slippage
  bounds. Helper-side slippage protection is the helper-contract's
  responsibility. Should we add explicit bounds on `flashSettle` for
  cases where the owner uses a generic helper they don't fully
  control? Open.

- **Permissionless `settle()` recipient policy**. Should there be any
  policy on who can be the recipient (e.g., must equal `msg.sender`)?
  Currently no — operator can route to any address. Open whether
  abuse vectors exist (e.g., spam settle calls to drain owner's
  surplus to attacker-controlled addresses). Counter-argument: the
  owner's deposit-plus-target is preserved regardless, only the small
  surplus is at stake.
