# RFC-0005: Midcurve Keeper Standard

**Status:** Draft
**Date:** 2026-05-08
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

**Order** — A continuous offer made by a Maker through a quote function.
There are three Order Types defined by this standard: SellLimit,
BuyLimit, and Bounty. A Maker can offer multiple Order Types
simultaneously by implementing multiple Maker interfaces, but each
interface offers at most one active quote at a time.

**Quote** — The data returned by a Maker's quote function for a given
Order Type. Always includes a `QuoteState` field plus type-specific
order parameters.

**Fill** — The execution of an Order Type's fill function by a Taker.
Each fill is atomic within a transaction; partial fills are supported
where indicated by the Quote.

---

## 3. Architecture Overview

```
                    ┌─────────────────────────┐
                    │         Registry        │
                    │  (one per chain)        │
                    │                         │
                    │  emits MakerRegistered, │
                    │  MakerDeregistered,     │
                    │  InterfacesUpdated      │
                    └────────────┬────────────┘
                                 │
                                 │ events / view calls
                                 ▼
       ┌─────────────────────────┴───────────────────────────┐
       │                                                     │
       ▼                                                     ▼
┌─────────────┐                                    ┌──────────────┐
│   Maker     │ ◄──── quote* (view) ───────────    │  Taker Bot   │
│  Contract   │                                    │              │
│             │ ◄──── fill* (state-changing) ───   │  + Taker     │
│  pushes,    │                                    │    Contract  │
│  callbacks, │ ───── on*Fill (callback) ──────►   │              │
│  verifies   │                                    │  pulls funds,│
└─────────────┘                                    │  performs    │
                                                   │  swap, etc.  │
                                                   └──────────────┘
```

The Maker Contract is the on-chain anchor: it owns the position, the
inventory, or the maintenance task. The Taker Bot is the off-chain
brain plus an on-chain helper contract that implements callback
interfaces.

A Maker advertises itself by calling `register()` on the Registry. A
Taker Bot subscribes to Registry events to learn about new and removed
Makers. The Taker Bot polls each Maker's quote functions periodically;
when a Quote is executable and profitable, the Taker Bot submits a
transaction that calls the Maker's fill function.

The fill flow follows the **push-callback-verify** pattern in all cases:

1. Taker calls `fill*` on the Maker.
2. Maker validates the call, prepares the resources to be sent.
3. Maker pushes tokens to the Taker (via `transfer`).
4. Maker calls back into the Taker via the appropriate callback interface.
5. Taker performs whatever it needs to do (e.g., swap tokens at a market).
6. Taker pushes the required return tokens back to the Maker (via `transfer`).
7. Callback returns; Maker verifies the result via balance delta.
8. Maker accepts or reverts the entire transaction.

This pattern provides atomic settlement with no need for token approvals
on either side and no need for the Maker to know how the Taker sources
its capital. The Taker may use flash loans, market swaps, owned
inventory, or any combination — invisible to the Maker.

---

## 4. Common Types

### 4.1 `QuoteState`

```solidity
enum QuoteState {
    NO_QUOTE,         // currently no quote available; may become available later
    QUOTE_AVAILABLE,  // quote details are populated
    TERMINATED        // maker is done with this order type, will never quote again
}
```

`QuoteState.TERMINATED` is **monotonically final** for the order type
on which it was returned: a Maker that returns `TERMINATED` from a
specific quote function MUST NOT subsequently return `QUOTE_AVAILABLE`
from that same quote function. Other quote functions on the same
Maker may continue to operate normally; `TERMINATED` is per-interface,
not per-Maker.

`QuoteState.NO_QUOTE` is non-final and provides no information about
when (or whether) a Quote will become available next. Taker Bots
SHOULD treat repeated `NO_QUOTE` responses as a signal to reduce
polling frequency, but MUST continue treating the Maker as potentially
active until either `TERMINATED` is observed or the Maker is
deregistered.

### 4.2 Interface Identifiers (ERC-165)

Each Maker interface defined in §6 has a corresponding ERC-165
interface identifier, used in Registry registration and for runtime
introspection:

```solidity
bytes4 constant ISELL_LIMIT_MAKER_ID = type(ISellLimitMaker).interfaceId;
bytes4 constant IBUY_LIMIT_MAKER_ID  = type(IBuyLimitMaker).interfaceId;
bytes4 constant IBOUNTY_MAKER_ID     = type(IBountyMaker).interfaceId;
```

Every Maker Contract MUST implement ERC-165 (`supportsInterface(bytes4)`)
and return `true` for each Maker interface it implements.

---

## 5. Registry

### 5.1 Purpose

The Registry serves a single function: it allows Makers to make
themselves discoverable, and emits events that Taker Bots can subscribe
to in order to track which Makers exist. The Registry does not
mediate quotes, execute fills, hold tokens, or evaluate Maker
correctness. It is purely a directory.

### 5.2 Interface

```solidity
interface IMidcurveKeeperRegistry {
    struct Listing {
        address maker;
        bytes4[] supportedInterfaces;
        uint256 registeredAt;
        bool active;
    }

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

    function register(bytes4[] calldata supportedInterfaces) external;
    function deregister() external;
    function updateInterfaces(bytes4[] calldata supportedInterfaces) external;

    function isRegistered(address maker) external view returns (bool);
    function getListing(address maker) external view returns (Listing memory);
    function getAllMakers() external view returns (address[] memory);
    function getActiveMakers() external view returns (address[] memory);
}
```

### 5.3 Behaviour

#### `register(supportedInterfaces)`

```
Caller is the Maker (msg.sender). The Registry:

  Require msg.sender is not currently active in listings
  Require supportedInterfaces is non-empty

  For each interfaceId in supportedInterfaces:
    Call msg.sender.supportsInterface(interfaceId) via ERC-165 staticcall
    Require the call returns true
    (This filters out Makers that lie about their interfaces or that
    do not implement ERC-165 at all.)

  If msg.sender has never been registered before:
    Append msg.sender to the all-makers array

  Set listings[msg.sender] to:
    maker = msg.sender
    supportedInterfaces = supportedInterfaces
    registeredAt = block.timestamp
    active = true

  Emit MakerRegistered(msg.sender, supportedInterfaces, block.timestamp)
```

#### `deregister()`

```
Caller is the Maker. The Registry:

  Require listings[msg.sender].active is true
  Set listings[msg.sender].active = false
  Emit MakerDeregistered(msg.sender, block.timestamp)
```

A deregistered Maker MAY re-register later by calling `register` again.
The all-makers array preserves history; deregistered entries remain in
the array with `active = false`.

#### `updateInterfaces(supportedInterfaces)`

```
Caller is the Maker. The Registry:

  Require listings[msg.sender].active is true
  Require supportedInterfaces is non-empty

  For each interfaceId in supportedInterfaces:
    Call msg.sender.supportsInterface(interfaceId) via ERC-165 staticcall
    Require the call returns true

  Set listings[msg.sender].supportedInterfaces = supportedInterfaces
  Emit InterfacesUpdated(msg.sender, supportedInterfaces, block.timestamp)
```

This is used by Makers that gain or lose interface support over time
(e.g., after an upgrade in their off-chain pricing logic).

#### View functions

`isRegistered(maker)` returns `listings[maker].active`.

`getListing(maker)` returns the full Listing struct, regardless of
active state.

`getAllMakers()` returns the full append-only array, including
deregistered Makers.

`getActiveMakers()` returns the subset of the all-makers array filtered
to active entries. Note this function's gas cost grows linearly with
the total number of Makers ever registered; callers SHOULD prefer
event-based discovery for production use.

### 5.4 Spam Resistance

The Registry intentionally has no economic barrier to registration
(no stake, no fee). Spam resistance comes from three layered
mechanisms:

1. **Deployment cost.** Every Maker is a deployed smart contract.
   Even on cheap L2s, deploying a contract that implements ERC-165 plus
   at least one Maker interface incurs nontrivial gas cost. Mass spam
   requires mass deployment.

2. **ERC-165 verification on registration.** The Registry calls
   `supportsInterface` on the Maker for every declared interface and
   reverts if any returns false. Empty contracts and contracts without
   ERC-165 cannot register.

3. **Off-chain quote validation by Taker Bots.** Taker Bots SHOULD
   call each declared Maker interface's `quote*` function once after
   discovery and verify the response is well-formed and contains
   plausible values. Makers that fail this validation MAY be
   blacklisted by individual Bots indefinitely. This filter is entirely
   off-chain and at the discretion of each Bot operator.

---

## 6. Maker and Taker Interfaces

The standard defines three Order Types: SellLimit, BuyLimit, and
Bounty. Each has a Maker-side interface (offering and fulfilling)
and a Taker-side callback interface (receiving and responding).
A Maker MAY implement any subset of the three.

### 6.1 SellLimit

The Maker offers a fixed quantity of `sellToken` for sale, requiring
a minimum quantity of `buyToken` in return. The Taker provides the
`buyToken` after using or selling the `sellToken` it has received.

#### Quote

```solidity
struct SellLimitQuote {
    QuoteState state;
    address    sellToken;
    uint256    sellAmount;
    bool       allowPartials;
    uint256    minSellRemainder;
    address    buyToken;
    uint256    minBuyAmount;
}
```

- `sellAmount` is the maximum quantity of `sellToken` available in
  this Quote.
- `minBuyAmount` is the minimum quantity of `buyToken` the Maker
  requires for the full `sellAmount`. Linear scaling applies for
  partial fills (see below).
- `allowPartials` controls whether the Taker may take less than the
  full `sellAmount`. If `false`, the Taker MUST consume `sellAmount`
  exactly.
- `minSellRemainder`, if `allowPartials == true`, defines the minimum
  size of any leftover `sellAmount` after a partial fill. The Taker
  MUST either consume `sellAmount` exactly, or leave at least
  `minSellRemainder` of `sellToken` unsold. Set `minSellRemainder = 0`
  to allow any partial size.

#### Maker Interface

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

#### Taker Callback Interface

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

#### Behaviour of `fillSellLimit`

```
Inputs from caller:
  sellAmount:    quantity of sellToken the Taker wants to take
  maxBuyAmount:  Taker-side slippage bound — Taker refuses to provide
                 more than this much buyToken
  callbackData:  opaque blob passed back to the Taker in the callback
  deadline:      Unix timestamp after which the call must revert

Maker validates:
  Require block.timestamp <= deadline
  Read current quote q via internal logic equivalent to quoteSellLimit()
  Require q.state == QUOTE_AVAILABLE
  Require sellAmount > 0
  Require sellAmount <= q.sellAmount

  Determine partial fill regime:
    if sellAmount < q.sellAmount:
      Require q.allowPartials is true
      Compute remainder = q.sellAmount - sellAmount
      Require remainder == 0 OR remainder >= q.minSellRemainder

  Compute requiredBuyAmount:
    requiredBuyAmount = mulDiv(sellAmount, q.minBuyAmount, q.sellAmount)
    (linear scaling; uses safe full-precision multiply-divide)

  Require requiredBuyAmount <= maxBuyAmount
    (Taker-side slippage check)

Maker prepares:
  Perform any internal state preparation needed to make sellAmount of
  sellToken available (e.g., partially close a UV3 position).

  Snapshot: balanceBefore = IERC20(buyToken).balanceOf(address(this))

Maker pushes:
  IERC20(sellToken).transfer(msg.sender, sellAmount)

Maker calls back:
  ISellLimitTaker(msg.sender).onFillSellLimit(
      sellToken,
      sellAmount,
      buyToken,
      requiredBuyAmount,
      callbackData
  )

After callback returns, Maker verifies:
  received = IERC20(buyToken).balanceOf(address(this)) - balanceBefore
  Require received >= requiredBuyAmount
    (Maker MAY reject more aggressively if internal accounting requires
     a specific amount, but the standard guarantees only the >= check.)

Maker registers the fill internally and returns:
  return received

Reentrancy:
  fillSellLimit MUST be guarded against reentrancy. The callback into
  the Taker MUST NOT be re-entrant into any state-mutating Maker
  function.
```

#### Behaviour of `onFillSellLimit` (Taker side)

```
Inputs from Maker:
  sellToken:              token already pushed to msg.sender (i.e., the Taker)
  sellAmountSent:         quantity of sellToken pushed
  buyToken:               token the Maker expects in return
  minBuyAmountRequired:   minimum quantity of buyToken to push back
  callbackData:           opaque blob from the Taker's own fillSellLimit call

Taker MUST:
  Validate that this callback corresponds to a fill it initiated
    (e.g., via a fillInFlight flag set in storage before calling fillSellLimit)
  Use the received sellToken however it wishes (sell on a market, etc.)
  Push at least minBuyAmountRequired of buyToken back to msg.sender
    via IERC20(buyToken).transfer(msg.sender, ...)
  Return normally

Taker MAY push more than minBuyAmountRequired; the Maker accepts the
surplus as a benefit. The Taker is responsible for ensuring it has
enough buyToken at the time of the transfer call.

If the Taker cannot satisfy the minimum, it MUST NOT transfer a
smaller amount and rely on the Maker to revert; instead, it SHOULD
revert from within the callback to give itself control over error
context. Either way, the entire fill transaction will revert.
```

### 6.2 BuyLimit

The Maker offers to buy a fixed quantity of `buyToken`, providing up
to a maximum quantity of `sellToken` in exchange. The Maker pushes
its full available `sellToken` allocation to the Taker, who uses it
to source the required `buyToken` and returns any unused `sellToken`
to the Maker.

#### Quote

```solidity
struct BuyLimitQuote {
    QuoteState state;
    address    buyToken;
    uint256    buyAmount;
    bool       allowPartials;
    uint256    minBuyRemainder;
    address    sellToken;
    uint256    maxSellAmount;
}
```

- `buyAmount` is the quantity of `buyToken` the Maker wants to acquire
  in this Quote.
- `maxSellAmount` is the maximum quantity of `sellToken` the Maker is
  willing to spend for the full `buyAmount`. Linear scaling applies
  for partial fills.
- `allowPartials` and `minBuyRemainder` are analogous to the SellLimit
  versions, but reference the `buyAmount` axis.

#### Maker Interface

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

#### Taker Callback Interface

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

#### Behaviour of `fillBuyLimit`

```
Inputs from caller:
  buyAmount:      quantity of buyToken the Taker will provide to the Maker
  minSellAmount:  Taker-side slippage bound — Taker refuses to operate
                  with less than this much sellToken pushed to it
  callbackData:   opaque blob
  deadline:       Unix timestamp

Maker validates:
  Require block.timestamp <= deadline
  Read current quote q via internal logic equivalent to quoteBuyLimit()
  Require q.state == QUOTE_AVAILABLE
  Require buyAmount > 0
  Require buyAmount <= q.buyAmount

  Partial fill regime:
    if buyAmount < q.buyAmount:
      Require q.allowPartials is true
      Compute remainder = q.buyAmount - buyAmount
      Require remainder == 0 OR remainder >= q.minBuyRemainder

  Compute pushedSellAmount:
    pushedSellAmount = mulDiv(buyAmount, q.maxSellAmount, q.buyAmount)
    (linear scaling)

  Require pushedSellAmount >= minSellAmount
    (Taker-side slippage check: Taker wants at least this much working
     capital; reverts if Maker's quote has degraded since polling)

Maker prepares:
  Perform any internal state preparation needed to make pushedSellAmount
  of sellToken available.

  Snapshot:
    buyTokenBefore  = IERC20(buyToken).balanceOf(address(this))
    sellTokenBefore = IERC20(sellToken).balanceOf(address(this))

Maker pushes:
  IERC20(sellToken).transfer(msg.sender, pushedSellAmount)

Maker calls back:
  IBuyLimitTaker(msg.sender).onFillBuyLimit(
      sellToken,
      pushedSellAmount,
      buyToken,
      buyAmount,
      callbackData
  )

After callback returns, Maker verifies:
  buyTokenReceived = IERC20(buyToken).balanceOf(address(this)) - buyTokenBefore
  Require buyTokenReceived == buyAmount
    (EXACT match; the Maker explicitly does not want more buyToken than
     ordered, because that implies it spent more sellToken than necessary.)

  sellTokenAfter = IERC20(sellToken).balanceOf(address(this))
  sellTokenSpent = sellTokenBefore - sellTokenAfter

  (sellTokenSpent <= pushedSellAmount; the difference is the unused
   working capital the Taker returned. The Maker SHOULD reconcile any
   refunded sellToken back into its internal accounting.)

Maker registers the fill internally and returns:
  return sellTokenSpent

Reentrancy:
  Same requirements as fillSellLimit.
```

#### Behaviour of `onFillBuyLimit` (Taker side)

```
Inputs from Maker:
  sellToken:               token pushed to the Taker as working capital
  maxSellAmountSent:       quantity of sellToken pushed
  buyToken:                token the Maker requires in return
  exactBuyAmountRequired:  exact quantity of buyToken to push back (no surplus, no shortage)
  callbackData:            opaque blob

Taker MUST:
  Validate that this callback corresponds to a fill it initiated
  Use up to maxSellAmountSent of sellToken to source exactly
    exactBuyAmountRequired of buyToken (e.g., by selling sellToken
    on a market)
  Push exactly exactBuyAmountRequired of buyToken back to msg.sender
  Push any unused sellToken back to msg.sender
  Return normally

If the Taker fails to source the exact required buyAmount, it MUST
revert. Pushing more than exactBuyAmountRequired of buyToken will
cause the Maker's verification check to fail and the entire transaction
to revert.
```

### 6.3 Bounty

The Maker offers a fixed payment in `bountyToken` in exchange for the
Taker performing some action that the Maker has specified. The
specifics of the action and how the Maker verifies its completion are
entirely Maker-implementation-defined; the standard provides only the
mechanism for offer, callback, and payment.

#### Quote

```solidity
struct BountyQuote {
    QuoteState state;
    address    bountyToken;
    uint256    bountyAmount;
    bytes      makerCalldata;
}
```

- `bountyAmount` is the quantity of `bountyToken` the Maker will pay
  for this fill.
- `makerCalldata` is an opaque blob defined by the Maker. Its content
  is the Maker's responsibility; the Taker treats it as unstructured
  data that is passed through unchanged. Common uses include
  task-specification (which compound to call, which buffer to drain,
  etc.) but the field MAY also be empty bytes.

#### Maker Interface

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

#### Taker Callback Interface

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

#### Behaviour of `fillBounty`

```
Inputs from caller:
  minBountyAmount:  Taker-side slippage bound — refuse if quote has dropped
  makerCalldata:    blob obtained from quoteBounty(), passed back unchanged
  takerCalldata:    Taker's own opaque blob for the callback
  deadline:         Unix timestamp

Maker validates:
  Require block.timestamp <= deadline
  Read current quote q via internal logic equivalent to quoteBounty()
  Require q.state == QUOTE_AVAILABLE
  Require q.bountyAmount >= minBountyAmount

  Maker MAY perform additional checks against makerCalldata as part of
  the standard pattern: e.g., verifying that makerCalldata matches the
  current task specification, or ignoring it entirely if the Maker does
  not use task-specification semantics. This is implementation-defined.

Maker prepares:
  Perform any internal state preparation; capture pre-callback state
  snapshots needed for post-callback verification (Maker-defined).

Maker pushes:
  IERC20(q.bountyToken).transfer(msg.sender, q.bountyAmount)

Maker calls back:
  IBountyTaker(msg.sender).onFillBounty(
      q.bountyToken,
      q.bountyAmount,
      makerCalldata,
      takerCalldata
  )

After callback returns, Maker verifies:
  Maker performs whatever post-conditions it requires.
  These are Maker-defined and not part of the standard.

  Examples:
    - For a compound bounty: verify the underlying position has been
      compounded (state delta on the position contract).
    - For a buffer drain: verify the buffer state has been zeroed.
    - For a notification bounty: no verification required; payment is
      unconditional once the call is made.

  If verification fails, the Maker MUST revert.

Maker registers the fill internally and returns:
  return q.bountyAmount

Reentrancy:
  Same requirements as fillSellLimit and fillBuyLimit.
```

#### Behaviour of `onFillBounty` (Taker side)

```
Inputs from Maker:
  bountyToken:        token pushed to the Taker
  bountyAmountSent:   quantity of bountyToken pushed
  makerCalldata:      Maker-specified data, opaque to the Taker
  takerCalldata:      Taker's own opaque blob

Taker:
  The Taker MUST validate that this callback corresponds to a fill
  it initiated.

  The Taker performs whatever work the bounty requires, which is
  defined off-chain. The Taker is expected to know — through Maker
  documentation, prior agreement, or interpretation of makerCalldata —
  what the Maker's verification logic will check.

  The Taker keeps the bountyAmountSent (no return transfer is required
  by the standard).

  The Taker returns normally if the work is done; it MAY revert if it
  detects an error in the work or in its own preconditions.

This callback intentionally has the loosest semantics of the three
because the action being performed is Maker-defined. Generic
Taker Bots cannot serve arbitrary Bounty Makers without prior
knowledge of the specific Maker's task scheme.
```

---

## 7. Maker Implementation Requirements

A compliant Maker Contract MUST:

- **M-01.** Implement ERC-165 (`supportsInterface(bytes4)`) and return
  `true` for every Maker interface it supports plus `0x01ffc9a7` (ERC-165 itself).

- **M-02.** Implement the full quote function and fill function for
  each Maker interface it claims to support.

- **M-03.** Honor `QuoteState` semantics: never return `QUOTE_AVAILABLE`
  from a quote function on which `TERMINATED` has previously been
  returned.

- **M-04.** Validate `deadline` at the start of every `fill*` call and
  revert if `block.timestamp > deadline`.

- **M-05.** Guard every `fill*` function against reentrancy. The
  callback frame MUST be the only re-entrancy point, and that frame
  MUST NOT permit re-entry into any other state-mutating Maker function.

- **M-06.** Revert (rather than return a default value) if any quote
  precondition fails during `fill*` (e.g., partials not allowed,
  remainder too small, slippage bound violated).

- **M-07.** For `fillSellLimit`: verify `received >= requiredBuyAmount`
  via balance delta after callback; revert otherwise.

- **M-08.** For `fillBuyLimit`: verify `buyTokenReceived ==
  buyAmount` (exact equality) via balance delta after callback; revert
  otherwise. The exact-match requirement is stricter than `>=` and
  exists because excess `buyToken` implies the Maker overspent
  `sellToken`.

A compliant Maker Contract SHOULD:

- **M-09.** Register itself with the Registry shortly after deployment,
  and deregister itself before becoming permanently inactive.

- **M-10.** Emit the corresponding `TERMINATED` quote response when an
  order type is permanently disabled, even if the Maker remains active
  on other order types.

A compliant Maker Contract MAY:

- **M-11.** Implement multiple Maker interfaces in a single contract,
  declaring all of them at registration time.

- **M-12.** Use Maker-internal pricing logic (oracles, TWAPs, internal
  state-derived limits) to dynamically compute Quote parameters. Such
  logic is invisible to the standard; the Quote itself is what counts.

---

## 8. Taker Bot Requirements

A compliant Taker Bot MUST:

- **T-01.** Honor the `QuoteState` semantics. After observing
  `TERMINATED` for a Maker's specific order type, the Bot MUST NOT
  call the corresponding `fill*` function on that Maker.

- **T-02.** Never submit a `fill*` transaction that depends on the
  Maker tolerating an out-of-spec callback response. Specifically:
  - For `onFillSellLimit`: push at least `minBuyAmountRequired`.
  - For `onFillBuyLimit`: push exactly `exactBuyAmountRequired` and
    return any unused `maxSellAmountSent` to the Maker.
  - For `onFillBounty`: meet whatever verification logic the Maker
    has documented; the standard does not enforce a specific
    response shape.

- **T-03.** Validate every callback by checking that it corresponds
  to a fill it initiated. Implementations typically use a transient
  storage flag set just before the `fill*` call.

- **T-04.** Use slippage bounds (`maxBuyAmount`, `minSellAmount`,
  `minBountyAmount`) on every `fill*` call to protect against
  Maker-side quote degradation between the polling-time observation
  and the in-block fill.

- **T-05.** Set `deadline` to a near-future timestamp (typically the
  current block timestamp plus a small buffer) on every `fill*` call
  to limit the time window during which the transaction can execute.

A compliant Taker Bot SHOULD:

- **T-06.** Subscribe to Registry events (`MakerRegistered`,
  `MakerDeregistered`, `InterfacesUpdated`) for its target chain(s)
  and maintain a local list of active Makers based on these events.

- **T-07.** Validate each newly-discovered Maker by calling each of
  its declared `quote*` functions once and verifying the response is
  well-formed (decode succeeds, token addresses are non-zero, amounts
  are nonzero where required, etc.) before adding it to the active
  polling list.

- **T-08.** Maintain a persistent blacklist of Maker addresses that
  failed validation, and decline to re-validate them unless the Bot
  operator explicitly resets the blacklist.

A compliant Taker Bot MAY:

- **T-09.** Use any polling cadence, profitability evaluation logic,
  capital sourcing strategy (own inventory, flash loans, market
  swaps), and execution mechanism (private mempool, public mempool,
  bundling) it sees fit. None of these are constrained by the
  standard.

- **T-10.** Restrict its operation to a curated subset of Makers
  (e.g., a Midcurve-maintained allowlist, an audit-based filter, etc.)
  rather than serving every registered Maker.

- **T-11.** Operate across multiple chains, each with its own Registry
  deployment.

---

## 9. Registry Deployment

The Registry contract is deployed once per supported chain. Deployment
addresses for each chain are published in the public Midcurve
documentation. The Registry MUST NOT be upgradable; if the standard
needs to evolve, a new Registry is deployed at a new address and Makers
re-register there.

The Registry constructor takes no parameters; the Registry has no
admin functions, no paused state, and no ownership.

---

## 10. Conformance Checklist

A Maker Contract is conformant if and only if it satisfies all of the
following:

- [ ] M-01: implements ERC-165 and returns `true` for each declared interface
- [ ] M-02: implements full quote and fill functions for each declared interface
- [ ] M-03: honors monotonic `TERMINATED` per interface
- [ ] M-04: validates `deadline` in every `fill*`
- [ ] M-05: reentrancy-guards every `fill*`
- [ ] M-06: reverts on every quote precondition failure in `fill*`
- [ ] M-07: enforces `received >= requiredBuyAmount` in `fillSellLimit`
- [ ] M-08: enforces `buyTokenReceived == buyAmount` in `fillBuyLimit`

A Taker Bot is conformant if and only if it satisfies all of the
following:

- [ ] T-01: honors `TERMINATED` and stops calling that interface
- [ ] T-02: respects callback minimums and exact-match constraints
- [ ] T-03: validates every callback as belonging to its own fill
- [ ] T-04: uses slippage bounds on every `fill*`
- [ ] T-05: uses near-future `deadline` on every `fill*`

---

## 11. Out of Scope

This standard does not specify, and implementations are free to choose
any approach for:

- Maker-side pricing logic, oracles, TWAPs, or any other source of
  truth used to compute Quote parameters.
- Maker-side internal state machines, position management, or buffer
  semantics. These are concerns of specific Maker types (see Midcurve's
  SPEC-0003c, SPEC-0004 for examples) and not of the standard.
- Taker Bot architecture, polling cadence, persistence layer,
  language, or hosting model.
- Capital sourcing for Taker fills (flash loans, owned inventory,
  market integrations).
- MEV protection strategies (private mempool, bundling, etc.).
- Cross-chain coordination or messaging.
- Reputation systems for Makers or Takers (these may emerge as
  off-chain services consuming on-chain fill events, but are not
  defined here).
- Aggregator services, orderbook UIs, or other tooling that consumes
  the standard. These are explicitly downstream and not part of the
  standard itself.
- Bytecode-level deduplication of similar Maker contracts.

---

## 12. Glossary

**ERC-165** — Ethereum interface detection standard.
`supportsInterface(bytes4)` returns `true` if a contract supports a
given interface identifier.

**Fill** — A single execution of an Order Type, atomic within one
transaction.

**Maker / Maker Contract** — The smart contract publishing offers.

**Order Type** — One of: SellLimit, BuyLimit, Bounty.

**Push-callback-verify** — The settlement pattern where the Maker
pushes tokens out, calls into the Taker, and verifies the result via
balance delta.

**Quote** — The data returned by a Maker's quote function, describing
the current state of one Order Type.

**Registry** — The permissionless on-chain directory of registered
Makers.

**Taker / Taker Bot** — The actor calling Maker fill functions,
typically off-chain software with an on-chain helper.

---

*End of standard.*
