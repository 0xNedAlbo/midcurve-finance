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
       ┌─────────────────────────┴─────────────────────────┐
       │                                                   │
       ▼                                                   ▼
┌─────────────┐                                    ┌──────────────┐
│   Maker     │ ◄──── quote* (view) ─────────────  │  Taker Bot   │
│  Contract   │                                    │              │
│             │ ◄──── fill* (state-changing) ───── │  + Taker     │
│  pushes,    │                                    │    Contract  │
│  callbacks, │ ──── on*Fill (callback) ─────────► │              │
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

The interfaces in this section are **single-quote** interfaces: each
exposes at most one active Quote at a time. Makers that genuinely
have multiple parallel offers of the same Order Type instead use the
**book variants** defined in §7. The two patterns coexist; a Maker
can implement either or both of single-quote and book interfaces of
the same Order Type.

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
    uint256    quoteValidUntil;
    bytes      extraData;
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
- `quoteValidUntil` is a Maker-supplied polling hint expressing the
  Unix timestamp (seconds) until which the Quote is expected to
  remain valid. See §6.5 for full semantics.
- `extraData` is an opaque, Maker-defined informational field. See
  §6.4 for full semantics.

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
    uint256    quoteValidUntil;
    bytes      extraData;
}
```

- `buyAmount` is the quantity of `buyToken` the Maker wants to acquire
  in this Quote.
- `maxSellAmount` is the maximum quantity of `sellToken` the Maker is
  willing to spend for the full `buyAmount`. Linear scaling applies
  for partial fills.
- `allowPartials` and `minBuyRemainder` are analogous to the SellLimit
  versions, but reference the `buyAmount` axis.
- `quoteValidUntil` is a Maker-supplied polling hint expressing the
  Unix timestamp (seconds) until which the Quote is expected to
  remain valid. See §6.5 for full semantics.
- `extraData` is an opaque, Maker-defined informational field. See
  §6.4 for full semantics.

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
    uint256    quoteValidUntil;
    bytes      extraData;
}
```

- `bountyAmount` is the quantity of `bountyToken` the Maker will pay
  for this fill.
- `makerCalldata` is an opaque blob defined by the Maker. Its content
  is the Maker's responsibility; the Taker treats it as unstructured
  data that is passed through unchanged. Common uses include
  task-specification (which compound to call, which buffer to drain,
  etc.) but the field MAY also be empty bytes.
- `quoteValidUntil` is a Maker-supplied polling hint expressing the
  Unix timestamp (seconds) until which the Quote is expected to
  remain valid. See §6.5 for full semantics.
- `extraData` is an opaque, Maker-defined informational field, distinct
  from `makerCalldata` in that it is not passed back to the Maker on
  fill. See §6.4 for full semantics.

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

### 6.4 `extraData` — informational Maker context

All three Quote structs include a final `extraData` field of type
`bytes`. The semantics are uniform across order types:

- **Maker-defined.** The Maker chooses what to put in this field, and
  in what format. Common uses include position identifiers, vault type
  tags, strategy names, version markers, or links to off-chain
  metadata. The standard does not impose any structure.

- **Informational only.** The Taker reads `extraData` and MAY use it
  for profitability evaluation, routing decisions, filtering, or any
  other purpose. The standard does not require the Taker to act on
  `extraData` in any specific way.

- **Not bound to fill execution.** `extraData` is NOT a fill argument
  and is NOT passed back to the Maker through `fill*`. It is also NOT
  forwarded into the Taker callback by the Maker. If the Taker needs
  `extraData` available inside the callback, the Taker copies it from
  the Quote into the `callbackData` argument when calling `fill*`.

- **Not part of quote consistency.** A Maker MAY change `extraData`
  between a Taker's quote observation and the subsequent fill without
  affecting the validity of the fill. The standard does not enforce
  consistency on this field.

- **MAY be empty.** Makers that have no contextual information to
  publish set `extraData = bytes("")`. Taker Bots MUST tolerate empty
  `extraData`.

Distinction from `makerCalldata` (Bounty only): `makerCalldata` is
returned by the Taker to the Maker on fill and may participate in the
Maker's task-verification logic. `extraData` is read-only context
that flows from Maker to Taker and never returns. A Bounty Maker uses
`makerCalldata` for task specification (binding) and `extraData` for
context (informational).

#### 6.4.1 Schema-typed extraData (informational)

A common idiom is for a family of related Makers to use `extraData`
to communicate structured, family-specific information to specialised
Takers. This works as follows:

- The Maker family agrees on a schema (e.g., a struct layout) and a
  schema identifier (e.g., a `bytes32` constant such as
  `keccak256("midcurve-sltp-v1")`).
- Each Maker in the family encodes its `extraData` with the schema
  identifier as the first field, followed by the schema-specific
  payload.
- Specialised Taker Bots that know the schema can decode `extraData`
  to enable optimisations such as: skipping `quote*()` calls when
  trigger conditions are not met, batching multiple Makers that
  share a common data source (e.g., the same UniswapV3 pool), or
  filtering Makers by family-specific criteria.
- Generic Taker Bots that do not know the schema simply ignore
  `extraData` and treat each Maker uniformly.

The standard does not define any specific schemas. Schema definitions
are off-chain agreements between Maker families and their associated
Takers.

### 6.5 `quoteValidUntil` — polling hint

All three Quote structs include a `quoteValidUntil` field of type
`uint256`. Its semantics are uniform across order types:

- **Unix timestamp in seconds.** The value is a Unix timestamp,
  identical in format to `block.timestamp` and to the `deadline`
  argument of `fill*` functions. A Maker computes it as
  `block.timestamp + N` where `N` is the desired validity window in
  seconds.

- **Polling hint, not enforcement.** `quoteValidUntil` is informational
  guidance from the Maker to the Taker. It signals the Maker's
  expectation of when the Quote will need to be refreshed. The Maker
  MUST NOT enforce this value in any `fill*` function; the only
  durable time bound on a fill is the `deadline` argument supplied by
  the Taker. A Maker MAY return new Quote values before the previous
  `quoteValidUntil` elapses; this is normal and not a protocol
  violation.

- **`quoteValidUntil = 0` means "no hint".** A Maker that has no
  preference about polling frequency sets the value to `0`. The Taker
  treats this as the absence of a hint and polls according to its
  own strategy.

- **Maximum effective horizon: 28 days.** Taker Bots MUST poll any
  active Maker at least once every 28 days regardless of
  `quoteValidUntil`. A Taker treats Maker-supplied values larger than
  `block.timestamp + 28 days` as if they were exactly
  `block.timestamp + 28 days`. Concretely, the effective polling
  deadline a Taker applies is:

  ```
  effectiveValidUntil = min(
      quote.quoteValidUntil > 0 ? quote.quoteValidUntil : type(uint256).max,
      now + 28 days
  )
  ```

  This bound ensures that no Maker can become invisible by claiming
  indefinite validity. 28 days = 2,419,200 seconds.

- **Taker MAY poll earlier.** Nothing in the standard prevents a
  Taker from polling more frequently than `quoteValidUntil` suggests.
  Hints are upper bounds on Taker patience, not lower bounds.

A typical use case: a Maker holding a stable position that updates its
Quote only on owner action might set `quoteValidUntil = block.timestamp
+ 7 days` to reduce unnecessary polling traffic. A Maker computing
its Quote off a fast-moving spot price might set
`quoteValidUntil = block.timestamp + 30` (i.e., 30 seconds ahead) to
signal that the Quote will likely be stale soon.

---

## 7. Book Variants — Multiple Parallel Offers

The Maker interfaces defined in §6 are **single-quote** interfaces:
each interface offers at most one active Quote at any time. The
**book variants** defined in this section serve Makers that genuinely
have multiple parallel offers of the same Order Type — for example, a
market-making contract publishing quotes at multiple price points, or
a vault holding several positions that can be settled independently.

A Book Maker exposes multiple parallel offers of the same Order Type
but performs no matching: Takers choose which offer to fill by
referencing its `quoteId`. Each Book interface is a strict superset
of the corresponding single-quote interface in expressive power; a
single-quote Maker is conceptually a Book Maker with at most one
offer. Nevertheless, single-quote and book interfaces are defined
separately and coexist as equally valid patterns. Choose the simpler
single-quote interface when at most one offer is needed; choose the
book interface when genuine parallelism is required.

A Maker MAY implement both the single-quote and the book interface
of the same Order Type in one contract, exposing the same data via
two access shapes. Generic Taker Bots benefit from the single-quote
view; specialised Bots benefit from the richer book view.

### 7.1 BookSellLimit

#### Offer

```solidity
struct SellLimitOffer {
    uint256    quoteId;
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

The fields are identical in semantics to those of `SellLimitQuote`
(§6.1), with the addition of `quoteId`. Each offer in a book carries
its own `quoteValidUntil` and `extraData` independent of the others.

#### Quote

```solidity
struct BookSellLimitQuote {
    QuoteState state;
    SellLimitOffer[] offers;
}
```

- When `state == QUOTE_AVAILABLE`, `offers` contains one or more
  concrete offers. Every offer in the array is independently
  fillable; the Maker MUST NOT return offers that cannot currently
  be filled.
- When `state == NO_QUOTE`, `offers` is empty.
- When `state == TERMINATED`, `offers` is empty and the Maker will
  never again return `QUOTE_AVAILABLE` from this interface.

The `quoteId` of each offer MUST be unique within the same returned
array. Quote-IDs MAY be reused across time: a Maker MAY return the
same `quoteId` repeatedly across polling cycles to reference the same
underlying offer, even as the offer's other parameters change.

#### Maker Interface

```solidity
interface IBookSellLimitMaker {
    function quoteBookSellLimit() external view returns (BookSellLimitQuote memory);

    function fillBookSellLimit(
        uint256 quoteId,
        uint256 sellAmount,
        uint256 maxBuyAmount,
        bytes calldata callbackData,
        uint256 deadline
    ) external returns (uint256 buyAmountReceived);
}
```

#### Taker Callback Interface

```solidity
interface IBookSellLimitTaker {
    function onFillBookSellLimit(
        uint256 quoteId,
        address sellToken,
        uint256 sellAmountSent,
        address buyToken,
        uint256 minBuyAmountRequired,
        bytes calldata callbackData
    ) external;
}
```

#### Behaviour of `fillBookSellLimit`

```
Inputs from caller:
  quoteId:       references the specific offer to fill
  sellAmount:    quantity of sellToken the Taker wants to take
  maxBuyAmount:  Taker-side slippage bound
  callbackData:  opaque blob
  deadline:      Unix timestamp

Maker validates:
  Require block.timestamp <= deadline
  Read current book b via internal logic equivalent to quoteBookSellLimit()
  Require b.state == QUOTE_AVAILABLE
  
  Locate offer with matching quoteId in b.offers
    Revert if not found ("UnknownQuoteId")
    Let o = the matching offer
  
  Apply the same per-offer validation as fillSellLimit (§6.1):
    sellAmount <= o.sellAmount
    Partial-fill regime checks against o.allowPartials, o.minSellRemainder
    Linear-scaled requiredBuyAmount = mulDiv(sellAmount, o.minBuyAmount, o.sellAmount)
    requiredBuyAmount <= maxBuyAmount

The Maker proceeds with the same push-callback-verify pattern as
fillSellLimit (§6.1), with the callback dispatched as:

  IBookSellLimitTaker(msg.sender).onFillBookSellLimit(
      quoteId,
      o.sellToken,
      sellAmount,
      o.buyToken,
      requiredBuyAmount,
      callbackData
  )

After callback, Maker verifies received >= requiredBuyAmount
(same semantics as §6.1) and returns the received amount.

Filling one offer in a book MUST NOT affect the validity or
parameters of other offers in the same book, except where the Maker's
internal state genuinely couples them (e.g., shared inventory).
```

### 7.2 BookBuyLimit

#### Offer

```solidity
struct BuyLimitOffer {
    uint256    quoteId;
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

Fields identical in semantics to `BuyLimitQuote` (§6.2) plus `quoteId`.

#### Quote

```solidity
struct BookBuyLimitQuote {
    QuoteState state;
    BuyLimitOffer[] offers;
}
```

Same uniqueness and lifecycle constraints as `BookSellLimitQuote`
(§7.1).

#### Maker Interface

```solidity
interface IBookBuyLimitMaker {
    function quoteBookBuyLimit() external view returns (BookBuyLimitQuote memory);

    function fillBookBuyLimit(
        uint256 quoteId,
        uint256 buyAmount,
        uint256 minSellAmount,
        bytes calldata callbackData,
        uint256 deadline
    ) external returns (uint256 sellAmountSpent);
}
```

#### Taker Callback Interface

```solidity
interface IBookBuyLimitTaker {
    function onFillBookBuyLimit(
        uint256 quoteId,
        address sellToken,
        uint256 maxSellAmountSent,
        address buyToken,
        uint256 exactBuyAmountRequired,
        bytes calldata callbackData
    ) external;
}
```

#### Behaviour of `fillBookBuyLimit`

Identical to `fillBuyLimit` (§6.2), with the addition that the Maker
locates the offer by `quoteId` before validation, and the callback is
dispatched as:

```
IBookBuyLimitTaker(msg.sender).onFillBookBuyLimit(
    quoteId,
    o.sellToken,
    pushedSellAmount,
    o.buyToken,
    buyAmount,
    callbackData
)
```

The exact-match verification (`buyTokenReceived == buyAmount`) and
the sellToken-refund accounting are identical to §6.2.

### 7.3 BookBounty

#### Offer

```solidity
struct BountyOffer {
    uint256    quoteId;
    address    bountyToken;
    uint256    bountyAmount;
    bytes      makerCalldata;
    uint256    quoteValidUntil;
    bytes      extraData;
}
```

Fields identical in semantics to `BountyQuote` (§6.3) plus `quoteId`.

#### Quote

```solidity
struct BookBountyQuote {
    QuoteState state;
    BountyOffer[] offers;
}
```

Same uniqueness and lifecycle constraints as `BookSellLimitQuote`
(§7.1).

#### Maker Interface

```solidity
interface IBookBountyMaker {
    function quoteBookBounty() external view returns (BookBountyQuote memory);

    function fillBookBounty(
        uint256 quoteId,
        uint256 minBountyAmount,
        bytes calldata makerCalldata,
        bytes calldata takerCalldata,
        uint256 deadline
    ) external returns (uint256 bountyPaid);
}
```

#### Taker Callback Interface

```solidity
interface IBookBountyTaker {
    function onFillBookBounty(
        uint256 quoteId,
        address bountyToken,
        uint256 bountyAmountSent,
        bytes calldata makerCalldata,
        bytes calldata takerCalldata
    ) external;
}
```

#### Behaviour of `fillBookBounty`

Identical to `fillBounty` (§6.3), with the addition that the Maker
locates the offer by `quoteId` before validation. The callback is
dispatched as:

```
IBookBountyTaker(msg.sender).onFillBookBounty(
    quoteId,
    o.bountyToken,
    o.bountyAmount,
    makerCalldata,
    takerCalldata
)
```

Maker-defined post-callback verification semantics are identical to
§6.3.

### 7.4 ID Stability and Polling Discipline

A Maker MUST guarantee `quoteId` uniqueness **within a single returned
book**. A Maker MAY but is not required to keep `quoteId` values stable
across polling cycles. Two cases are typical:

- **Stable IDs:** The Maker uses identifiers derived from durable
  internal state (e.g., a position-NFT tokenId, a hash of position
  parameters). The same `quoteId` references the same logical offer
  across polling cycles, even as Quote parameters evolve. This is
  the recommended pattern.

- **Volatile IDs:** The Maker generates IDs ad-hoc per quote call
  (e.g., a sequence counter). IDs do not correspond across calls.
  Less informative for Takers but valid.

Takers MUST treat `quoteId` as the only stable handle to an offer
within a book. Indices into the `offers` array are NOT stable: the
Maker MAY reorder, add, or remove offers between calls. A Taker that
caches `(maker, indexInArray)` between polling cycles is wrong; only
`(maker, quoteId)` is meaningful.

When invoking `fill*`, the Taker MUST use the `quoteId` that was
present in a recent quote response. Calling `fill*` with a `quoteId`
that does not exist in the current book causes the Maker to revert.

### 7.5 ERC-165 Interface Identifiers

```solidity
bytes4 constant IBOOK_SELL_LIMIT_MAKER_ID = type(IBookSellLimitMaker).interfaceId;
bytes4 constant IBOOK_BUY_LIMIT_MAKER_ID  = type(IBookBuyLimitMaker).interfaceId;
bytes4 constant IBOOK_BOUNTY_MAKER_ID     = type(IBookBountyMaker).interfaceId;
```

A Book Maker registers these identifiers with the Registry exactly as
single-quote Makers register their interface identifiers (§5).

---

## 8. Maker Implementation Requirements

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

- **M-09.** MUST NOT enforce `quoteValidUntil` in any `fill*` function.
  The only durable time bound on a fill is the `deadline` argument
  supplied by the Taker. A Maker MAY return a Quote whose
  `quoteValidUntil` has already elapsed; the Taker decides whether to
  fill anyway.

- **M-15.** For Book interfaces (§7): every offer in a returned book
  MUST have a `quoteId` unique within that book. Calling a `fill*`
  function with a `quoteId` not present in the current book MUST
  revert.

- **M-16.** For Book interfaces (§7): each offer in a returned book
  MUST be independently fillable. A Maker MUST NOT return offers in
  the book that cannot currently be filled at the listed parameters.

A compliant Maker Contract SHOULD:

- **M-10.** Register itself with the Registry shortly after deployment,
  and deregister itself before becoming permanently inactive.

- **M-11.** Emit the corresponding `TERMINATED` quote response when an
  order type is permanently disabled, even if the Maker remains active
  on other order types.

- **M-17.** For Book interfaces (§7): use stable `quoteId` values that
  reference the same logical offer across polling cycles, even as the
  offer's parameters change. This enables Takers to track offers
  reliably over time.

A compliant Maker Contract MAY:

- **M-12.** Implement multiple Maker interfaces in a single contract,
  declaring all of them at registration time.

- **M-13.** Use Maker-internal pricing logic (oracles, TWAPs, internal
  state-derived limits) to dynamically compute Quote parameters. Such
  logic is invisible to the standard; the Quote itself is what counts.

- **M-14.** Set `quoteValidUntil = 0` in any Quote where the Maker
  has no opinion about polling frequency.

- **M-18.** Implement both the single-quote interface (§6) and the
  corresponding book interface (§7) of the same Order Type, exposing
  the same underlying offer(s) through both. Generic Takers benefit
  from the simpler single-quote view; specialised Takers benefit
  from the richer book view.

---

## 9. Taker Bot Requirements

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

- **T-06.** Poll any active Maker at least once every 28 days,
  regardless of `quoteValidUntil`. Maker-supplied values exceeding
  `block.timestamp + 28 days` MUST be treated as if they were exactly
  `block.timestamp + 28 days`. This ensures no Maker can become
  invisible by claiming indefinite validity.

- **T-14.** When filling against a Book Maker (§7), use the
  `quoteId` returned in a recent quote response as the only stable
  reference to an offer. Do NOT cache offers by their position in
  the `offers` array; the Maker MAY reorder, add, or remove offers
  between calls. Only `(maker, quoteId)` is a meaningful handle.

A compliant Taker Bot SHOULD:

- **T-07.** Subscribe to Registry events (`MakerRegistered`,
  `MakerDeregistered`, `InterfacesUpdated`) for its target chain(s)
  and maintain a local list of active Makers based on these events.

- **T-08.** Validate each newly-discovered Maker by calling each of
  its declared `quote*` functions once and verifying the response is
  well-formed (decode succeeds, token addresses are non-zero, amounts
  are nonzero where required, etc.) before adding it to the active
  polling list.

- **T-09.** Maintain a persistent blacklist of Maker addresses that
  failed validation, and decline to re-validate them unless the Bot
  operator explicitly resets the blacklist.

- **T-10.** Respect `quoteValidUntil` (when non-zero) as guidance for
  scheduling the next poll of a given Maker. Polling earlier than
  `quoteValidUntil` is permitted but typically wasteful.

A compliant Taker Bot MAY:

- **T-11.** Use any polling cadence, profitability evaluation logic,
  capital sourcing strategy (own inventory, flash loans, market
  swaps), and execution mechanism (private mempool, public mempool,
  bundling) it sees fit. None of these are constrained by the
  standard.

- **T-12.** Restrict its operation to a curated subset of Makers
  (e.g., a Midcurve-maintained allowlist, an audit-based filter, etc.)
  rather than serving every registered Maker.

- **T-13.** Operate across multiple chains, each with its own Registry
  deployment.

---

## 10. Registry Deployment

The Registry contract is deployed once per supported chain. Deployment
addresses for each chain are published in the public Midcurve
documentation. The Registry MUST NOT be upgradable; if the standard
needs to evolve, a new Registry is deployed at a new address and Makers
re-register there.

The Registry constructor takes no parameters; the Registry has no
admin functions, no paused state, and no ownership.

---

## 11. Conformance Checklist

A Maker Contract is conformant if and only if it satisfies all of the
following:

- [ ] M-01: implements ERC-165 and returns `true` for each declared interface
- [ ] M-02: implements full quote and fill functions for each declared interface
- [ ] M-03: honors monotonic `TERMINATED` per interface
- [ ] M-04: validates `deadline` in every `fill*`
- [ ] M-05: reentrancy-guards every `fill*`
- [ ] M-06: reverts on every quote precondition failure in `fill*`
- [ ] M-07: enforces `received >= requiredBuyAmount` in `fillSellLimit` (and `fillBookSellLimit`)
- [ ] M-08: enforces `buyTokenReceived == buyAmount` in `fillBuyLimit` (and `fillBookBuyLimit`)
- [ ] M-09: does NOT enforce `quoteValidUntil` in any `fill*`
- [ ] M-15: For Book interfaces — `quoteId` unique within a book; reverts on unknown ID
- [ ] M-16: For Book interfaces — every offer in the book is independently fillable

A Taker Bot is conformant if and only if it satisfies all of the
following:

- [ ] T-01: honors `TERMINATED` and stops calling that interface
- [ ] T-02: respects callback minimums and exact-match constraints
- [ ] T-03: validates every callback as belonging to its own fill
- [ ] T-04: uses slippage bounds on every `fill*`
- [ ] T-05: uses near-future `deadline` on every `fill*`
- [ ] T-06: polls every active Maker at least once every 28 days, capping `quoteValidUntil`
- [ ] T-14: For Book interfaces — uses `quoteId` (not array position) as the stable offer reference

---

## 12. Out of Scope

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

## 13. Glossary

**Book** — A collection of multiple parallel offers of the same
Order Type, exposed by a single Maker via the Book Variants (§7).

**ERC-165** — Ethereum interface detection standard.
`supportsInterface(bytes4)` returns `true` if a contract supports a
given interface identifier.

**Fill** — A single execution of an Order Type, atomic within one
transaction.

**Maker / Maker Contract** — The smart contract publishing offers.

**Offer** — A single concrete proposal within a book Quote, identified
by its `quoteId`.

**Order Type** — One of: SellLimit, BuyLimit, Bounty.

**Push-callback-verify** — The settlement pattern where the Maker
pushes tokens out, calls into the Taker, and verifies the result via
balance delta.

**Quote** — The data returned by a Maker's quote function. For
single-quote interfaces, the Quote describes the current state of
one Order Type. For book interfaces, the Quote contains a list of
offers.

**quoteId** — The stable identifier used in book interfaces to
reference one specific offer within a book.

**Registry** — The permissionless on-chain directory of registered
Makers.

**Taker / Taker Bot** — The actor calling Maker fill functions,
typically off-chain software with an on-chain helper.

---

## 14. Future Extensions

The standard is designed for forward-compatibility. The following
Maker-interface families are anticipated as future additions and
their naming conventions are reserved:

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
single-quote and book interfaces remain unchanged when new interface
families are introduced. A Maker MAY implement any combination of
single-quote, book, batch, and basket interfaces in a single contract.
Each new interface family is registered with the Registry through its
own ERC-165 interface identifier.

---

*End of standard.*
