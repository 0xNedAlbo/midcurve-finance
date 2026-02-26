# PRD: Permissionless Close Order Execution with On-Chain Price Validation

**Author:** Jan (Midcurve Finance)
**Status:** Draft
**Created:** 2026-02-26
**Last Updated:** 2026-02-26

---

## 1. Overview

This PRD describes how to make close order execution within the existing UniswapV3PositionCloser Diamond fully permissionless and trustless. Today, only a designated operator (Midcurve's automation wallet) can execute close orders, and the user trusts that the operator computes fair swap parameters. This upgrade moves all price validation on-chain so that **anyone** can execute a triggered close order while the smart contract autonomously enforces the user's price protection.

The system introduces an **oracle adapter chain** — an ordered list of on-chain price sources that the contract iterates at execution time to derive a reference price. The user defines this chain when registering the order. The contract uses the first valid price to compute `minAmountOut`, enforcing the user's `swapSlippageBps` tolerance without trusting the executor.

---

## 2. Problem Statement

When a close order triggers (price crosses `triggerTick`), the executor calls `executeOrder()` with off-chain computed parameters:
- `withdrawParams.amount0Min / amount1Min` — slippage protection for liquidity withdrawal
- `swapParams.minAmountOut` — slippage protection for the post-close token swap
- `swapParams.hops` — the swap route

Currently, only `order.operator` can call `executeOrder()`. The user trusts that this operator will:
1. Compute withdrawal minimums from a recent `sqrtPriceX96` reading
2. Obtain a fair market quote for the swap (currently via CoinGecko + Paraswap)
3. Set `minAmountOut` to protect against execution at unfavorable prices
4. Not delay execution to benefit from price movement

Without on-chain validation, a compromised or malicious operator could:
- Set `amount0Min = 0, amount1Min = 0` to enable sandwich attacks on withdrawal
- Set `minAmountOut = 0` to extract value during the swap
- Route through low-liquidity venues

This upgrade eliminates these trust assumptions by validating all execution parameters on-chain against oracle-derived reference prices.

---

## 3. Design Principles

1. **Trustless**: The user must not trust the executor. All execution constraints are enforced by the contract.
2. **Permissionless**: Anyone can execute any triggered order. No operator restriction, no whitelisting.
3. **Self-Sovereign Oracle Selection**: The user defines their own oracle adapter chain at registration time and signs over it (via `registerOrder` transaction). The protocol does not impose which oracles are "correct."
4. **Graceful Degradation**: If no oracle returns a valid price, the transaction reverts. The user is never worse off — in the worst case, nothing happens.
5. **Clean Slate**: No production data to preserve. The contract is redeployed with a clean struct layout. The MidcurveSwapRouter is unchanged.
6. **Keeper-Incentivized**: Executors are compensated via the existing fee mechanism (up to `maxFeeBps`), creating a competitive keeper market.

---

## 4. Current System Summary

### 4.1 Contract Architecture

The UniswapV3PositionCloser is an EIP-2535 Diamond proxy with these facets:

| Facet | Purpose |
|---|---|
| RegistrationFacet | Order creation (`registerOrder`) and cancellation |
| ExecutionFacet | Order execution when trigger fires |
| OwnerUpdateFacet | Owner-only parameter updates |
| ViewFacet | Read-only queries |
| DiamondCutFacet | Facet upgrade mechanism |
| MulticallFacet | Batch calls |
| VersionFacet | Version querying |

### 4.2 Current CloseOrder Storage (Being Replaced)

```solidity
// CURRENT (V1) — will be replaced entirely
struct CloseOrder {
    OrderStatus status;
    uint256 nftId;
    address owner;
    address pool;
    int24 triggerTick;
    address payout;
    address operator;           // ← REMOVED: trust assumption, no longer needed
    uint256 validUntil;
    uint16 slippageBps;
    SwapDirection swapDirection;
    uint16 swapSlippageBps;
}
```

### 4.3 Current Execution Flow (Being Replaced)

```
executeOrder(nftId, triggerMode, withdrawParams, swapParams, feeParams)

1. Validate status = ACTIVE
2. Validate msg.sender == order.operator        ← REMOVED
3. Check expiry
4. Validate fee <= maxFeeBps
5. Check trigger condition (tick-based)
6. Validate NFT ownership + approval
7. Pull NFT, withdraw liquidity, collect tokens
8. Apply fees
9. Two-phase swap:
   - Phase 1: guaranteedAmountIn through hops with minAmountOut  ← TRUST POINT (validated by oracle)
   - Phase 2: surplus through position's own pool (no minAmountOut)
10. Payout to user
11. Return empty NFT
12. Cancel counterpart order
```

### 4.4 Two-Phase Swap (Preserved)

The existing two-phase swap logic is preserved unchanged:

- **Phase 1 (Guaranteed)**: A predictable minimum amount (`guaranteedAmountIn`) is routed through executor-provided hops with `minAmountOut` protection. The oracle validates that `minAmountOut` meets the fair-value floor.
- **Phase 2 (Surplus)**: Any tokens above `guaranteedAmountIn` are routed through the position's own UniswapV3 pool with no `minAmountOut` (built on-chain). This is acceptable because the surplus amount is unpredictable and typically small.

### 4.5 Existing Libraries

| Library | Location | Relevance |
|---|---|---|
| `LiquidityAmounts` | `contracts/position-closer/libraries/LiquidityAmounts.sol` | Computes token amounts from liquidity — used for on-chain withdrawal validation |
| `TickMath` | `contracts/position-closer/libraries/TickMath.sol` | Tick ↔ sqrtPriceX96 conversion — used by TWAP adapter |

---

## 5. Architecture

### 5.1 System Overview

```
User registers order with oracle adapter chain
         │
         ▼
┌────────────────────────────────────────────────────┐
│           UniswapV3PositionCloser Diamond           │
│                                                    │
│  CloseOrder {                                      │
│    ...position, trigger, payout, slippage...       │
│    oracleChain: OracleAdapterCall[]                │
│  }  (no operator field)                                                 │
│                                                    │
│  ExecutionFacet.executeOrder():                     │
│    1. Check trigger condition                       │
│    2. Compute withdrawal mins on-chain  ← NEW      │
│    3. Query oracle chain for ref price  ← NEW      │
│    4. Validate swap minAmountOut        ← NEW      │
│    5. Withdraw liquidity                            │
│    6. Apply fees (keeper incentive)                 │
│    7. Two-phase swap via MidcurveSwapRouter         │
│    8. Payout to user                                │
└──────────┬───────────────────────┬─────────────────┘
           │                       │
           ▼                       ▼
┌──────────────────┐  ┌───────────────────────────┐
│  Oracle Adapters  │  │  MidcurveSwapRouter       │
│  (view only)      │  │  (existing, unchanged)    │
│                   │  │                           │
│  IOracleAdapter[] │  │  Multi-venue, multi-hop   │
└──┬───┬───┬───┬───┘  └───────────────────────────┘
   │   │   │   │
   ▼   ▼   ▼   ▼
 CL  Comp  TWAP  Spot
Adpt CL    Adpt  Adpt
     Adpt
```

### 5.2 Core Data Structures

#### 5.2.1 Oracle Adapter Interface

```solidity
interface IOracleAdapter {
    /// @notice Get the price of base/quote from this oracle source
    /// @param base Base token address
    /// @param quote Quote token address
    /// @param params Adapter-specific configuration (ABI-encoded)
    /// @return price Normalized price with 18 decimals (base per quote)
    /// @return valid Whether the price should be trusted
    function getPrice(
        address base,
        address quote,
        bytes calldata params
    ) external view returns (uint256 price, bool valid);
}
```

#### 5.2.2 Oracle Chain Storage

```solidity
struct OracleAdapterCall {
    IOracleAdapter adapter;   // Adapter contract address
    bytes params;             // Adapter-specific encoded parameters
}
```

#### 5.2.3 CloseOrder (New)

```solidity
struct CloseOrder {
    OrderStatus status;
    uint256 nftId;
    address owner;              // NFT owner at registration time
    address pool;               // Uniswap V3 pool address
    int24 triggerTick;          // Price threshold as tick value
    address payout;             // Recipient of closed position tokens
    uint256 validUntil;         // Expiration timestamp (0 = no expiry)
    uint16 slippageBps;         // Withdrawal slippage tolerance (0-10000)
    SwapDirection swapDirection;    // Post-close swap direction
    uint16 swapSlippageBps;         // Max deviation from oracle price (0-10000)
    OracleAdapterCall[] oracleChain;  // User-defined oracle fallback chain
}
```

**Changes from V1**:
- `operator` field **removed** — execution is permissionless, no trusted operator
- `oracleChain` field **added** — stored as a proper dynamic array (not ABI-encoded bytes)

Since there is no production data to preserve, the contract is redeployed with a clean storage layout. No backward compatibility constraints.

### 5.3 Updated Execution Flow

```
executeOrder(nftId, triggerMode, withdrawParams, swapParams, feeParams)
│
├─ 1. Validate status = ACTIVE
├─ 2. Check expiry: block.timestamp <= validUntil
├─ 3. Validate fee: feeBps <= maxFeeBps
│
├─ 4. Check trigger condition (tick-based, unchanged):
│     Read pool.slot0() → currentTick
│     LOWER: currentTick <= triggerTick
│     UPPER: currentTick >= triggerTick
│
├─ 5. Validate NFT ownership + approval (unchanged)
│
├─ 6. On-chain withdrawal validation (NEW):
│     Read sqrtPriceX96 from pool.slot0()
│     Read position liquidity, tickLower, tickUpper from NFPM
│     Compute expected amounts via LiquidityAmounts.getAmountsForLiquidity()
│     Apply order.slippageBps to get on-chain floor
│     Require withdrawParams.amount0Min >= floor0
│     Require withdrawParams.amount1Min >= floor1
│
├─ 7. Oracle-validated swap params (NEW, if swapDirection != NONE):
│     Iterate order.oracleChain:
│       (price, valid) = adapter.getPrice(tokenIn, tokenOut, params)
│       if valid → use as referencePrice, break
│     if no valid price → revert("NO_VALID_ORACLE")
│     Compute oracleMinAmountOut from referencePrice and swapSlippageBps
│     Require swapParams.minAmountOut >= oracleMinAmountOut
│
├─ 8. Pull NFT, withdraw liquidity, collect tokens (unchanged)
├─ 9. Apply fees (unchanged — executor sets feeRecipient + feeBps)
├─ 10. Two-phase swap via MidcurveSwapRouter (unchanged)
├─ 11. Payout (unchanged)
├─ 12. Return NFT (unchanged)
└─ 13. Cancel counterpart order (unchanged)
```

**Key change**: There is no operator check — anyone can call `executeOrder`. Steps 6 and 7 provide trustless on-chain validation that any executor must satisfy.

---

## 6. Oracle Adapter Specifications

### 6.1 ChainlinkAdapter

Reads a single Chainlink AggregatorV3 price feed.

**Params encoding**: `abi.encode(address feed, uint32 maxStaleness)`

**Behavior**:
- Calls `latestRoundData()` on the feed
- Returns `valid = false` if `block.timestamp - updatedAt > maxStaleness`
- Returns `valid = false` if `answer <= 0`
- Normalizes from feed decimals (typically 8) to 18 decimals

**Gas cost**: ~25,000

### 6.2 CompositeChainlinkAdapter

Derives a cross-pair price from two Chainlink USD feeds: `price(A/B) = price(A/USD) / price(B/USD)`.

**Params encoding**: `abi.encode(address feedA, address feedB, uint32 maxStaleness)`

**Behavior**:
- Calls `latestRoundData()` on both feeds
- Returns `valid = false` if either feed is stale or returns `answer <= 0`
- Computes `(answerA * 1e18) / answerB` with decimal normalization

**Gas cost**: ~50,000

### 6.3 UniswapTWAPAdapter

Reads a time-weighted average price from a Uniswap V3 pool via `pool.observe()`.

**Params encoding**: `abi.encode(address pool, uint32 twapWindow)`

**Behavior**:
- Calls `pool.observe([twapWindow, 0])` to get `tickCumulatives`
- Computes arithmetic mean tick: `(tickCum[1] - tickCum[0]) / twapWindow`
- Converts tick to price via `TickMath.getSqrtRatioAtTick()`
- Returns `valid = false` if `observe()` reverts (insufficient cardinality)
- Normalizes to 18 decimals accounting for token decimal differences

**Gas cost**: ~30,000

### 6.4 SpotPriceAdapter

Reads the current spot price from a Uniswap V3 pool's `slot0`.

**Params encoding**: `abi.encode(address pool)`

**Behavior**:
- Reads `slot0().sqrtPriceX96`
- Converts to price with 18-decimal normalization
- Always returns `valid = true` (fallback of last resort)

**Gas cost**: ~5,000

**Risk**: Spot price is manipulable within a single block (flash loans, sandwich attacks). Combined with `swapSlippageBps`, manipulation causes the transaction to revert rather than executing at an unfavorable price.

---

## 7. On-Chain Withdrawal Validation

### 7.1 Problem

Currently, `withdrawParams.amount0Min` and `amount1Min` are computed off-chain and passed by the executor. With permissionless execution, a malicious executor could set both to 0 to enable sandwich attacks on the liquidity withdrawal.

### 7.2 Solution

The contract computes a floor for withdrawal minimums on-chain using the existing `LiquidityAmounts` library:

```solidity
function _validateWithdrawParams(
    WithdrawParams calldata params,
    uint256 nftId,
    address pool,
    uint16 slippageBps
) internal view {
    // Read current price from pool
    (uint160 sqrtPriceX96,,,,,, ) = IUniswapV3PoolMinimal(pool).slot0();

    // Read position data from NFPM
    (,,,,int24 tickLower, int24 tickUpper, uint128 liquidity,,,, ) =
        INonfungiblePositionManagerMinimal(positionManager).positions(nftId);

    // Compute expected amounts at current price
    uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
    uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
    (uint256 expected0, uint256 expected1) = LiquidityAmounts.getAmountsForLiquidity(
        sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, liquidity
    );

    // Apply user's slippage tolerance
    uint256 floor0 = (expected0 * (10000 - slippageBps)) / 10000;
    uint256 floor1 = (expected1 * (10000 - slippageBps)) / 10000;

    // Executor's params must be at least as protective
    require(params.amount0Min >= floor0, "WITHDRAW_MIN0_TOO_LOW");
    require(params.amount1Min >= floor1, "WITHDRAW_MIN1_TOO_LOW");
}
```

**Why keep executor-provided params?** The executor may provide *tighter* minimums than the on-chain floor (e.g., using a more recent price reading with less slippage). The on-chain computation sets a floor; the executor can only go higher.

**Race condition note**: The current system computes withdrawal mins off-chain to avoid a race condition where `sqrtPriceX96` changes between parameter building and execution. With on-chain validation, the floor is computed at execution time using the *same* `sqrtPriceX96` that `decreaseLiquidity` will use, so there is no race condition for the floor. The executor-provided params may be slightly stale, but they must be >= the on-chain floor, so the user is always protected.

---

## 8. Oracle-Validated Swap Parameters

### 8.1 minAmountOut Validation

At execution time, the contract validates the executor's `swapParams.minAmountOut`:

```solidity
function _validateSwapMinAmountOut(
    SwapParams calldata swapParams,
    CloseOrder storage order,
    address tokenIn,
    address tokenOut,
    uint256 guaranteedAmountIn
) internal view {
    require(order.oracleChain.length > 0, "NO_ORACLE_CHAIN");

    // Iterate to find first valid price
    uint256 referencePrice;
    bool found;
    for (uint256 i = 0; i < order.oracleChain.length; i++) {
        (uint256 price, bool valid) = order.oracleChain[i].adapter.getPrice(
            tokenIn, tokenOut, order.oracleChain[i].params
        );
        if (valid) {
            referencePrice = price;
            found = true;
            break;
        }
    }
    require(found, "NO_VALID_ORACLE");

    // Compute oracle-derived minimum output
    // referencePrice is 18-decimal: tokenOut per tokenIn
    // Must account for tokenIn/tokenOut decimal differences
    uint8 decimalsIn = IERC20Metadata(tokenIn).decimals();
    uint8 decimalsOut = IERC20Metadata(tokenOut).decimals();

    uint256 expectedOut = (guaranteedAmountIn * referencePrice * (10 ** decimalsOut))
        / (10 ** decimalsIn * 1e18);

    uint256 oracleFloor = (expectedOut * (10000 - order.swapSlippageBps)) / 10000;

    require(swapParams.minAmountOut >= oracleFloor, "SWAP_MIN_TOO_LOW");
}
```

### 8.2 guaranteedAmountIn Validation

A malicious executor could set `guaranteedAmountIn = 0` to skip Phase 1 entirely and route everything through Phase 2 (which has no `minAmountOut`). To prevent this:

```solidity
// After withdrawal and fee deduction, we know the total swap input amount
uint256 totalSwapInput = /* amount of tokenIn after fees */;

// Executor must route at least X% through the oracle-validated Phase 1
// The remainder goes through Phase 2 (position's pool, no minAmountOut)
// A reasonable floor: guaranteedAmountIn >= totalSwapInput * (10000 - slippageBps) / 10000
// This ensures at most slippageBps% can bypass oracle validation

uint256 minGuaranteed = (totalSwapInput * (10000 - order.swapSlippageBps)) / 10000;
require(swapParams.guaranteedAmountIn >= minGuaranteed, "GUARANTEED_TOO_LOW");
```

This ensures the executor cannot trivially bypass oracle validation by shifting volume to the unprotected Phase 2.

---

## 9. Registration Changes

### 9.1 RegisterOrderParams (New)

```solidity
struct RegisterOrderParams {
    uint256 nftId;              // Position NFT ID
    address pool;               // Uniswap V3 pool address
    TriggerMode triggerMode;    // LOWER or UPPER
    int24 triggerTick;          // Price threshold as tick
    address payout;             // Recipient of closed tokens
    uint256 validUntil;         // Expiration timestamp (0 = no expiry)
    uint16 slippageBps;         // Withdrawal slippage (0-10000)
    SwapDirection swapDirection;    // NONE, TOKEN0_TO_1, or TOKEN1_TO_0
    uint16 swapSlippageBps;         // Max deviation from oracle price (0-10000)
    OracleAdapterCall[] oracleChain;  // User-defined oracle fallback chain
}
```

**Changes from V1**: `operator` field removed. `oracleChain` field added.

### 9.2 Registration Validation

The `registerOrder` function validates:
- `oracleChain.length > 0` required if `swapDirection != NONE` (no oracle needed if no swap)
- Each `adapter` address must be non-zero (but not validated further — user's responsibility)
- All existing validations preserved (ownership, approval, slippage ranges, etc.)

### 9.3 Owner Updates

**Removed**: `setOperator()` — no operator field to update.

**Added**: `setOracleChain()` — allows the order owner to update the oracle adapter chain:

```solidity
function setOracleChain(
    uint256 nftId,
    TriggerMode triggerMode,
    OracleAdapterCall[] calldata oracleChain
) external;
```

**Existing setters preserved**: `setPayout`, `setTriggerTick`, `setValidUntil`, `setSlippage`, `setSwapIntent`.

---

## 10. Smart Contract Changes Summary

### 10.1 New Contracts

| Contract | Type | Purpose |
|---|---|---|
| `IOracleAdapter` | Interface | Common interface for all oracle adapters |
| `ChainlinkAdapter` | Adapter | Single Chainlink feed reader |
| `CompositeChainlinkAdapter` | Adapter | Two Chainlink USD feeds → cross-pair |
| `UniswapTWAPAdapter` | Adapter | Uniswap V3 pool TWAP reader |
| `SpotPriceAdapter` | Adapter | Uniswap V3 pool spot price reader |
| `OracleLib` | Library | Oracle chain iteration + minAmountOut computation |

### 10.2 Modified Contracts

| Contract | Change |
|---|---|
| `AppStorage.sol` | Replace `CloseOrder` struct: remove `operator`, add `OracleAdapterCall[] oracleChain` |
| `ExecutionFacet.sol` | Remove operator check. Add withdrawal validation + oracle swap validation |
| `RegistrationFacet.sol` | Remove `operator` from params. Accept and store `oracleChain` |
| `OwnerUpdateFacet.sol` | Remove `setOperator()`. Add `setOracleChain()` |
| `ViewFacet.sol` | Expose oracle chain data in `getOrder()` response. Remove operator from `canExecuteOrder()` |
| `IUniswapV3PositionCloserV1.sol` | Replace with V2 interface: no operator, oracle params added |

### 10.3 Unchanged Contracts

| Contract | Why Unchanged |
|---|---|
| `MidcurveSwapRouter.sol` | Swap execution layer is oracle-agnostic |
| `UniswapV3Adapter.sol` | Venue adapter, unaffected |
| `LiquidityAmounts.sol` | Already exists, now called from ExecutionFacet |
| `TickMath.sol` | Already exists, used by TWAP adapter |
| `DiamondCutFacet.sol` | Upgrade mechanism, unaffected |
| `Diamond.sol` | Proxy, unaffected |

---

## 11. Token-to-Oracle Resolution (Frontend/SDK)

The oracle adapter chain is assembled off-chain by the frontend and included in the `registerOrder` transaction. The user sees and approves the oracle configuration before signing.

### 11.1 Resolution Pipeline

```
ERC20Token { chainId, address }
    → coingeckoId           (existing Token.coingeckoId in database)
        → canonicalAsset    (small curated map for tokens without own feed)
            → chainlinkFeed (per chain)
```

### 11.2 Canonical Asset Mapping

A token's canonical asset determines which Chainlink feed to use:

1. If the token has a dedicated Chainlink feed → the token IS its own canonical asset
2. If the token does NOT have a dedicated feed → look up in `CANONICAL_ASSETS` for a proxy
3. If no mapping exists → no Chainlink available, fall back to TWAP/Spot

```typescript
// Only tokens WITHOUT their own Chainlink feed
const CANONICAL_ASSETS: Record<string, string> = {
  "weth":          "ETH",     // WETH → ETH/USD feed
  "tether-gold":   "XAU",     // xAUT → Gold/USD feed
  // ~10-15 entries total
};
```

### 11.3 Chainlink Feed Registry

Static, version-controlled JSON mapping of canonical assets to feed addresses per chain:

```typescript
const CHAINLINK_FEEDS: Record<string, Record<ChainId, Address>> = {
  "ETH":   { 1: "0x5f4e...", 42161: "0x639F...", 8453: "0x7104..." },
  "BTC":   { 1: "0xF403...", 42161: "0x6ce1..." },
  "USDC":  { 1: "0x8fFf...", 42161: "0x5083...", 8453: "0x..." },
  "AAVE":  { 1: "0x547a..." },
  // ...
};
```

### 11.4 buildOracleChain Algorithm

```typescript
function buildOracleChain(
  tokenIn: ERC20Token,
  tokenOut: ERC20Token,
  pool: Pool
): OracleAdapterCall[] {
  const feedIn = resolveChainlinkFeed(tokenIn);
  const feedOut = resolveChainlinkFeed(tokenOut);
  const chain: OracleAdapterCall[] = [];

  // Tier 1: Chainlink (direct or composite)
  if (feedIn && feedOut) {
    chain.push({
      adapter: COMPOSITE_CHAINLINK_ADAPTER,
      params: encodeCompositeParams(feedIn, feedOut, MAX_STALENESS)
    });
  } else if (feedIn && isUSDStablecoin(tokenOut)) {
    chain.push({
      adapter: CHAINLINK_ADAPTER,
      params: encodeChainlinkParams(feedIn, MAX_STALENESS)
    });
  }

  // Tier 2: Uniswap TWAP (from the position's pool)
  chain.push({
    adapter: TWAP_ADAPTER,
    params: encodeTWAPParams(pool.address, DEFAULT_TWAP_WINDOW)
  });

  // Tier 3: Spot price (last resort, always valid)
  chain.push({
    adapter: SPOT_ADAPTER,
    params: encodeSpotParams(pool.address)
  });

  return chain;
}
```

### 11.5 Resolution Examples

**AAVE/USDC** (both have Chainlink feeds):
```
→ [CompositeChainlink(AAVE/USD, USDC/USD), TWAP(pool, 30min), Spot(pool)]
```

**cbBTC/WETH** (both have feeds, WETH resolves through canonical):
```
WETH → CANONICAL_ASSETS["weth"] = "ETH" → ETH/USD feed
→ [CompositeChainlink(cbBTC/USD, ETH/USD), TWAP(pool, 30min), Spot(pool)]
```

**ObscureToken/WETH** (no Chainlink for ObscureToken):
```
→ [TWAP(pool, 30min), Spot(pool)]   (Chainlink tier skipped)
```

### 11.6 Test Environment Resolution

The `buildOracleChain()` function must be environment-aware. On local test chains, Chainlink feeds don't exist and Uniswap V3 pools have no observation history for TWAP. The oracle chain is adjusted per environment:

| Environment | Oracle Chain | Rationale |
|---|---|---|
| **Local fresh chain** (Hardhat, Anvil) | `[SpotAdapter(pool)]` | No Chainlink feeds deployed. No TWAP observation history. Spot reads `pool.slot0()` which always works. |
| **Forked chain** (e.g., Anvil fork of Arbitrum) | `[Chainlink → TWAP → Spot]` | Fork inherits all mainnet state: Chainlink feeds, pool observation history. Full chain works identically to production. |
| **Production** (Arbitrum, Base, Ethereum) | `[Chainlink → TWAP → Spot]` | Full resolution pipeline as described in Sections 11.1–11.5. |

**Implementation**:

```typescript
function buildOracleChain(tokenIn, tokenOut, pool, chainId): OracleAdapterCall[] {
  if (isLocalChain(chainId)) {
    // Local/test: SpotAdapter only
    return [spotAdapter(pool.config.address)];
  }

  // Production / forked chain: full Chainlink → TWAP → Spot chain
  return buildProductionOracleChain(tokenIn, tokenOut, pool);
}
```

On local chains, the SpotPriceAdapter provides the reference price from the pool's current `sqrtPriceX96`. The user's `swapSlippageBps` still enforces deviation limits, so the contract behavior is functionally identical — just with a simpler, single-source oracle. This is acceptable for testing because local chains are not subject to MEV or oracle manipulation attacks.

---

## 12. Keeper Economics

### 12.1 Fee Model (Unchanged)

The existing fee mechanism is preserved. The executor passes `FeeParams { feeRecipient, feeBps }` at execution time. The contract enforces `feeBps <= maxFeeBps` (currently 100 = 1%).

With permissionless execution, this becomes a keeper incentive: any address that successfully executes a triggered order can collect up to 1% of the withdrawn token amounts as compensation for gas costs and execution infrastructure.

### 12.2 Competitive Keeper Market

Multiple keepers can monitor triggered orders. The first to land a valid `executeOrder` transaction wins the fee. This creates:
- **Redundancy**: If Midcurve's keeper is down, third-party keepers execute orders
- **Speed competition**: Keepers compete to execute quickly after trigger
- **Fee competition**: Keepers may use lower `feeBps` to be more attractive (though fees are per-execution, not pre-committed)

### 12.3 Midcurve's Keeper

Midcurve's existing automation system (RabbitMQ monitor → executor → signer) continues to work as one of potentially many keepers. The automation wallet executes with the same oracle validation as any third party. There is no privileged operator — all keepers compete equally.

---

## 13. Deployment

Since there is no production data to preserve, the UniswapV3PositionCloser Diamond is deployed fresh with the new struct layout. No migration or backward compatibility needed.

### 13.1 Contract Deployment

1. Deploy oracle adapter contracts (Chainlink, CompositeChainlink, TWAP, Spot)
2. Deploy `OracleLib` library
3. Deploy new Diamond with all facets (ExecutionFacet, RegistrationFacet, OwnerUpdateFacet, ViewFacet, etc.)
4. Initialize via `DiamondInit` (positionManager, swapRouter, maxFeeBps, interfaceVersion)
5. Register UniswapV3 venue adapter in MidcurveSwapRouter (if fresh router deploy)

### 13.2 Backend Changes

- Remove `operator` from close order registration calls and order state
- Add `oracleChain` to registration flow (built via `buildOracleChain()`)
- Update `close-order-executor.ts` to build oracle-aware registration params
- Update `signer-client.ts` to encode new `RegisterOrderParams` (no operator field)
- Execution path: executor still computes swap params off-chain, but the contract now validates them on-chain
- Remove `operatorAddress` from close order state JSON and all related code
- Update `ViewFacet` response parsing to include oracle chain data

### 13.3 Frontend Changes

- `buildOracleChain()` implemented in `@midcurve/services` (or `@midcurve/shared`)
- `CANONICAL_ASSETS` and `CHAINLINK_FEEDS` data files in `@midcurve/shared`
- Registration UI includes oracle chain display (informational)
- Remove operator-related UI elements
- No new user inputs required — oracle chain is auto-resolved from token pair

---

## 14. Security Considerations

### 14.1 Oracle Manipulation

| Adapter | Attack Vector | Mitigation |
|---|---|---|
| Chainlink | Feed compromise | Decentralized node network; staleness check rejects stale data |
| CompositeChainlink | One feed manipulated | Both feeds must be valid; staleness checked independently |
| TWAP | Sustained pool manipulation | Requires manipulation over entire TWAP window (e.g., 30 min); cost-prohibitive on major pools |
| Spot | Flash loan / sandwich | `swapSlippageBps` causes revert on manipulated prices; worst case = order not executed |

### 14.2 Malicious Oracle Adapter

A user could reference a malicious adapter address in their oracle chain. Two failure modes:
- **Returns inflated price** → `oracleFloor` is too high → swap will fail to meet it → revert → user unharmed
- **Returns zero/deflated price** → no price protection → user at risk

Mitigation: This is the user's responsibility by design. The frontend uses a curated set of known adapter addresses and warns if unrecognized adapters are used.

### 14.3 Withdrawal Front-Running

With permissionless execution, MEV bots could sandwich the `decreaseLiquidity` call. The on-chain withdrawal validation (Section 7) ensures `amount0Min/amount1Min` are at least as protective as the user's `slippageBps` allows, computed at the same block's `sqrtPriceX96`.

### 14.4 Reentrancy

The existing `nonReentrant` modifier on `executeOrder` is preserved. The execution flow involves external calls to NFPM (`transferFrom`, `decreaseLiquidity`, `collect`), MidcurveSwapRouter (`sell`), and ERC20 transfers. All are protected by the reentrancy guard.

### 14.5 Storage Layout

Fresh deployment with clean struct layout. No storage compatibility concerns. The `OracleAdapterCall[]` dynamic array in `CloseOrder` uses standard Solidity mapping storage derivation (`keccak256(key, mappingSlot)`) — each order's storage is independent.

### 14.6 Decimal Normalization

All oracle adapters normalize to 18 decimals internally. The `_validateSwapMinAmountOut` function must account for differing `decimals()` of tokenIn and tokenOut when computing the expected output amount. This is a critical correctness requirement.

---

## 15. Gas Considerations

| Component | Estimated Gas | Notes |
|---|---|---|
| On-chain withdrawal validation | ~15,000 | `slot0()` + `positions()` + `LiquidityAmounts` math |
| ChainlinkAdapter.getPrice() | ~25,000 | Single `latestRoundData()` |
| CompositeChainlinkAdapter.getPrice() | ~50,000 | Two `latestRoundData()` calls |
| UniswapTWAPAdapter.getPrice() | ~30,000 | `pool.observe()` |
| SpotPriceAdapter.getPrice() | ~5,000 | `slot0()` read |
| Oracle chain iteration (worst case) | ~85,000 | All fail except Spot |
| Oracle chain iteration (best case: Chainlink hit) | ~50,000 | Composite Chainlink succeeds |
| **Total overhead vs. current system** | **~65,000 - 100,000** | Acceptable on L2 |

On L2 networks (Arbitrum, Base) where Midcurve primarily operates, the additional gas overhead is negligible ($0.01-0.05). On Ethereum mainnet at 30 gwei, the overhead is ~$0.20-0.40 — a reasonable cost for trustless execution.

---

## 16. Implementation Phases

### Phase 1: Oracle Adapters & Library
- `IOracleAdapter` interface
- `ChainlinkAdapter`
- `CompositeChainlinkAdapter`
- `UniswapTWAPAdapter`
- `SpotPriceAdapter`
- `OracleLib` (chain iteration, minAmountOut computation)
- Unit tests with forked mainnet state (Foundry)

### Phase 2: Diamond Facets
- New `AppStorage.CloseOrder` with `OracleAdapterCall[] oracleChain` (no operator)
- `ExecutionFacet`: permissionless with withdrawal validation + oracle swap validation
- `RegistrationFacet`: accepts oracle chain, no operator param
- `OwnerUpdateFacet`: `setOracleChain()` added, `setOperator()` removed
- `ViewFacet`: exposes oracle chain data
- Integration tests (register → trigger → permissionless execute)

### Phase 3: Frontend/SDK Integration
- `CANONICAL_ASSETS` and `CHAINLINK_FEEDS` data files
- `buildOracleChain()` in `@midcurve/services`
- Registration UI updated to show oracle tier
- Operator-related UI and backend code removed

### Phase 4: Keeper Infrastructure
- Public documentation for third-party keepers (ABI, oracle adapter addresses, example execution scripts)
- Monitoring dashboard for oracle fallback rates
- Alerting for stale Chainlink feeds

---

## 17. Open Questions

1. **TWAP window default**: 30 minutes is standard, but some pools may have insufficient observation cardinality. Should the frontend check cardinality before including a TWAP adapter in the chain?

2. **Oracle chain max length**: Should we cap the oracle chain length (e.g., max 5 adapters) to bound gas costs?

3. **Cross-pool TWAP**: For the TWAP adapter, should we always use the position's own pool, or allow specifying a different (more liquid) pool for the same pair?

4. **Partial fills**: The current system always closes 100% of liquidity. Should partial closes be considered in the permissionless model?

5. **Spot adapter risk**: The Spot adapter always returns `valid = true`, making it a guaranteed fallback. Should there be an option to exclude it (accepting that execution may fail if Chainlink and TWAP are both unavailable)?

---

## 18. References

- [Chainlink Data Feeds Documentation](https://docs.chain.link/data-feeds)
- [Chainlink Price Feed Addresses](https://docs.chain.link/data-feeds/price-feeds/addresses)
- [Uniswap V3 Oracle Documentation](https://docs.uniswap.org/concepts/protocol/oracle)
- [EIP-2535: Diamond Standard](https://eips.ethereum.org/EIPS/eip-2535)
- [Uniswap V3 LiquidityAmounts Library](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/LiquidityAmounts.sol)
- Existing contracts: `apps/midcurve-contracts/contracts/position-closer/`
- Existing swap router: `apps/midcurve-contracts/contracts/swap-router/MidcurveSwapRouter.sol`
