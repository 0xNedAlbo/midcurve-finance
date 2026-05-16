# RFC-0001: Midcurve Keeper Standard

**Status:** Draft
**Date:** 2026-05-16
**Audience:** Implementers of Maker Contracts and Taker Bots

---

## 1. Purpose

The Midcurve Keeper Standard defines a uniform on-chain interface
between two roles: **Makers** — smart contracts that publicly offer
trades or paid maintenance actions — and **Takers** — off-chain bots
or smart contracts that observe these offers and execute them when
profitable. The standard is the minimum vocabulary required so that
any compliant Maker can be discovered and served by any compliant
Taker, without prior coordination between them.

The standard exists because existing automation patterns (CoW Protocol
hooks, Gelato Automate, Chainlink Automation) all impose either a
solver-orchestrated execution model, a subscription model, or a
centralized scheduling layer. None of them fit the case where a smart
contract holds tokens or productive positions and wants to offer
specific actions for permissionless execution against a self-funded
bounty mechanism. The standard fills exactly that gap.

A Maker Contract publishes a continuous offer through one or more
typed quote functions; a Taker Bot polls these functions, evaluates
profitability off-chain, and executes the offer through the
corresponding fill function. Settlement is atomic within a single
transaction. Token ownership is verified through balance deltas
observed by the Maker after a callback into the Taker. The Maker is
the orchestrator of every fill; the Taker is the orchestrator of its
own polling, profitability evaluation, and capital sourcing.

The standard is permissionless on both sides: anyone can deploy a
compliant Maker, anyone can run a compliant Taker, and there is no
privileged coordinator. Discovery is mediated by a permissionless
on-chain Registry, deployed once per chain.

---

## 2. Definitions and Roles

**Maker Contract** — A smart contract that implements at least one of
the Maker interfaces defined in §6 (`ISellLimitMaker`, `IBuyLimitMaker`,
`IBountyMaker`). The Maker Contract is the orchestrating party in any
fill: it pushes tokens out, calls into the Taker, and verifies the
result. The Maker controls the conditions under which an offer is
acceptable.

**Taker Bot** — Any actor — typically off-chain software backed by an
on-chain helper contract — that polls Maker Contracts via their `quote*`
functions, evaluates profitability, and submits transactions calling
the Maker's `fill*` functions. The Taker Bot is the discovery and
profitability layer; the Maker decides whether to accept the proposal.

**Registry** — A single permissionless smart contract deployed once
per chain at a known address. It maintains a list of registered Makers
and emits lifecycle events that Taker Bots use for discovery.

**Order Type** — One of the three categories of offer defined by this
standard: SellLimit, BuyLimit, and Bounty. A Maker MAY implement any
subset of the three; each implemented Order Type exposes at most one
active Quote at a time.

**Quote** — The data returned by a Maker's `quote*` function for a
given Order Type. Always includes a `QuoteState` field plus type-
specific order parameters.

**Fill** — The execution of an Order Type's `fill*` function by a
Taker. Each fill is atomic within a transaction; partial fills are
supported where indicated by the Quote.

---

## 3. Architecture Overview

```
                    ┌─────────────────────────┐
                    │         Registry        │
                    │      (one per chain)    │
                    │                         │
                    │  emits MakerRegistered, │
                    │  MakerDeregistered,     │
                    │  InterfacesUpdated      │
                    └────────────┬────────────┘
                                 │
                                 │ events / view calls
                                 ▼
       ┌─────────────────────────┴─────────────────────────┐
       │                                                   │
       ▼                                                   ▼
┌─────────────┐                                    ┌──────────────┐
│   Maker     │ ◄──── quote* (view) ─────────────  │  Taker Bot   │
│  Contract   │                                    │              │
│             │ ◄──── fill* (state-changing) ───── │  + on-chain  │
│  pushes,    │                                    │   helper     │
│  callbacks, │ ──── on*Fill (callback) ─────────► │              │
│  verifies   │                                    │  pulls funds,│
└─────────────┘                                    │  performs    │
                                                   │  swap, etc.  │
                                                   └──────────────┘
```

The Maker Contract is the on-chain anchor: it owns the position, the
inventory, or the maintenance task. The Taker Bot is the off-chain
brain plus an on-chain helper contract that implements the callback
interfaces defined in §6.

A Maker advertises itself by calling `register` on the Registry. A
Taker Bot subscribes to Registry events to learn about new and removed
Makers. The Taker Bot polls each Maker's `quote*` functions
periodically; when a Quote is executable and profitable, the Taker
Bot submits a transaction that calls the Maker's `fill*` function.

The fill flow follows the **push-callback-verify** pattern in all
cases:

1. The Taker calls `fill*` on the Maker.
2. The Maker validates the call and prepares the resources to be sent.
3. The Maker pushes tokens to the Taker via `transfer`.
4. The Maker calls back into the Taker via the appropriate callback
   interface.
5. The Taker performs whatever work it needs (e.g., swapping tokens
   on a market) and pushes the required return tokens back to the
   Maker via `transfer`.
6. The callback returns; the Maker verifies the result by inspecting
   its own balance delta.
7. The Maker accepts the result or reverts the entire transaction.

This pattern provides atomic settlement with no need for token
approvals on either side and no need for the Maker to know how the
Taker sources its capital. The Taker may use flash loans, market
swaps, owned inventory, or any combination — invisible to the Maker.

---

## 4. Common Types

### 4.1 `QuoteState`

Every Quote returned by a Maker carries a lifecycle indicator:

```solidity
enum QuoteState {
    NO_QUOTE,         // no quote currently available; may become available later
    QUOTE_AVAILABLE,  // quote details are populated and the offer is live
    TERMINATED        // maker is done with this order type, will never quote again
}
```

`QuoteState.TERMINATED` is **monotonically final** for the Order Type
on which it was returned: a Maker that returns `TERMINATED` from a
specific `quote*` function MUST NOT subsequently return
`QUOTE_AVAILABLE` from that same function. Other `quote*` functions
on the same Maker may continue to operate normally; `TERMINATED` is
per-interface, not per-Maker.

`QuoteState.NO_QUOTE` is non-final and provides no information about
when (or whether) a Quote will become available next. Taker Bots
SHOULD treat repeated `NO_QUOTE` responses as a signal to reduce
polling frequency, but MUST continue treating the Maker as potentially
active until either `TERMINATED` is observed on every implemented
interface, or the Maker is deregistered.

### 4.2 ERC-165 Interface Identifiers

Each Maker interface defined in §6 has a corresponding ERC-165
interface identifier. Maker Contracts declare which subset of Maker
interfaces they implement by passing these identifiers to the
Registry on registration (§5.3) and by returning `true` for each one
from `supportsInterface` (§4.3).

The identifiers are derived from the function selectors of each
interface. To protect third-party implementations from silent breakage
if interface signatures change, this standard pins them to literal
hex values:

```solidity
bytes4 constant ISELL_LIMIT_MAKER_ID = 0x51d575fb;
bytes4 constant IBUY_LIMIT_MAKER_ID  = 0x79474512;
bytes4 constant IBOUNTY_MAKER_ID     = 0xe7601702;
```

These constants MUST equal `type(I).interfaceId` for the interface
definitions in this RFC. Any future change to the function signatures
of `ISellLimitMaker`, `IBuyLimitMaker`, or `IBountyMaker` (including
function renames, parameter type changes, or parameter reordering)
invalidates the pinned identifiers and is therefore a breaking change
requiring a new RFC version.

Implementations SHOULD include a self-test that recomputes the
interface IDs from the interface ABIs at build time and asserts
equality against the pinned literals. This catches signature drift
before deployment.

### 4.3 ERC-165 Support Declaration

Every Maker Contract MUST implement ERC-165 (`supportsInterface(bytes4)`)
and return `true` for each of the following:

- The ERC-165 interface identifier itself (`0x01ffc9a7`).
- Each Maker interface identifier (§4.2) that the Maker implements.

The Maker MUST NOT return `true` for an interface identifier whose
corresponding `quote*` and `fill*` functions are not implemented. A
Maker that returns `true` for `ISELL_LIMIT_MAKER_ID` without
implementing `quoteSellLimit` and `fillSellLimit` is non-conformant.

Maker authors SHOULD implement `supportsInterface` as a small
constant-time lookup. The Registry forwards a limited gas stipend to
the staticcall during registration (§5.3); implementations that
exceed this stipend will fail to register. A simple `if`-chain or a
50-entry lookup table fits comfortably within the budget.

Taker Bots and other off-chain consumers MAY use `supportsInterface`
to verify Maker capabilities before sending a `fill*` transaction.
The standard does not require this — the Registry already verifies
interface support at registration time — but it is sound practice
when the Taker has not itself observed the `MakerRegistered` event.

---

## 5. Registry

### 5.1 Purpose

The Registry serves a single function: it allows Makers to make
themselves discoverable, and emits events that Taker Bots subscribe
to in order to track which Makers exist. The Registry does not
mediate quotes, execute fills, hold tokens, or evaluate Maker
correctness. It is purely a directory.

A single Registry contract is deployed once per supported chain. The
Registry is non-upgradeable, has no admin, no paused state, no
ownership, and no fee mechanism. Once deployed, its behaviour is
fixed for the lifetime of the chain.

### 5.2 Interface

```solidity
interface IMidcurveKeeperRegistry {
    // ─── Types ────────────────────────────────────────────────

    struct Listing {
        address    maker;
        bytes4[]   supportedInterfaces;
        uint256    registeredAt;
        bool       active;
    }

    // ─── Events ───────────────────────────────────────────────

    event MakerRegistered(
        address indexed maker,
        bytes4[] supportedInterfaces,
        uint256 timestamp
    );

    event MakerDeregistered(
        address indexed maker,
        uint256 timestamp
    );

    event InterfacesUpdated(
        address indexed maker,
        bytes4[] supportedInterfaces,
        uint256 timestamp
    );

    // ─── Errors ───────────────────────────────────────────────

    error MakerAlreadyActive(address maker);
    error MakerNotActive(address maker);
    error EmptyInterfaceList();
    error InterfaceNotSupported(address maker, bytes4 interfaceId);
    error ERC165CheckFailed(address maker, bytes4 interfaceId);

    // ─── State-changing functions ─────────────────────────────

    function register(bytes4[] calldata supportedInterfaces) external;
    function deregister() external;
    function updateInterfaces(bytes4[] calldata supportedInterfaces) external;

    // ─── View functions ───────────────────────────────────────

    function isRegistered(address maker) external view returns (bool);
    function getListing(address maker) external view returns (Listing memory);
    function getAllMakers() external view returns (address[] memory);
    function getActiveMakers() external view returns (address[] memory);
    function getMakerCount() external view returns (uint256);
    function getActiveMakerCount() external view returns (uint256);
}
```

The `Listing` struct's `supportedInterfaces` array reflects the
caller's most recent registration input exactly. The Registry stores
the array verbatim: array order is preserved, and duplicate entries
(if any) are re-checked for ERC-165 support but not deduplicated.
Off-chain consumers MAY use array order to communicate preference
(e.g., preferred-interface-first dispatch in client libraries).

The five custom errors are part of the Registry's external surface.
Taker Bots and other off-chain monitors that parse revert reasons
from Registry-targeting transactions MUST be able to decode all five
to correctly classify failures.

### 5.3 Behaviour

#### `register(supportedInterfaces)`

A Maker calls `register` to make itself discoverable. The Registry:

1. Reverts with `MakerAlreadyActive(msg.sender)` if the caller is
   currently active in the registry.
2. Reverts with `EmptyInterfaceList()` if `supportedInterfaces` has
   zero length.
3. For each `interfaceId` in `supportedInterfaces`, performs an
   ERC-165 staticcall to `msg.sender.supportsInterface(interfaceId)`,
   forwarding a **30,000-gas stipend**. The two failure modes are
   distinguished:
   - **`ERC165CheckFailed(msg.sender, interfaceId)`** if the
     staticcall reverts, runs out of gas within the stipend, returns
     a non-32-byte payload, or otherwise produces a result that
     cannot be decoded as a `bool`. This includes the case where
     `msg.sender` has no bytecode (EOA or empty-codesize contract):
     the staticcall returns `success = true` with empty data, and the
     decode failure maps to `ERC165CheckFailed`.
   - **`InterfaceNotSupported(msg.sender, interfaceId)`** if the
     staticcall succeeds and returns `false`.

   The two failure modes are kept distinct because a third-party
   monitor needs them to be: `ERC165CheckFailed` indicates the Maker
   contract is broken or non-existent; `InterfaceNotSupported`
   indicates the Maker is well-formed but has misstated its
   interface set.
4. Stores the `Listing`:
   - `maker = msg.sender`
   - `supportedInterfaces = supportedInterfaces` (verbatim, see §5.2)
   - `registeredAt = block.timestamp`
   - `active = true`
5. If this is the caller's first ever `register` call, appends
   `msg.sender` to the all-makers array. On re-registration after a
   prior `deregister`, the all-makers array is NOT extended — the
   address remains at its original index. `registeredAt` is reset to
   the new `block.timestamp`. `supportedInterfaces` is overwritten.
6. Emits `MakerRegistered(msg.sender, supportedInterfaces, block.timestamp)`.

Maker authors MUST size their `supportsInterface` to fit within the
30,000-gas stipend. Implementations that exceed it will fail to
register with `ERC165CheckFailed`, even though their underlying logic
would have returned `true` given sufficient gas. The stipend matches
OpenZeppelin's `ERC165Checker` reference behaviour.

#### `deregister()`

A Maker calls `deregister` to remove itself from the active set:

1. Reverts with `MakerNotActive(msg.sender)` if the caller is not
   currently active.
2. Sets `listings[msg.sender].active = false`. The
   `supportedInterfaces` and `registeredAt` fields are retained
   unchanged: `getListing` continues to return the last-known
   interface list and original timestamp for deregistered Makers.
   This preserves forensic information for off-chain consumers.
3. Emits `MakerDeregistered(msg.sender, block.timestamp)`.

A deregistered Maker MAY re-register later by calling `register`
again. See `register` step 5 for the effect on `registeredAt` and
the all-makers array.

#### `updateInterfaces(supportedInterfaces)`

A currently-active Maker calls `updateInterfaces` to change its
declared interface set. The Registry:

1. Reverts with `MakerNotActive(msg.sender)` if the caller is not
   currently active.
2. Reverts with `EmptyInterfaceList()` if `supportedInterfaces` has
   zero length.
3. Performs the same ERC-165 staticcall verification as `register`
   step 3, with the same two failure modes.
4. Overwrites `listings[msg.sender].supportedInterfaces` with the
   new array (verbatim, same storage discipline as `register`).
   `registeredAt` is NOT modified.
5. Emits `InterfacesUpdated(msg.sender, supportedInterfaces, block.timestamp)`.

Typical uses include: a Maker gaining support for a new Order Type
after an upgrade in its off-chain logic; a Maker losing support for
an Order Type it can no longer service; or a Maker reordering its
interface array to express a new preference ordering to off-chain
consumers.

#### View functions

`isRegistered(maker)` returns `listings[maker].active`. O(1).

`getListing(maker)` returns the full `Listing` struct, regardless of
the current `active` state. O(1).

`getAllMakers()` returns the full append-only array of every address
that has ever successfully registered, including currently-inactive
ones. The array order is the order of first registration.

`getActiveMakers()` returns the subset of the all-makers array
filtered to entries where `active == true`. Order matches the
all-makers array, not registration recency.

`getMakerCount()` returns `getAllMakers().length`. O(1).

`getActiveMakerCount()` returns `getActiveMakers().length`. Has the
same O(N) cost as `getActiveMakers()` because the count requires
iterating to filter.

The two iterating views (`getActiveMakers` and `getActiveMakerCount`)
grow linearly with the total number of Makers ever registered.
Callers SHOULD prefer event-based discovery (subscribing to
`MakerRegistered` and `MakerDeregistered`) for production use. The
view functions are intended for one-shot inspection from scripts and
block explorers.

### 5.4 Spam Resistance

The Registry has no economic barrier to registration: no stake, no
fee, no ownership-gated allow-list. Spam resistance comes from three
layered mechanisms:

1. **Deployment cost.** Every Maker is a deployed smart contract.
   Even on cheap L2s, deploying a contract that implements ERC-165
   plus at least one Maker interface incurs nontrivial gas cost.
   Mass spam requires mass deployment.

2. **ERC-165 verification on registration.** The Registry calls
   `supportsInterface` on the Maker for every declared interface,
   bounded by a 30,000-gas stipend. Contracts without ERC-165, EOAs,
   empty-codesize targets, and pathologically expensive
   `supportsInterface` implementations all fail to register
   (mapping to `ERC165CheckFailed`). Contracts whose ERC-165 returns
   `false` for a declared interface fail with `InterfaceNotSupported`.

3. **Off-chain Quote validation by Taker Bots.** Taker Bots SHOULD
   call each declared Maker interface's `quote*` function once after
   discovery and verify the response is well-formed (decode
   succeeds, token addresses are non-zero, amount fields are within
   sensible bounds, etc.). Makers that fail this validation MAY be
   blacklisted by individual Bots indefinitely. This filter is
   entirely off-chain and at the discretion of each Bot operator.

The three mechanisms are intentionally orthogonal: the first imposes
real-world cost, the second eliminates malformed and trivially-broken
Makers at registration time, and the third filters semantically-
broken Makers at discovery time. None alone is sufficient against
a determined attacker; together they make registration spam
economically uninteresting.

### 5.5 Registry Deployment

The Registry contract has no constructor parameters: it is fully
self-contained. A single deployment per chain is sufficient and
canonical.

Registry addresses for each supported chain are published in the
Midcurve documentation as deployments become available. The
Registry MUST NOT be upgradeable; if the standard evolves in a way
that requires a Registry change, a new Registry is deployed at a
new address and Makers re-register there. The previous Registry
remains operational for as long as Makers and Takers continue to
use it; coexistence of multiple Registry versions on the same chain
is allowed by the standard.

---

## 6. Order Types

The standard defines three Order Types: SellLimit, BuyLimit, and
Bounty. Each has a Maker-side interface (offering and fulfilling) and
a Taker-side callback interface (receiving and responding). A Maker
MAY implement any subset of the three interfaces; each implemented
interface exposes at most one active Quote at any time.

Throughout this section, the terms `sellToken` / `buyToken` /
`bountyToken` refer to the Maker's perspective on the trade. The
Taker-side callback parameters use the same naming so that token
direction is unambiguous in both halves of a fill.

### 6.1 SellLimit

The Maker offers a fixed quantity of `sellToken` for sale, requiring
a minimum quantity of `buyToken` in return. The Taker receives the
`sellToken` first, then provides at least the required `buyToken`
back to the Maker.

#### 6.1.1 Quote

```solidity
struct SellLimitQuote {
    QuoteState state;
    address    sellToken;
    uint256    sellAmount;
    bool       allowPartials;
    uint256    minSellRemainder;
    address    buyToken;
    uint256    minBuyAmount;
    uint256    quoteValidUntil;
    bytes      extraData;
}
```

- `sellAmount` is the maximum quantity of `sellToken` available in
  this Quote.
- `minBuyAmount` is the minimum quantity of `buyToken` the Maker
  requires for the full `sellAmount`. Linear scaling applies for
  partial fills (see §6.1.3).
- `allowPartials` controls whether the Taker may take less than the
  full `sellAmount`. If `false`, the Taker MUST consume `sellAmount`
  exactly.
- `minSellRemainder`, when `allowPartials == true`, defines the
  minimum size of any leftover `sellAmount` after a partial fill.
  The Taker MUST either consume `sellAmount` exactly, or leave at
  least `minSellRemainder` of `sellToken` unsold. Set
  `minSellRemainder = 0` to allow any partial size.
- `quoteValidUntil` is a polling hint expressing the Unix timestamp
  until which the Quote is expected to remain valid. See §6.5.
- `extraData` is an opaque, Maker-defined informational field. See
  §6.4.

#### 6.1.2 Maker Interface

```solidity
interface ISellLimitMaker {
    function quoteSellLimit() external view returns (SellLimitQuote memory);

    function fillSellLimit(
        uint256 sellAmount,
        uint256 maxBuyAmount,
        bytes calldata callbackData,
        uint256 deadline
    ) external returns (uint256 buyAmountReceived);
}
```

#### 6.1.3 Taker Callback Interface

```solidity
interface ISellLimitTaker {
    function onFillSellLimit(
        address sellToken,
        uint256 sellAmountSent,
        address buyToken,
        uint256 minBuyAmountRequired,
        bytes calldata callbackData
    ) external;
}
```

#### 6.1.4 Maker Behaviour

A conformant `fillSellLimit` implementation MUST, in order:

1. Revert if `block.timestamp > deadline`.
2. Read its current Quote `q` via logic equivalent to `quoteSellLimit()`.
   Revert if `q.state != QUOTE_AVAILABLE`.
3. Revert if `sellAmount == 0` or `sellAmount > q.sellAmount`.
4. For partial fills (when `sellAmount < q.sellAmount`): revert if
   `q.allowPartials == false`, or if the remainder
   `q.sellAmount - sellAmount` is non-zero and below
   `q.minSellRemainder`.
5. Compute
   `requiredBuyAmount = (sellAmount * q.minBuyAmount) / q.sellAmount`
   using a full-precision multiply-divide. The rounding bound is
   ±1 wei.
6. Revert if `requiredBuyAmount > maxBuyAmount`. This is the Taker-
   side slippage check.
7. Snapshot the Maker's `buyToken` balance.
8. Transfer `sellAmount` of `sellToken` to `msg.sender`. (The Maker
   may perform any internal state preparation needed to make this
   amount available, e.g., unwrapping a productive position.)
9. Call
   `ISellLimitTaker(msg.sender).onFillSellLimit(q.sellToken, sellAmount, q.buyToken, requiredBuyAmount, callbackData)`.
10. Compute `received` as the Maker's post-callback `buyToken`
    balance minus the snapshot from step 7. Revert if
    `received < requiredBuyAmount`.
11. Update internal state as needed (e.g., decrement remaining
    Quote inventory).
12. Return `received` as `buyAmountReceived`.

The fill function MUST be guarded against reentrancy. The callback
into the Taker (step 9) is the only re-entrancy point during a fill;
the callback MUST NOT permit re-entry into any state-mutating Maker
function.

#### 6.1.5 Taker Behaviour

The Taker's `onFillSellLimit` callback MUST:

1. Validate that this callback corresponds to a fill the Taker
   initiated (see §8, T-03).
2. Use the received `sellToken` however it wishes — sell on a
   market, retain as inventory, or any other strategy.
3. Push at least `minBuyAmountRequired` of `buyToken` back to
   `msg.sender` via `IERC20(buyToken).transfer`.
4. Return normally.

The Taker MAY push more than `minBuyAmountRequired`; the Maker
accepts the surplus as a benefit to itself. If the Taker cannot
satisfy the minimum, it SHOULD revert from within the callback to
provide clear error context. Either way, the entire fill transaction
will revert.

### 6.2 BuyLimit

The Maker offers to buy a fixed quantity of `buyToken`, providing up
to a maximum quantity of `sellToken` in exchange. The Maker pushes
its full available `sellToken` allocation to the Taker, who uses it
to source the required `buyToken` and returns any unused `sellToken`
to the Maker.

The asymmetry between SellLimit and BuyLimit lies in which side is
fixed: in SellLimit the Maker fixes the `sellAmount` and the Taker
guarantees a minimum `buyAmount`; in BuyLimit the Maker fixes the
`buyAmount` and the Taker is constrained to a maximum `sellAmount`
expenditure.

#### 6.2.1 Quote

```solidity
struct BuyLimitQuote {
    QuoteState state;
    address    buyToken;
    uint256    buyAmount;
    bool       allowPartials;
    uint256    minBuyRemainder;
    address    sellToken;
    uint256    maxSellAmount;
    uint256    quoteValidUntil;
    bytes      extraData;
}
```

- `buyAmount` is the quantity of `buyToken` the Maker wants to
  acquire in this Quote.
- `maxSellAmount` is the maximum quantity of `sellToken` the Maker
  is willing to spend for the full `buyAmount`. Linear scaling
  applies for partial fills.
- `allowPartials` and `minBuyRemainder` are analogous to the
  SellLimit versions, but reference the `buyAmount` axis.
- `quoteValidUntil`, `extraData`: see §6.5 and §6.4.

#### 6.2.2 Maker Interface

```solidity
interface IBuyLimitMaker {
    function quoteBuyLimit() external view returns (BuyLimitQuote memory);

    function fillBuyLimit(
        uint256 buyAmount,
        uint256 minSellAmount,
        bytes calldata callbackData,
        uint256 deadline
    ) external returns (uint256 sellAmountSpent);
}
```

#### 6.2.3 Taker Callback Interface

```solidity
interface IBuyLimitTaker {
    function onFillBuyLimit(
        address sellToken,
        uint256 maxSellAmountSent,
        address buyToken,
        uint256 exactBuyAmountRequired,
        bytes calldata callbackData
    ) external;
}
```

#### 6.2.4 Maker Behaviour

A conformant `fillBuyLimit` implementation MUST, in order:

1. Revert if `block.timestamp > deadline`.
2. Read its current Quote `q` via logic equivalent to `quoteBuyLimit()`.
   Revert if `q.state != QUOTE_AVAILABLE`.
3. Revert if `buyAmount == 0` or `buyAmount > q.buyAmount`.
4. For partial fills (when `buyAmount < q.buyAmount`): revert if
   `q.allowPartials == false`, or if the remainder
   `q.buyAmount - buyAmount` is non-zero and below
   `q.minBuyRemainder`.
5. Compute
   `pushedSellAmount = (buyAmount * q.maxSellAmount) / q.buyAmount`
   using a full-precision multiply-divide. The rounding bound is
   ±1 wei.
6. Revert if `pushedSellAmount < minSellAmount`. This is the Taker-
   side slippage check: the Taker requires at least this much
   working capital, and refuses to operate if the Maker's effective
   rate has degraded since the polling-time observation.
7. Snapshot both the Maker's `buyToken` balance and its `sellToken`
   balance.
8. Transfer `pushedSellAmount` of `sellToken` to `msg.sender`.
9. Call
   `IBuyLimitTaker(msg.sender).onFillBuyLimit(q.sellToken, pushedSellAmount, q.buyToken, buyAmount, callbackData)`.
10. Compute `buyReceived` as the Maker's post-callback `buyToken`
    balance minus the snapshot from step 7. Revert if
    `buyReceived != buyAmount`. **The match must be exact.** Excess
    `buyToken` is rejected because it implies the Maker overspent
    `sellToken` relative to the linear-scaled rate.
11. Compute `sellSpent` as the snapshot from step 7 minus the
    Maker's post-callback `sellToken` balance. Note
    `sellSpent <= pushedSellAmount`; the difference is the unused
    working capital that the Taker refunded.
12. Update internal state as needed.
13. Return `sellSpent` as `sellAmountSpent`.

Reentrancy requirements are identical to §6.1.4.

#### 6.2.5 Taker Behaviour

The Taker's `onFillBuyLimit` callback MUST:

1. Validate that this callback corresponds to a fill the Taker
   initiated (see §8, T-03).
2. Use up to `maxSellAmountSent` of `sellToken` to source **exactly**
   `exactBuyAmountRequired` of `buyToken` — for example, by selling
   `sellToken` on a market.
3. Push exactly `exactBuyAmountRequired` of `buyToken` back to
   `msg.sender`. Pushing more will cause the Maker to revert in step
   10 of §6.2.4.
4. Push any unused `sellToken` back to `msg.sender`.
5. Return normally.

If the Taker cannot source the exact required `buyAmount`, it MUST
revert from within the callback. Pushing less than
`exactBuyAmountRequired` would cause the Maker to revert anyway; an
in-callback revert gives the Taker clearer error context.

### 6.3 Bounty

The Maker offers a fixed payment in `bountyToken` in exchange for the
Taker performing a Maker-defined action. The specifics of the action
and how the Maker verifies its completion are entirely Maker-
implementation-defined; the standard provides only the mechanism for
offer, callback, and payment.

Common Bounty use cases include compounding a productive position,
draining a buffer, harvesting yield, or executing a scheduled
maintenance step that is too cheap to be worth a SellLimit / BuyLimit
swap but still produces value the Maker is willing to pay for.

#### 6.3.1 Quote

```solidity
struct BountyQuote {
    QuoteState state;
    address    bountyToken;
    uint256    bountyAmount;
    bytes      makerCalldata;
    uint256    quoteValidUntil;
    bytes      extraData;
}
```

- `bountyAmount` is the quantity of `bountyToken` the Maker will pay
  for this fill.
- `makerCalldata` is an opaque blob defined by the Maker, returned
  unchanged by the Taker in the `fillBounty` call. Its content is
  Maker-defined; common uses include task specification (which
  compound to perform, which buffer to drain, etc.). The field MAY
  be empty bytes.
- `quoteValidUntil`, `extraData`: see §6.5 and §6.4.

#### 6.3.2 Maker Interface

```solidity
interface IBountyMaker {
    function quoteBounty() external view returns (BountyQuote memory);

    function fillBounty(
        uint256 minBountyAmount,
        bytes calldata makerCalldata,
        bytes calldata takerCalldata,
        uint256 deadline
    ) external returns (uint256 bountyPaid);
}
```

#### 6.3.3 Taker Callback Interface

```solidity
interface IBountyTaker {
    function onFillBounty(
        address bountyToken,
        uint256 bountyAmountSent,
        bytes calldata makerCalldata,
        bytes calldata takerCalldata
    ) external;
}
```

#### 6.3.4 Maker Behaviour

A conformant `fillBounty` implementation MUST, in order:

1. Revert if `block.timestamp > deadline`.
2. Read its current Quote `q` via logic equivalent to `quoteBounty()`.
   Revert if `q.state != QUOTE_AVAILABLE`.
3. Revert if `q.bountyAmount < minBountyAmount`. This is the Taker-
   side slippage check.
4. Optionally validate `makerCalldata` against the Quote's current
   `makerCalldata` (e.g., to ensure the Taker is acting on a current
   task specification rather than a stale one). This is Maker-
   implementation-defined; the standard does not require any
   specific validation.
5. Capture any pre-callback state snapshots needed for post-callback
   verification. The choice of what to snapshot is Maker-
   implementation-defined.
6. Transfer `q.bountyAmount` of `q.bountyToken` to `msg.sender`.
7. Call
   `IBountyTaker(msg.sender).onFillBounty(q.bountyToken, q.bountyAmount, makerCalldata, takerCalldata)`.
8. Verify that the post-callback state satisfies whatever conditions
   the Bounty represents. The verification logic is Maker-
   implementation-defined and not part of the standard. Common
   patterns include checking a state delta on the Maker itself, on
   a position contract the Maker manages, or on a third-party
   contract. The Maker MUST revert if verification fails.
9. Update internal state as needed.
10. Return `q.bountyAmount` as `bountyPaid`.

Reentrancy requirements are identical to §6.1.4.

#### 6.3.5 Taker Behaviour

The Taker's `onFillBounty` callback MUST:

1. Validate that this callback corresponds to a fill the Taker
   initiated (see §8, T-03).
2. Perform whatever work the Bounty requires, as defined by the
   Maker's external documentation, prior agreement, or interpretation
   of `makerCalldata`. The Taker MUST know — through these channels
   — what the Maker's verification logic (§6.3.4 step 8) will check.
3. Keep the `bountyAmountSent`. No return transfer of `bountyToken`
   is required by the standard.
4. Return normally if the work is complete; revert if it cannot be
   completed or if a Taker-side precondition fails.

This callback has the loosest semantics of the three because the
action being performed is Maker-defined. Generic Taker Bots cannot
serve arbitrary Bounty Makers without prior knowledge of the specific
Maker's task scheme.

### 6.4 `extraData` — informational Maker context

All three Quote structs include a final `extraData` field of type
`bytes`. Its semantics are uniform across Order Types:

- **Maker-defined.** The Maker chooses what to put in this field and
  in what format. Common uses include position identifiers, vault
  type tags, strategy names, version markers, or links to off-chain
  metadata. The standard does not impose any structure.

- **Informational only.** The Taker reads `extraData` and MAY use it
  for profitability evaluation, routing decisions, filtering, or any
  other purpose. The standard does not require the Taker to act on
  `extraData` in any specific way.

- **Not bound to fill execution.** `extraData` is NOT a `fill*`
  argument and is NOT passed back to the Maker through `fill*`. It
  is also NOT forwarded into the Taker callback by the Maker. If the
  Taker needs `extraData` available inside the callback, the Taker
  copies it from the Quote into the `callbackData` argument when
  calling `fill*`.

- **Not part of quote consistency.** A Maker MAY change `extraData`
  between a Taker's quote observation and the subsequent fill
  without affecting the validity of the fill. The standard does not
  enforce consistency on this field.

- **MAY be empty.** Makers that have no contextual information to
  publish set `extraData = bytes("")`. Taker Bots MUST tolerate
  empty `extraData`.

Distinction from `makerCalldata` (Bounty only): `makerCalldata` is
returned by the Taker to the Maker on fill and may participate in
the Maker's task-verification logic. `extraData` is read-only context
that flows from Maker to Taker and never returns.

Maker families MAY agree on private schemas for `extraData` to
enable family-specialised optimisations; such schemas are not part
of this standard.

### 6.5 `quoteValidUntil` — polling hint

All three Quote structs include a `quoteValidUntil` field of type
`uint256`. Its semantics are uniform across Order Types.

#### 6.5.1 Format and meaning

`quoteValidUntil` is a Unix timestamp in seconds, identical in format
to `block.timestamp` and to the `deadline` argument of `fill*`
functions. A Maker computes it as `block.timestamp + N` where `N` is
the desired validity window in seconds.

The value is a **polling hint, not enforcement.** It signals the
Maker's expectation of when the Quote will need to be refreshed.
Makers MUST NOT enforce `quoteValidUntil` in any `fill*` function;
the only durable time bound on a fill is the `deadline` argument
supplied by the Taker. A Maker MAY return a Quote whose
`quoteValidUntil` has already elapsed; the Taker decides whether to
fill anyway (see §6.5.4).

A Maker MAY return new Quote values before the previous
`quoteValidUntil` elapses; this is normal and not a protocol
violation. Nothing in the standard prevents a Taker from polling more
frequently than `quoteValidUntil` suggests. Hints are upper bounds
on Taker patience, not lower bounds.

#### 6.5.2 `quoteValidUntil = 0` is reserved

`quoteValidUntil = 0` is reserved for Quotes with `state == NO_QUOTE`
or `state == TERMINATED`. For these states, `0` means "no hint" and
the Taker polls according to its own strategy.

A Maker that returns `state == QUOTE_AVAILABLE` MUST also set
`quoteValidUntil > 0`. Taker Bots MAY reject `QUOTE_AVAILABLE` Quotes
with `quoteValidUntil = 0` at any discovery or polling step. A Maker
that wishes to express "no opinion about polling frequency" while
still presenting an actionable Quote SHOULD set `quoteValidUntil` to
a far-future-but-finite value, which the Taker will clamp to the
maximum polling horizon (§6.5.3).

#### 6.5.3 Maximum acceptable polling horizon

A Taker MUST poll any active Maker at least once every 28 days,
regardless of `quoteValidUntil`. Maker-supplied values larger than
`block.timestamp + 28 days` MUST be treated as if they were exactly
`block.timestamp + 28 days`. Concretely, the effective polling
deadline a Taker applies is:

```
effectiveValidUntil = min(
    quote.quoteValidUntil > 0 ? quote.quoteValidUntil : type(uint256).max,
    block.timestamp + 28 days
)
```

28 days = 2,419,200 seconds.

The 28-day cap is the **loosest** cap a conformant Taker may choose.
A Taker MAY apply a tighter cap (e.g., 24 hours) based on its own
operator policy and freshness / polling-cost trade-off. The 28-day
bound exists to give Maker authors a predictable upper bound on how
long any conformant Taker will look ahead: no Maker can become
invisible by claiming indefinite validity.

#### 6.5.4 Past `quoteValidUntil`

A Maker MAY return a `QUOTE_AVAILABLE` Quote whose `quoteValidUntil`
has already elapsed. The standard permits this — the only durable
time bound on a fill is the Taker-supplied `deadline`.

Taker Bots SHOULD treat such Quotes as stale signals and MAY reject
them at discovery or polling time. Tolerating arbitrarily old
`quoteValidUntil` values is permitted but is at the Taker's
discretion.

---

## 7. Maker Implementation Requirements

A compliant Maker Contract MUST satisfy items M-01 through M-09 and
SHOULD satisfy items M-10 and M-11. Items M-12 through M-14 are MAY-
level affordances.

- **M-01.** Implement ERC-165 per §4.3.

- **M-02.** Implement the full `quote*` and `fill*` function pair
  for each Maker interface the Maker declares (§6).

- **M-03.** Honor the `TERMINATED` monotonicity rule (§4.1): never
  return `QUOTE_AVAILABLE` from a `quote*` function on which
  `TERMINATED` has previously been returned.

- **M-04.** Validate `deadline` at the start of every `fill*` call
  and revert if `block.timestamp > deadline` (see §6.1.4 step 1,
  §6.2.4 step 1, §6.3.4 step 1).

- **M-05.** Guard every `fill*` function against reentrancy. The
  callback into the Taker MUST be the only re-entrancy point during
  a fill, and that callback frame MUST NOT permit re-entry into any
  other state-mutating Maker function.

- **M-06.** Revert (rather than return a default value) if any
  Quote precondition fails during `fill*`. This includes
  state-mismatch, amount-out-of-range, partial-fill-not-allowed,
  remainder-below-minimum, and Taker-side slippage-bound violations.

- **M-07.** For `fillSellLimit`: verify
  `received >= requiredBuyAmount` via balance delta after callback,
  and revert otherwise (§6.1.4 step 10).

- **M-08.** For `fillBuyLimit`: verify
  `buyTokenReceived == buyAmount` (exact equality) via balance delta
  after callback, and revert otherwise (§6.2.4 step 10). The
  exact-match rule is stricter than `>=` and exists because excess
  `buyToken` implies the Maker overspent `sellToken` relative to the
  linear-scaled rate.

- **M-09.** MUST NOT enforce `quoteValidUntil` in any `fill*`
  function. The only durable time bound on a fill is the `deadline`
  argument supplied by the Taker. A Maker that reverts a fill based
  on `quoteValidUntil` having elapsed is non-conformant.

- **M-10.** Register with the Registry shortly after deployment
  (§5.3) and deregister before becoming permanently inactive.

- **M-11.** Return `QuoteState.TERMINATED` from any `quote*` function
  whose corresponding Order Type has been permanently disabled on
  this Maker, even if the Maker remains active on other Order Types.

- **M-12.** A Maker MAY implement multiple Maker interfaces in a
  single contract, declaring all of them at registration time.

- **M-13.** A Maker MAY use any internal pricing logic — oracles,
  TWAPs, on-chain state, off-chain signed inputs — to dynamically
  compute Quote parameters. Such logic is invisible to the standard;
  the returned Quote is what counts.

- **M-14.** When returning `QUOTE_AVAILABLE` with no strong opinion
  about polling frequency, a Maker SHOULD set `quoteValidUntil` to a
  far-future-but-finite value (for example, `block.timestamp + 28
  days`); the Taker will clamp this to the maximum polling horizon
  (§6.5.3). The legacy convention of using `quoteValidUntil = 0` to
  mean "no opinion" is reserved for `NO_QUOTE` and `TERMINATED`
  states only (§6.5.2).

---

## 8. Taker Bot Requirements

A compliant Taker Bot MUST satisfy items T-01 through T-06 and
SHOULD satisfy items T-07 through T-10. Items T-11 through T-13 are
MAY-level affordances.

- **T-01.** Honor `QuoteState.TERMINATED` per-interface. After
  observing `TERMINATED` from a Maker's specific `quote*` function,
  the Bot MUST NOT call the corresponding `fill*` function on that
  Maker again.

- **T-02.** Never submit a `fill*` transaction whose success
  depends on the Maker tolerating an out-of-spec callback response.
  Specifically:
  - For `onFillSellLimit`: push at least `minBuyAmountRequired`.
  - For `onFillBuyLimit`: push exactly `exactBuyAmountRequired` and
    return any unused `maxSellAmountSent` to the Maker.
  - For `onFillBounty`: satisfy whatever post-callback verification
    logic the Maker has documented externally; the standard does
    not enforce a specific response shape.

- **T-03.** Validate every callback as belonging to a fill the
  Taker initiated. The validation MUST include at minimum (a) a
  flag indicating a fill is currently in flight and (b) confirmation
  that `msg.sender` matches the Maker address the Taker invoked.
  Implementations MAY use persistent storage, transient storage, or
  any other mechanism for these flags; the conformance criterion is
  observable behaviour, not storage layout.

- **T-04.** Use slippage bounds on every `fill*` call (`maxBuyAmount`
  for SellLimit, `minSellAmount` for BuyLimit, `minBountyAmount` for
  Bounty) to protect against Maker-side rate degradation between
  the polling-time observation and the in-block fill.

- **T-05.** Set `deadline` to a near-future timestamp on every
  `fill*` call, typically the current block timestamp plus a small
  buffer, to limit the time window during which the transaction can
  execute.

- **T-06.** Poll every active Maker at least once every 28 days,
  regardless of `quoteValidUntil`. Maker-supplied values exceeding
  `block.timestamp + 28 days` MUST be treated as if they were
  exactly `block.timestamp + 28 days` (§6.5.3). A Taker MAY apply a
  tighter polling cap based on its own operator policy.

- **T-07.** Subscribe to Registry events (`MakerRegistered`,
  `MakerDeregistered`, `InterfacesUpdated`) for each target chain
  and maintain a local list of active Makers based on these events.

- **T-08.** Validate each newly-discovered Maker before adding it to
  the active polling set, by calling each of the Maker's declared
  `quote*` functions once and verifying the response is well-formed
  (decode succeeds, token addresses are non-zero, amount fields are
  within sensible bounds, `quoteValidUntil` honors §6.5.2).

- **T-09.** Maintain a persistent record of Maker addresses that
  failed validation and decline to re-validate them unless the Bot
  operator explicitly resets the record.

- **T-10.** Respect `quoteValidUntil` (when within the 28-day cap)
  as guidance for scheduling the next poll of a given Maker.
  Polling earlier than `quoteValidUntil` is permitted but typically
  wasteful.

- **T-11.** A Taker MAY use any polling cadence, profitability
  evaluation logic, capital sourcing strategy (own inventory, flash
  loans, market swaps), and execution mechanism (private mempool,
  public mempool, bundling). None of these are constrained by the
  standard.

- **T-12.** A Taker MAY restrict its operation to a curated subset
  of Makers (e.g., an audit-based allowlist) rather than serving
  every registered Maker.

- **T-13.** A Taker MAY operate across multiple chains, each with
  its own Registry deployment, treating them as independent
  discovery and execution domains.

---

## 9. Conformance Checklist

A Maker Contract is conformant if and only if it satisfies all MUST-
level items in §7:

- [ ] M-01: implements ERC-165 per §4.3
- [ ] M-02: implements full `quote*` and `fill*` for each declared interface
- [ ] M-03: honors monotonic `TERMINATED` per-interface
- [ ] M-04: validates `deadline` in every `fill*`
- [ ] M-05: reentrancy-guards every `fill*`; callback is sole re-entrancy point
- [ ] M-06: reverts on every Quote precondition failure during `fill*`
- [ ] M-07: enforces `received >= requiredBuyAmount` in `fillSellLimit`
- [ ] M-08: enforces `buyTokenReceived == buyAmount` (exact) in `fillBuyLimit`
- [ ] M-09: does NOT enforce `quoteValidUntil` in any `fill*`

A Taker Bot is conformant if and only if it satisfies all MUST-level
items in §8:

- [ ] T-01: honors `TERMINATED` per-interface
- [ ] T-02: respects callback minimum / exact-match / Maker-verification contracts
- [ ] T-03: validates every callback as belonging to a fill it initiated
- [ ] T-04: uses slippage bounds on every `fill*`
- [ ] T-05: uses near-future `deadline` on every `fill*`
- [ ] T-06: polls every active Maker at least once every 28 days, clamping `quoteValidUntil`

SHOULD and MAY items in §7 and §8 are not part of the conformance
gate; they encode best practice and operator-flexibility allowances.

---

## 10. Out of Scope

This standard does not specify, and implementations are free to
choose any approach for:

- Maker-side pricing logic, oracles, TWAPs, or any other source of
  truth used to compute Quote parameters.
- Maker-side internal state machines, position management, inventory
  accounting, or buffer semantics. These are concerns of specific
  Maker types and not of the standard.
- Taker Bot architecture: language, runtime, persistence layer,
  polling cadence, scheduling strategy, or hosting model.
- Capital sourcing for Taker fills: flash loans, owned inventory,
  market swaps, aggregator integrations, or any combination.
- Profitability evaluation: gas-cost estimation, fee-floor logic,
  minimum-profit accounting, surplus valuation, and the choice of
  reference token in which profit is denominated.
- Swap routing, slippage modeling, and market-integration choices on
  the Taker side.
- MEV protection strategies: private mempool submission, transaction
  bundling, or commit-reveal schemes.
- Cross-chain coordination, cross-chain messaging, or shared
  state between chains.
- Reputation systems for Makers or Takers. These may emerge as
  off-chain services consuming on-chain fill events, but are not
  defined by this standard.
- Aggregator services, orderbook UIs, indexing services, or other
  downstream tooling that consumes the standard. These are
  explicitly downstream and not part of the standard itself.
- Bytecode-level deduplication of similar Maker contracts or other
  deployment-cost optimisations.

---

## 11. Glossary

**ERC-165** — Ethereum interface detection standard.
`supportsInterface(bytes4)` returns `true` if a contract supports a
given interface identifier.

**Fill** — A single execution of an Order Type, atomic within one
transaction.

**Maker / Maker Contract** — The smart contract publishing offers
through one or more `quote*` functions and accepting them through the
corresponding `fill*` functions.

**Order Type** — One of SellLimit, BuyLimit, or Bounty. The category
of offer a Maker publishes.

**Push-callback-verify** — The settlement pattern where the Maker
pushes tokens out to the Taker, calls back into the Taker via the
appropriate callback interface, and verifies the result by inspecting
its own balance delta after the callback returns.

**Quote** — The data returned by a Maker's `quote*` function for a
given Order Type, including the `QuoteState` lifecycle field and the
type-specific order parameters.

**Registry** — The permissionless on-chain directory of registered
Makers. Deployed once per supported chain.

**Taker / Taker Bot** — The actor calling Maker `fill*` functions —
typically off-chain software backed by an on-chain helper contract
implementing the relevant callback interfaces.

---

## 12. Future Extensions

The standard is designed for forward-compatibility. The following
Maker-interface families are anticipated as future additions; their
naming conventions are reserved by this RFC:

- **`IBook*Maker` (BookSellLimit, BookBuyLimit, BookBounty)** —
  multi-offer parallel-quote families for Makers that genuinely
  expose more than one offer of the same Order Type at a time. Each
  Book interface exposes a quote function returning an array of
  offers identified by stable per-offer identifiers, plus a fill
  function that takes such an identifier to select an offer. Use
  cases include market-making contracts publishing quotes at
  multiple price points, or vaults holding several independently-
  settleable positions.

- **`IBatch*Maker`** — atomic execution of multiple orders from a
  single Maker. The Maker offers a bundle of related orders that
  MUST be filled together or not at all. Use cases include
  Maker-defined order baskets where the constituent orders are
  economically interdependent.

- **`IBasket*Maker`** — single order trading a basket of multiple
  `sellTokens` against one `buyToken` (or vice versa). The full
  basket is exchanged as a unit. Use cases include portfolio-level
  rebalancing or multi-token settlement of complex positions.

Extensions follow the additive-interface principle: existing
single-quote interfaces remain unchanged when new interface families
are introduced. A Maker MAY implement any combination of single-
quote, book, batch, and basket interfaces in a single contract.
Each new interface family is registered with the Registry through
its own ERC-165 interface identifier (§4.2), pinned to a literal
hex value at the time the family is added to the standard.

---

*End of RFC-0001.*
