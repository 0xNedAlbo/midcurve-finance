# RFC-0003: Staking Vault for Uniswap V3 Positions

**Status:** draft
**Date:** 2026-05-06
**Implementation:** _(filled in once PR is merged)_

## Summary

A smart contract that wraps a Uniswap V3 (UV3) liquidity position so that
it can be closed at a defined yield target by an untrusted external party
— without giving anyone custody, without requiring the owner to be online
to act, and without the executor needing permission from the owner. The
owner receives a deterministic payout (original deposit plus a pre-set
yield target); the executor takes whatever residual the price movement
leaves behind. The mechanism is a clean Owner/Executor role split
expressed through staking semantics: the continuous swap and fee activity
of a UV3 position is collapsed into discrete, executor-friendly
checkpoints. The vault is economically equivalent to running the
underlying UV3 position directly; what it provides is a different control
structure, not better returns.

## Context

A UV3 position behaves under yield-farming semantics: continuous internal
swaps along the chosen range, continuous fee accrual, and no natural
stopping point at which an external party could safely act on the owner's
behalf. Closing the position requires the owner to be online at the right
moment and to make a swap-vs-spot decision that depends on real-time
market conditions.

The vault translates the position into staking semantics for the owner —
`Stake Principal`, `Unstake Principal`, `Collect Rewards` — while
introducing discrete `Swap` and `Settle` operations as the executor's
checkpoints. This collapse creates a clean trigger point for permissionless
automation: any keeper, MEV bot, or solver-adjacent helper can execute when
conditions favor them, and only when conditions favor them.

Background and equivalence proofs are in the concept document
`staking-semantics-uv3.md`. This RFC does not re-derive them; it specifies
the contract.

## Proposal

### Architecture

A factory deploys per-position vaults using EIP-1167 minimal proxies. Each
vault wraps exactly one UV3 position and is bound to exactly one owner,
set once at initialization and never mutable afterwards. There is no
transfer function, no ownership token, no upgrade path that could rebind
the owner.

This non-transferability is a hard requirement, not a default. Any
transferable representation of the position would break the holding-period
properties that the staking semantics are designed to provide. The
`immutable owner` declaration in the clone makes this constraint
structurally enforced rather than conventionally enforced.

The factory holds the implementation contract address, deploys clones via
`Clones.clone()` (or equivalent), and emits a `VaultCreated` event for
indexing. It does not retain control over deployed vaults.

A future "shared vault" architecture (one contract managing many
positions in a mapping) is a possible later layer but explicitly out of
scope for this RFC.

### Roles

Two first-class actors:

- **Owner** — provides the principal, sets the yield target, receives at
  least `(deposit + target)` back. The cap is essential for the executor
  incentive to work: every unit the owner does not take is a potential
  unit the executor can take, which is what makes external execution
  attractive in the first place.
- **Executor** — any external party. Closes the position by participating
  in `swap()`, `flashSwap()`, or `settle()`. Profits when timing is
  favorable, bears the loss otherwise. Self-selects: nobody is required
  to execute, and only those who find the moment profitable will. There
  is no allowlist and no relayer network the owner has to trust.

The owner can also act as their own executor — through `swap()` (which
is owner-only and supports partial close), through `flashSettle()` (the
helper-callback exit path), or by combining functions in `multicall()`.

### Lifecycle and state machine

The vault progresses through a small state machine:

```
Empty ──stake()──▶ Staked ──swap() (partial)────────┐
                     │  ▲                            │
                     │  │  setYieldTarget()          │
                     │  │  stakeTopUp()              │
                     │  │  swap() (partial returns)  │
                     │  └────────────────────────────┘
                     │
                     │  swap() (full) | flashSwap |
                     │  settle | flashSettle (full)
                     │
                     ├─◄ FlashSwapInProgress (transient, callback frame)
                     ├─◄ FlashSettleInProgress (transient, callback frame)
                     ▼
                  Settled ──unstake()/claimRewards()──▶ (drained)
```

States:

- **`Empty`** — clone deployed but `stake()` not yet called. Initial state
  after factory deployment.
- **`Staked`** — UV3 position is open. Yield target is mutable in this
  state. `swap()`, `flashSwap()`, `settle()`, or `flashSettle()`
  transitions out.
- **`FlashSwapInProgress`** — entered for the duration of a `flashSwap()`
  call. All other vault functions revert from this state. Exits back to
  `Staked` or to `Settled` (full close) when the callback returns
  successfully.
- **`FlashSettleInProgress`** — entered for the duration of a
  `flashSettle()` call. Same lock semantics as
  `FlashSwapInProgress`.
- **`Settled`** — vault has fully closed its UV3 position. `unstake()`
  and `claimRewards()` are callable to drain the buffers. Terminal state.

Note that **partial swap** keeps the vault in `Staked`. The buffers
accumulate across multiple partial settlements; the position-side liquidity
shrinks. The transition to `Settled` occurs only when the close fraction
reaches the full remaining position liquidity.

`unstake()` and `claimRewards()` are callable in `Staked` and `Settled`,
so partial settlements can be drained mid-lifecycle.

### Stake parameters

`stake()` takes three parameters:

```solidity
function stake(
    StakeParams calldata positionParams,
    bool isToken0Quote,
    uint256 yieldTarget
) external returns (uint256 tokenId);
```

`StakeParams` mirrors UV3's `INonfungiblePositionManager.MintParams`
struct, with the `recipient` field omitted (the vault clone is always the
recipient of the resulting NFT):

```solidity
struct StakeParams {
    address token0;
    address token1;
    uint24 fee;
    int24 tickLower;
    int24 tickUpper;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
}
```

`isToken0Quote` defines which of the two pool tokens is the quote token.
UV3 itself only knows about token0/token1 (sorted by address); quote
denomination is a convention applied on top.

`yieldTarget` is denominated in the smallest units of the quote token
(e.g. `400_000_000` for 400 USDC) and may be set to zero (no bonus,
fee-folding only) or to a sentinel value that effectively disables
external execution (see [Yield target](#yield-target) below).

`stake()` is callable in `Empty` for the initial mint; subsequent capital
top-ups go through `stakeTopUp(TopUpParams)` while in `Staked`. The
top-up scales `yieldTarget` proportionally by the quote-side delta so the
implicit yield rate stays constant.

### Yield target

The yield target is the central configuration parameter from the owner's
perspective. It defines exactly how much in addition to the original
deposit the owner will receive when the position is settled.

**Format.** `uint256` in smallest quote-token units. No basis points, no
percentage of principal, no separate base/quote split. A single absolute
quote-denominated number.

**Mutability.** Settable via `setYieldTarget()` while in state `Staked`.
Reverts in any other state. The target can be raised, lowered, or
disabled at any time before settlement begins. There are no in-flight
operations that pin the target.

**Sentinel for "let it run".** A yield target of `type(uint256).max` is
the canonical sentinel for disabling external execution: no executor
can profitably bring in the required quote, so `swap()` and
`flashSwap()` are effectively never triggered by an external party. The
owner can lift this at any time by calling `setYieldTarget()` to put the
position back in play. This overloads the same dial — no separate
pause/lock function is needed.

**Slippage protection on the executor side.** Because the target is
mutable while in `Staked`, an executor calling `swap()` or
`flashSwap()` faces a front-running risk: the owner could raise the
target between the executor's quote and the transaction. Both functions
take slippage parameters (`amountInMax`, `amountOutMin`) at the call
site, with which the executor protects itself. There is no separate
`maxYieldTarget` parameter — the slippage check on the realised swap
amounts captures the same protection more directly.

**Owner outcome.** The owner receives at least `(deposit + yieldTarget)`
on regular settlement. Cases 2 and 3 (executor-driven swap) deliver
exactly that minimum; the rest flows to the executor as their reward.
Case 1 (`settle()` path) delivers exactly that minimum and routes any
surplus over `(B, Q + T)` to the bounty recipient (typically the
permissionless caller — see [`settle()` and the bounty
mechanism](#settle-and-the-bounty-mechanism) below). The
`flashSettle()` path delivers at least the minimum, with any helper
overpayment flowing to the owner via the reward buffer.

**Reward direction.** Quote-denominated target. Rewards drain through
`claimRewards()` and may include both base and quote components
depending on the path: regular `swap()` settlement leaves only
quote-side surplus in the reward buffer (base side is taken by the
executor); `flashSettle()` may produce surplus on either side via
helper overpayment. Both are paid out to the owner.

### LVR economics and case classification

A UV3 position trades along its range to the average of its bid and ask
prices, which is structurally below current spot whenever the price has
moved through the range. This is the LVR (loss-versus-rebalancing)
phenomenon. The vault exposes this LVR to the executor as the offered
swap rate: the executor accepts a below-spot trade in exchange for the
position's accumulated fees, and the owner accepts that trade in exchange
for the executor closing the position on demand.

**Classification.** When the vault closes its position (or a fraction
thereof), it splits the released amounts into a *target balance*
`(targetBase, targetQuote)` corresponding to the deposit-plus-yield-target
fraction, and compares against the actually released `(b, q)`:

- `targetBase = B × frac`, `targetQuote = (Q + T) × frac`, where
  `frac = liquidityClosed / positionLiquidity`.
- `(b, q)` includes the principal released via `decreaseLiquidity()` plus
  all uncollected fees (UV3's `collect` is all-or-nothing).

Four cases:

| Case | Condition | Mechanic |
|------|-----------|----------|
| 1 | `b ≥ targetBase AND q ≥ targetQuote` | `NoSwapNeeded` — buffers fill from `(B, Q+T) × frac`; surplus over that is the bounty (in `settle()`) or flows to reward buffer (in `flashSettle()`) |
| 2 | `b ≥ targetBase AND q < targetQuote` | Executor sends quote, receives base at LVR rate |
| 3 | `b < targetBase AND q ≥ targetQuote` | Executor sends base, receives quote at LVR rate |
| 4 | `b < targetBase AND q < targetQuote` | `Underwater` — only reachable when `T > 0` (see below) |

The classification is total under priority order Case-3-first (`b ≥ ∧
q ≥`) then Case-2-bias (`b ≥`) then Case-1-bias (`q ≥`) then Case-4.
Boundary equalities resolve by the `≥` comparisons.

**No oracle.** Every case computes its quantities entirely from on-chain
state: `pool.slot0()` for the current sqrt price, `npm.positions()` for
liquidity and uncollected fees. There is no TWAP read, no Chainlink feed,
no off-chain oracle dependency. The LVR rate is implicit in the close
quantities; the executor accepts or declines based on the rate they see.

**Why Case 4 is reachable only with `T > 0`.** A UV3 position close
satisfies one of two invariants depending on price drift direction:
- price up: `b ≤ B AND q ≥ Q`
- price down: `b ≥ B AND q ≤ Q`

Plus non-negative fee accrual: `(b, q) ≥ (b_principal, q_principal)`.
Therefore, Case 4 (`b < B ∧ q < Q + T`) requires the price-up branch
(forcing `q ≥ Q`) AND `q < Q + T` AND `fees_quote < T − (q_principal − Q)`.
At `T = 0`, the condition `q < Q + 0 = Q` contradicts `q ≥ Q`, so Case 4
is mathematically unreachable. At `T > 0`, Case 4 corresponds to "the
position has not yet earned the yield target the owner is demanding."

This gives the owner a deterministic escape hatch from Underwater:
calling `setYieldTarget(0)` (or any `T_new ≤ q − Q`) converts the case
to Case 2 (or 1), making the position settle-able by external executor
again. The owner can also escape via `flashSettle()` with a helper
that bridges the deficit.

### Settlement paths

Four entry points cover the matrix of (caller, partial vs. full,
trade vs. no-trade):

| Function | Caller | Cases | Close size | Token movement |
|----------|--------|-------|------------|----------------|
| `swap()` | owner | 2, 3 | partial or full | atomic in/out |
| `flashSwap()` | permissionless | 2, 3 | full | callback push/pull |
| `settle()` | permissionless | 1 | full | bounty push only |
| `flashSettle()` | owner | 1, 2, 3, 4 | partial or full | callback push/pull |

The split is intentional: no function does double duty, no parameter
encodes a behaviour switch, and each case has at most two valid entry
points (one owner-facing, one permissionless).

#### `swap()` — owner trade

`swap()` is the owner's free-trade interface. It mirrors the UV3
`SwapRouter` shape (caller perspective: `tokenIn` is what the caller
pays, `tokenOut` is what the caller receives) and accepts an explicit
`liquidity` parameter for the close fraction. The vault dictates the
LVR-implied rate; the caller dictates the close size and slippage
bounds:

```solidity
function swap(
    uint128 liquidity,
    address tokenIn,
    uint256 amountInMax,
    address tokenOut,
    uint256 amountOutMin,
    address recipient,
    uint256 deadline
) external onlyOwner returns (uint256 amountIn, uint256 amountOut);
```

The function reverts with case-specific errors outside Cases 2/3
(`UseSettleInsteadOfSwap` for Case 1, `UseFlashSettleInsteadOfSwap`
for Case 4). This keeps the function's contract clean: when `swap()`
runs, the trade direction is unambiguous and the caller knows which
side they are paying.

The `liquidity` parameter — denominated in NFPM liquidity units —
explicitly communicates the close fraction. Owner can call repeatedly
with smaller fractions; buffers accumulate; T scales down proportionally
on each call so the remaining position still carries the right
yield-rate anchor.

#### `flashSwap()` — permissionless trade

`flashSwap()` is the keeper-facing variant of `swap()`. It is
permissionless, always full-close, and uses a push/callback/verify
pattern that lets the executor source the input token from external
liquidity (a flash loan, a CoW-adjacent route, an AMM) without
pre-funding the vault:

```solidity
function flashSwap(
    address tokenIn,
    uint256 amountInMax,
    address tokenOut,
    uint256 amountOutMin,
    address callbackTarget,
    bytes calldata data,
    uint256 deadline
) external returns (uint256 amountIn, uint256 amountOut);
```

Sequence within the call:

1. Vault closes the entire UV3 position, computes `(b, q)`, classifies.
2. Vault validates that `tokenIn`/`tokenOut` match the case's expected
   direction; reverts on mismatch.
3. Vault transfers `amountOut` to `callbackTarget` and emits
   `FlashSwapInitiated`.
4. Vault enters `FlashSwapInProgress`.
5. Vault calls `IFlashSwapCallback.flashSwapCallback(...)` on the
   callback target, passing `(tokenIn, amountInMin, tokenOut,
   amountOut, data)`.
6. Callback runs. It is responsible for sourcing `amountIn` of
   `tokenIn` and transferring at least that amount to the vault.
7. Vault verifies its `tokenIn` balance has grown by at least
   `amountInMin`; reverts otherwise.
8. Vault settles buffers, transitions to `Settled`, emits `Swap`.

Why full-close only: a partial `flashSwap` would scale the yield target
T proportionally to the closed fraction. If the vault is in Cases 2/3
*now* but the post-partial-close vault is *not* (because price drifts
in the wrong direction), the residual T might never be reached. The
owner's yield-target promise would hold mathematically but become
unreachable in practice. Owner-driven partial close is a deliberate
choice (the owner accepts the trade-off); permissionless partial close
is not.

The slippage parameters express the executor's intent at off-chain
quote time. The vault enforces them, but does not protect against
under-specified intents — that is the executor's job.

#### `settle()` and the bounty mechanism

`settle()` covers Case 1: the position has drifted such that both
target conditions are simultaneously satisfied without any swap being
necessary. No executor-trade-side incentive exists here (no LVR
discount because no trade), so `settle()` introduces an explicit
**bounty** to incentivise permissionless settlement:

```solidity
function settle(address recipient, uint256 deadline)
    external returns (uint256 baseBounty, uint256 quoteBounty);
```

Mechanic:
- Vault closes the entire position, computes `(b, q)`.
- Reverts unless Case 1.
- Buffers fill with exactly `(B, Q)` for unstake and `(0, T)` for
  reward. Owner gets exactly the promised `(deposit + target)`.
- The surplus `(b − B, q − Q − T)` is transferred to `recipient` as
  bounty.

Why the bounty exists. Without it, no permissionless party would call
`settle()`: there is no LVR profit, only gas cost. The owner would
have to monitor and trigger settlement themselves, defeating the
"yield target reached → position closes automatically" property. The
bounty creates a market for permissionless settlement at exactly the
moment when the owner most wants it (yield target satisfied, no
external trade needed).

Why the bounty is bounded in practice. Case 1 only arises when the
position drifts such that both `b ≥ B` and `q ≥ Q + T` simultaneously.
Whenever a strict inequality on either side exceeds dust by a margin,
the position is already in Case 2 or Case 3, where a `flashSwap()`
keeper would have settled it earlier with the executor capturing the
trade-side reward. Case 1 is therefore an edge case that materialises
mostly when fee accrual nudges the position over both thresholds at
once. The bounty in that case is small — typically a few basis points
of position size, sometimes dust — but enough to make a permissionless
settle bot economically viable.

If the bounty is exactly zero (boundary case `b == B AND q == Q + T`),
`settle()` still runs successfully. No revert: the owner still
benefits from the position closure even if no caller profits. A
rational bot will not call in this case, but an altruistic / owner-run
bot can.

#### `flashSettle()` — owner exit with helper

`flashSettle()` is the owner's universal exit path with helper
support. It works in any case (1, 2, 3, 4) and supports partial close
via the `liquidity` parameter:

```solidity
function flashSettle(
    uint128 liquidity,
    address callbackTarget,
    bytes calldata data,
    uint256 deadline
) external onlyOwner;
```

Mechanic:
- Vault closes `liquidity` units of the position, computes
  `frac = liquidity / positionLiquidity`, computes
  `expectedBase = B × frac`, `expectedQuote = (Q + T) × frac`.
- Vault transfers the freed `(b, q)` amounts (as released by the close,
  whatever the pool yields at execution time) to `callbackTarget`.
- Vault enters `FlashSettleInProgress`.
- Vault calls `IFlashSettleCallback.flashSettleCallback(expectedBase,
  expectedQuote, data)`.
- Callback runs. It must transfer at least `(expectedBase,
  expectedQuote)` back to the vault. Overpayment is permitted and flows
  to the reward buffer.
- Vault verifies its base and quote balances have grown by at least
  `(expectedBase, expectedQuote)`; reverts otherwise.
- Vault fills `unstakeBuffer` with `(B × frac, Q × frac)`, fills
  `rewardBuffer` with the overpayment plus `T × frac` on the quote
  side; reduces `(B, Q, T)` proportionally; transitions state.
- Owner separately calls `unstake()` and `claimRewards()` to drain.

This is **not a swap**. The helper receives whatever the pool yields
on close; the helper must return the deposit-plus-target. Whether it
needs to swap, top up, or simply transfer back what it received
depends on the case classification at execution time. The helper is
typically a flash-loan-funded contract that bridges the case-dependent
deficit; the owner's only out-of-pocket cost is gas plus any flash-loan
fees plus any external swap slippage.

`callbackTarget == address(0)` reverts. `flashSettle()` is the
helper-callback entry point; the helper-free settle paths are
`swap()`, `settle()`, and the post-settlement drain calls.

**Buffer fill, no auto-drain.** Unlike the previous design (where
`flashClose()` auto-drained both buffers), the new `flashSettle()`
fills buffers and lets the owner drain via the standard `unstake()`
and `claimRewards()` calls. This makes the buffer accounting uniform
across all settlement paths: every settlement path fills buffers, every
drain path drains them. The owner can compose `flashSettle` +
`unstake` + `claimRewards` in a single `multicall` if the single-tx
behaviour of the previous design is desired.

### Buffer mechanics

The vault holds four token-indexed buffer slots that act as
intermediate accounting between settlement (which fills buffers) and
drain (which empties them):

```
unstakeBufferBase   — original base principal, owed to owner via unstake()
unstakeBufferQuote  — original quote principal, owed to owner via unstake()
rewardBufferBase    — base-side surplus, owed to owner via claimRewards()
rewardBufferQuote   — quote-side surplus (incl. yield target), owed via claimRewards()
```

Settlement-path fills:

| Path | unstakeBufferBase | unstakeBufferQuote | rewardBufferBase | rewardBufferQuote |
|------|---|---|---|---|
| `swap()` (Case 2) | `+= B × frac` | `+= Q × frac` | `+= b − B × frac` | `+= q + amountIn − (Q × frac)` |
| `swap()` (Case 3) | `+= B × frac` | `+= Q × frac` | `+= b + amountIn − (B × frac)` | `+= q − (Q × frac)` |
| `flashSwap()` (Case 2) | `+= B` | `+= Q` | `+= b − B` | `+= q + amountIn − Q` |
| `flashSwap()` (Case 3) | `+= B` | `+= Q` | `+= b + amountIn − B` | `+= q − Q` |
| `settle()` (Case 1) | `+= B` | `+= Q` | `+= 0` | `+= T` |
| `flashSettle()` | `+= B × frac` | `+= Q × frac` | `+= postBase − (B × frac)` | `+= postQuote − (Q × frac)` |

Where:
- `frac = liquidity / positionLiquidity` for partial paths; `1` for full.
- `(b, q)` is the freed delta from the position close (principal +
  uncollected fees).
- `amountIn` is the executor's payment in the trade-paths.
- `postBase, postQuote` are the actually-returned amounts from the
  `flashSettle` callback (`≥ B × frac`, `≥ (Q + T) × frac`
  respectively).

In all cases, the case-classification guarantees the reward-buffer
increments are non-negative.

Drain paths:

```solidity
function unstake() external onlyOwner;       // drains unstakeBuffer*
function claimRewards() external onlyOwner;  // drains rewardBuffer*
```

Both are callable in `Staked` (mid-lifecycle) and `Settled`. Both
revert if the relevant buffer is empty (no-op transactions are
explicit errors). Both can be called multiple times across the vault's
lifetime, once per fill cycle.

### Solver-network compatibility

The vault's settlement paths all preserve the **single-direction
property**: in any one settlement call, exactly one token moves into
the vault and exactly one token moves out (or none, in Case 1). This
is non-negotiable: it is what makes the vault compatible with limit-
order-based solver networks (Composable CoW, similar) that cannot
express "executor sends X base AND Y quote, receives Z quote" as a
single atomic intent.

The case classification ensures this property structurally. Cases 2
and 3 each fix a unique direction; Case 1 has no movement; Case 4 is
not permissionless-trade-eligible. There is no scenario in which a
single settlement call requires the executor to send both tokens.

Owner-side `swap()` calls and helper-callback paths
(`flashSwap`/`flashSettle`) are not subject to the single-direction
constraint at the *callback* level — a helper can internally do
multi-direction operations — but the *vault interface* preserves
single-direction. The vault sends one token, expects one token back.
The helper bridges the difference.

### Reentrancy

Every state-mutating function is guarded by OpenZeppelin's
`ReentrancyGuard.nonReentrant`. The standard guard handles
reentrant token callbacks (ERC-777, fee-on-transfer hooks, and so on).

In addition, `flashSwap()` and `flashSettle()` use explicit
state-lock states (`FlashSwapInProgress`, `FlashSettleInProgress`)
that all other vault functions check against and revert from. This is
a stronger semantic guard than `nonReentrant`: it makes the
"vault is mid-callback, no other operation may proceed" invariant
visible in the state machine, not just in a transient lock variable.

The two mechanisms compose: any reentrant attempt either (a) hits the
`nonReentrant` guard if it tries to re-enter the same function, or
(b) hits the state-lock if it tries to enter a different vault
function while a flash-callback frame is open.

### Multicall

The vault inherits OpenZeppelin's `Multicall` mixin (existing project
dependency). No modifications. Per-function state checks remain
authoritative — multicall does not bypass them.

Useful compositions:
- `[stakeTopUp, setYieldTarget]` — owner adds capital and re-anchors
  the yield rate atomically.
- `[swap, swap]` — owner partial-closes in two segments (e.g. for
  buffer-overflow protection in extreme cases).
- `[flashSettle, unstake, claimRewards]` — owner exits with helper
  and immediately drains, recovering the auto-drain ergonomics of the
  previous design.
- `[swap, unstake, claimRewards]` — owner self-executes a partial
  swap and immediately drains.

`multicall()` is callable in any state; per-call state checks gate
each individual function. An EIP-1167 clone composing OZ `Multicall`
incurs an extra delegatecall hop per inner call (clone delegates to
implementation; multicall delegatecalls back to the clone, which
delegates to implementation again); this is functionally correct but
slightly more gas per inner call than non-proxied multicall.

### Events

| Event | Signature | Emitted in |
|---|---|---|
| `VaultCreated` | `(address indexed owner, address indexed vault)` | factory, on clone deployment |
| `Stake` | `(address indexed owner, uint256 baseDelta, uint256 quoteDelta, uint256 yieldTargetAfter, uint256 indexed tokenId, uint128 liquidityDelta)` | `stake()` (initial and top-up) |
| `YieldTargetSet` | `(address indexed owner, uint256 oldTarget, uint256 newTarget)` | `setYieldTarget()`, top-up scaling |
| `Swap` | `(address indexed caller, address indexed recipient, uint128 liquidityClosed, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut)` | `swap()`, `flashSwap()` (after verification) |
| `FlashSwapInitiated` | `(address indexed caller, address indexed callbackTarget, uint128 liquidityClosed, address tokenIn, uint256 amountInMin, address tokenOut, uint256 amountOut, bytes data)` | `flashSwap()` (before callback) |
| `Settle` | `(address indexed caller, address indexed recipient, uint128 liquidityClosed, uint256 baseBounty, uint256 quoteBounty)` | `settle()` |
| `FlashSettleInitiated` | `(address indexed owner, uint128 liquidity, address indexed callbackTarget, bytes data)` | `flashSettle()` (before callback) |
| `FlashSettle` | `(address indexed owner, uint128 liquidityClosed, uint256 expectedBase, uint256 expectedQuote, uint256 baseReturned, uint256 quoteReturned)` | `flashSettle()` (after verification) |
| `Unstake` | `(address indexed owner, uint256 base, uint256 quote)` | `unstake()` |
| `ClaimRewards` | `(address indexed owner, uint256 baseAmount, uint256 quoteAmount)` | `claimRewards()` |

Indexer-side considerations:
- `Swap` is emitted by both `swap()` and `flashSwap()`. The
  presence of `FlashSwapInitiated` in the same tx distinguishes the
  flashSwap path from the owner-direct path.
- `FlashSettle` is emitted only by the flashSettle path; there is no
  ambiguity with other settlement paths.
- `Stake` is emitted on initial mint AND on top-up. The two are
  distinguished by the `tokenId` in storage being unset
  (initial) versus already set (top-up) — but indexer-side, both
  emit identically except that initial-stake `liquidityDelta` equals
  the full position liquidity at that moment.

## Alternatives considered

- **Naive yield-target trigger.** Make settlement callable only once
  `(b × spotPrice + q) ≥ (B × spotPrice + Q + T)`. Rejected because
  it is not automatable: the executor's price gain is not aligned with
  the trigger condition — an executor calling at the moment the
  trigger flips makes no profit, and a profitable executor would call
  before the trigger flips. The owner would have to monitor and
  execute themselves.
- **Mixed-direction swap (executor sends base AND quote, receives
  quote).** Rejected because it is incompatible with limit-order-based
  solver networks. Solvers express intents as "sell token X for
  token Y at limit Z"; mixed-direction swaps cannot be expressed this
  way. Single-direction settlement preserves solver-network
  compatibility.
- **5%-discount third case for surplus-on-both-sides.** An earlier
  version of this RFC proposed a Case-3 mechanic where the vault
  offered base for quote at a 5% discount below TWAP-spot. Rejected
  because (a) it required a TWAP oracle dependency the rest of the
  vault avoided, and (b) the bounty mechanism in `settle()` provides
  a cleaner incentive without the oracle. The mechanic is replaced
  by the `settle()` bounty: in the both-surplus case, the vault
  surrenders the surplus to whoever calls `settle()`, which is
  permissionless and economically equivalent to a discount but
  oracle-free.
- **Two-step swap with persisted `t_base` for Case 4.** An earlier
  version handled Case 4 (`b < B AND q < Q + T`) by closing the
  position with an over-allocation of base, settling step 1 with the
  executor, then exposing a second step where another (or the same)
  executor swapped quote-for-base at the previously-recorded TWAP rate.
  Rejected for the same reasons as the 5%-discount case (oracle
  dependency, complexity) plus the realization that Case 4 is
  reachable only with `T > 0` and the owner has a clean escape via
  `setYieldTarget(0)` or `flashSettle()`. The simpler model is to
  refuse permissionless settlement in Case 4 and provide owner-driven
  alternatives.
- **`pendingBps` / persistent partial-close directive.** An earlier
  version had the owner set a `pendingBps` slot that all subsequent
  settlements (executor-driven and owner-driven) would respect.
  Rejected because (a) it conflated two orthogonal concepts (yield
  target vs. close fraction), and (b) permissionless partial close
  carries the same yield-target risk as flashSwap-partial does (T
  scales down, may become unreachable). The new model removes the
  slot entirely: owner-driven `swap()` takes `liquidity` as a
  parameter, executor-driven `flashSwap()` is always full close.
- **Pre-authorized executor / keeper allowlist.** Avoids the
  structurally below-spot effective price by trusting a designated
  executor. Rejected because it costs trustlessness: the owner must
  trust the executor not to delay, censor, or extract value beyond
  what permissionless self-selection would allow. Below-spot pricing
  is the deliberate price we pay for keeping the system permissionless.
- **Streaming reward payout.** Continuous fee collection during the
  position's lifetime rather than discrete `claimRewards`. Rejected
  because it breaks predictability: the owner's outcome would no
  longer be a fixed `(deposit + target)` known at stake time,
  defeating the central proposition.
- **Singleton vault (one contract managing many positions).** Lower
  gas per position, but introduces internal NFT bookkeeping and
  weakens the non-transferability guarantee from `immutable owner` to
  a runtime check on a mapping. Deferred to a possible later layer;
  not in this RFC.
- **Built-in flash-loan provider integration.** Hardcoding Aave or
  Balancer as the flash-loan source. Rejected in favor of the
  callback pattern: the vault stays provider-agnostic, helpers are
  pluggable, and the vault is freed from flash-loan reentrancy logic.
- **Auto-drain in `flashSettle`.** Inherited from the previous
  design, where `flashClose` automatically called `unstake` and
  `claimRewards` at the end of the call. Rejected in the new
  design because (a) it breaks accounting symmetry across settlement
  paths (`swap`/`flashSwap`/`settle` fill buffers and stop), and
  (b) owners can recover the single-tx behavior via `multicall`. The
  buffer model becomes uniform: every settle path fills, every drain
  path drains.
- **`cancelStake()` to abort `Staked` back to `Empty`.** Returning the
  principal as deposited, with no settlement. Rejected because it
  bypasses the central settlement mechanism and would create an exit
  path the indexer must recognize. The owner exits via `flashSettle()`
  (single transaction) or `multicall([swap, unstake, claimRewards])`
  (multi-step). Both paths preserve the invariant that every staked
  position closes through a settlement.

## Open Questions

_None remaining. The interface and economic model are stable; ready
for implementation review and CoW-adapter design as a downstream
concern._

## Out of Scope

- Pool selection logic (covered by the LVR pool filter, separate
  concern).
- Range-width optimization within a chosen pool.
- Position re-ranging after `stake()` (positions are immutable for
  their lifetime; only liquidity top-up via `stakeTopUp`).
- Frontend and UX. The vault exposes contract-level primitives; UI is
  a separate workstream.
- Tax-reporting tooling. The vault provides the property; reporting
  tools consume the events.
- Hook integration for non-standard UV3 pools (Uniswap V4 hooks).
- Multi-chain deployment strategy. The vault is single-chain;
  cross-chain considerations (canonical addresses, factory parity)
  are separate.
- Singleton "shared vault" architecture as a future layer.
- CoW Protocol / solver-network adapter. Handled by a separate
  downstream contract that wraps `flashSwap()` and bridges to CoW's
  programmatic-order or settlement-callback APIs. The vault's
  permissionless `flashSwap()` is the integration point; the adapter
  is not part of this RFC.

## Decision provenance

- `[chat-confirmed]` Architecture: factory + EIP-1167 minimal proxy
  clones, one vault per position, `immutable owner`, no transfer.
- `[chat-confirmed]` Owner/Executor role split as the core mechanism;
  permissionless execution accepted with structurally below-spot
  pricing as the deliberate trade-off.
- `[chat-confirmed]` Yield target as `uint256` in smallest
  quote-token units; mutable in `Staked` only; `type(uint256).max` is
  the canonical sentinel value to disable external execution.
- `[chat-confirmed]` Four-case classification using only on-chain
  state (no oracle). LVR-implied rates in Cases 2/3; explicit bounty
  in Case 1; `Underwater` in Case 4.
- `[chat-confirmed]` Case 4 is reachable only when `T > 0`; owner has
  clean escape via `setYieldTarget(0)` or `flashSettle()`.
- `[chat-confirmed]` Four settlement entry points: owner-`swap()`
  (partial OK), permissionless-`flashSwap()` (full only),
  permissionless-`settle()` (Case 1 with bounty), owner-`flashSettle()`
  (any case, partial OK).
- `[chat-confirmed]` `liquidity` in NFPM units as the partial-close
  parameter; no `pendingBps` storage slot.
- `[chat-confirmed]` Executor-side slippage protection via
  `amountInMax`/`amountOutMin` parameters at the call site, no
  separate `maxYieldTarget`.
- `[chat-confirmed]` `swap()` follows UV3 SwapRouter convention
  (caller-perspective `tokenIn`/`tokenOut`, `recipient`,
  `deadline`).
- `[chat-confirmed]` `flashSwap()` permissionless, full-close,
  callback-pattern push/pull/verify, dedicated
  `FlashSwapInProgress` state-lock.
- `[chat-confirmed]` `settle()` permissionless, full-close, no
  trade, surplus-as-bounty to caller-specified recipient.
- `[chat-confirmed]` `flashSettle()` owner-only, partial OK, helper
  callback receives freed `(b, q)` and must return
  `(B × frac, (Q + T) × frac)`. Overpayment flows to reward
  buffer.
- `[chat-confirmed]` No auto-drain in `flashSettle`; uniform
  fill-buffers-then-drain pattern across all paths.
- `[chat-confirmed]` `multicall()` via OpenZeppelin `Multicall`
  mixin.
- `[chat-confirmed]` Single-direction property preserved across all
  settlement paths for solver-network compatibility.
- `[chat-confirmed]` `Stake` event includes `tokenId` and
  `liquidityDelta` for indexer convenience without per-vault view
  calls.
