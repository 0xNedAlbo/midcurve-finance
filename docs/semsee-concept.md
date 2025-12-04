# SEMSEE: Single-EVM Multi-Strategy Execution Environment

**Version 0.10 - Concept Document**

---

## Table of Contents

1. [Abstract](#abstract)
2. [Introduction](#introduction)
3. [Architecture Overview](#architecture-overview)
4. [Explicit Typed Callbacks](#explicit-typed-callbacks)
5. [Subscription System](#subscription-system)
6. [Resource ID Conventions](#resource-id-conventions)
7. [Store Architecture](#store-architecture)
8. [SystemRegistry](#systemregistry)
9. [Strategy Deployment & Ownership](#strategy-deployment--ownership)
10. [Core Identity & Access Control](#core-identity--access-control)
11. [Gas Metering & Billing](#gas-metering--billing)
12. [Strategy Lifecycle](#strategy-lifecycle)
13. [Logging System](#logging-system)
14. [User Actions](#user-actions)
15. [Modular Strategy Architecture](#modular-strategy-architecture)
16. [BaseStrategy Reference](#basestrategy-reference)
17. [Module Interfaces & Libraries](#module-interfaces--libraries)
18. [Module Composition Examples](#module-composition-examples)
19. [Complete Example: Rebalancing Strategy](#complete-example-rebalancing-strategy)

---

## Abstract

SEMSEE (Single-EVM Multi-Strategy Execution Environment) is an automated strategy execution platform for DeFi liquidity management. It provides a secure, isolated environment where user-defined strategies run as smart contracts inside an embedded EVM, receiving real-time market data and emitting actions that are executed on-chain by a trusted orchestrator.

The system enables sophisticated automated trading strategies for Uniswap V3 and similar concentrated liquidity protocols while maintaining strict isolation between strategies and providing comprehensive debugging and monitoring capabilities.

---

## Introduction

### The Problem

Managing concentrated liquidity positions (e.g., Uniswap V3) requires constant attention:
- Price movements can push positions out of range
- Fee collection and reinvestment need to be timed optimally
- Rebalancing decisions depend on market conditions, gas costs, and user preferences
- Manual management is time-consuming and error-prone

### The Solution

SEMSEE provides:

1. **Isolated Execution** - All strategies run as separate smart contracts within a single shared EVM, with isolated storage preventing interference between strategies
2. **Event-Driven Architecture** - Strategies react to real-time market data via typed callbacks
3. **Safe Actions** - Strategies emit intent (actions), Core executes on-chain with user's funds
4. **Type-Safe Debugging** - Explicit callback signatures enable clear stack traces and IDE support
5. **Gas Accounting** - Pay-per-gas model with prepaid balances

### Key Design Principles

- **Security First**: Strategies cannot access user private keys or execute arbitrary transactions
- **Debuggability**: Explicit typed callbacks instead of generic event dispatchers
- **Extensibility**: Support for multiple DEX protocols and chains
- **Transparency**: All strategy execution is logged and auditable

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SEMSEE Architecture                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                    External Data Sources                              │  │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│   │  │ OHLC Feeds  │  │ Pool State  │  │  Position   │  │   Balance   │  │  │
│   │  │ (Prices)    │  │ (UniV3)     │  │  Updates    │  │   Updates   │  │  │
│   │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │  │
│   └─────────┼────────────────┼────────────────┼────────────────┼─────────┘  │
│             │                │                │                │            │
│             ▼                ▼                ▼                ▼            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        Core Orchestrator                             │   │
│   │  ┌──────────────────┐  ┌────────────────┐  ┌─────────────────────┐  │   │
│   │  │ StoreSynchronizer│  │ SubscriptionMgr│  │    EffectEngine     │  │   │
│   │  │ (Updates Stores) │  │ (Routes Events)│  │ (Executes Actions)  │  │   │
│   │  └──────────────────┘  └────────────────┘  └─────────────────────┘  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                        │
│                                     ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        Embedded EVM                                  │   │
│   │  ┌─────────────────────────────────────────────────────────────┐    │   │
│   │  │                      System Contracts                        │    │   │
│   │  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │    │   │
│   │  │  │ PoolStore    │ │PositionStore │ │    SystemRegistry    │ │    │   │
│   │  │  │ BalanceStore │ │  OhlcStore   │ │   StrategyManager    │ │    │   │
│   │  │  └──────────────┘ └──────────────┘ └──────────────────────┘ │    │   │
│   │  └─────────────────────────────────────────────────────────────┘    │   │
│   │                                                                      │   │
│   │  ┌─────────────────────────────────────────────────────────────┐    │   │
│   │  │                    Strategy Contracts                        │    │   │
│   │  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │    │   │
│   │  │  │ Strategy A   │ │ Strategy B   │ │     Strategy C       │ │    │   │
│   │  │  │ (User 1)     │ │ (User 2)     │ │     (User 3)         │ │    │   │
│   │  │  └──────────────┘ └──────────────┘ └──────────────────────┘ │    │   │
│   │  └─────────────────────────────────────────────────────────────┘    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **Core Orchestrator** | Coordinates all operations, routes events, manages subscriptions |
| **StoreSynchronizer** | Updates Store contracts with external data |
| **SubscriptionManager** | Tracks which strategies subscribe to which events |
| **EffectEngine** | Executes on-chain actions emitted by strategies |
| **VmRunner** | Executes strategy callbacks within the embedded EVM |
| **Embedded EVM** | Isolated execution environment for all contracts |

---

## Explicit Typed Callbacks

### Design Philosophy

Instead of generic entry points like `onEvent(bytes32 eventType, bytes payload)`, SEMSEE uses explicit, typed callback functions. This design provides:

1. **Better Debugging** - Stack traces show exact callback names
2. **Type Safety** - Compiler catches parameter mismatches
3. **IDE Support** - Autocomplete and go-to-definition work correctly
4. **Self-Documenting** - Callback names explain what event occurred
5. **Selective Override** - Strategies implement only what they need
6. **Easier Testing** - Unit tests can call specific callbacks directly

### Event Callbacks

These callbacks deliver external world events to strategies:

```solidity
// OHLC Price Events
function onOhlcCandle(
    bytes32 marketId,
    uint8 timeframe,
    OhlcCandle calldata candle
) external;

// Uniswap V3 Pool Events
function onPoolStateUpdate(
    bytes32 poolId,
    uint256 chainId,
    address poolAddress,
    uint160 sqrtPriceX96,
    int24 tick,
    uint128 liquidity,
    uint256 feeGrowthGlobal0X128,
    uint256 feeGrowthGlobal1X128
) external;

// Position Events
function onPositionUpdate(
    bytes32 positionId,
    uint256 chainId,
    uint256 nftTokenId,
    uint128 liquidity,
    uint256 feeGrowthInside0LastX128,
    uint256 feeGrowthInside1LastX128,
    uint128 tokensOwed0,
    uint128 tokensOwed1
) external;

// Balance Events
function onBalanceUpdate(
    uint256 chainId,
    address token,
    uint256 balance
) external;
```

### Effect Result Callbacks

These callbacks deliver the results of executed actions:

```solidity
// Funding/Withdrawal Results
function onWithdrawComplete(
    bytes32 effectId,
    uint256 chainId,
    address token,
    uint256 requestedAmount,
    uint256 executedAmount,
    bytes32 txHash,
    bool success,
    string calldata errorMessage
) external;

// Uniswap V3 Position Results
function onAddLiquidityComplete(
    bytes32 effectId,
    bytes32 positionId,
    uint256 chainId,
    uint256 nftTokenId,
    uint128 liquidity,
    uint256 amount0,
    uint256 amount1,
    bool success,
    string calldata errorMessage
) external;

function onRemoveLiquidityComplete(
    bytes32 effectId,
    bytes32 positionId,
    uint128 liquidityRemoved,
    uint256 amount0,
    uint256 amount1,
    bool success,
    string calldata errorMessage
) external;

function onCollectFeesComplete(
    bytes32 effectId,
    bytes32 positionId,
    uint256 amount0,
    uint256 amount1,
    bool success,
    string calldata errorMessage
) external;
```

### Data Structures

```solidity
struct OhlcCandle {
    uint256 timestamp;
    uint256 open;
    uint256 high;
    uint256 low;
    uint256 close;
    uint256 volume;
}

// Timeframe constants
uint8 constant TIMEFRAME_1M = 1;
uint8 constant TIMEFRAME_5M = 5;
uint8 constant TIMEFRAME_15M = 15;
uint8 constant TIMEFRAME_1H = 60;
uint8 constant TIMEFRAME_4H = 240;
uint8 constant TIMEFRAME_1D = 1440;
```

### Callback Reference Table

| Callback | Trigger | Key Parameters |
|----------|---------|----------------|
| `onOhlcCandle` | New candle closes | marketId, timeframe, OhlcCandle |
| `onPoolStateUpdate` | Pool state changes | poolId, chainId, poolAddress, price, tick, liquidity |
| `onPositionUpdate` | Position state changes | positionId, chainId, nftTokenId, liquidity, fees |
| `onBalanceUpdate` | Wallet balance changes | chainId, token, balance |
| `onWithdrawComplete` | Withdrawal executed | effectId, executedAmount, success |
| `onAddLiquidityComplete` | Liquidity added | effectId, positionId, tokenId, amounts, success |
| `onRemoveLiquidityComplete` | Liquidity removed | effectId, amounts, success |
| `onCollectFeesComplete` | Fees collected | effectId, amounts, success |

---

## Subscription System

Strategies dynamically subscribe to events they care about. Subscriptions can be established in the constructor and modified at runtime.

### Subscription Helpers

```solidity
abstract contract BaseStrategy {
    // OHLC Subscriptions
    function _subscribeOhlc(bytes32 marketId, uint8 timeframe) internal {
        emit SubscriptionRequested(
            keccak256("Subscription:Ohlc:v1"),
            abi.encode(marketId, timeframe)
        );
    }

    function _unsubscribeOhlc(bytes32 marketId, uint8 timeframe) internal {
        emit UnsubscriptionRequested(
            keccak256("Subscription:Ohlc:v1"),
            abi.encode(marketId, timeframe)
        );
    }

    // Pool Subscriptions
    function _subscribePool(bytes32 poolId) internal {
        emit SubscriptionRequested(
            keccak256("Subscription:Pool:v1"),
            abi.encode(poolId)
        );
    }

    function _unsubscribePool(bytes32 poolId) internal {
        emit UnsubscriptionRequested(
            keccak256("Subscription:Pool:v1"),
            abi.encode(poolId)
        );
    }

    // Position Subscriptions
    function _subscribePosition(bytes32 positionId) internal {
        emit SubscriptionRequested(
            keccak256("Subscription:Position:v1"),
            abi.encode(positionId)
        );
    }

    function _unsubscribePosition(bytes32 positionId) internal {
        emit UnsubscriptionRequested(
            keccak256("Subscription:Position:v1"),
            abi.encode(positionId)
        );
    }

    // Balance Subscriptions
    function _subscribeBalance(uint256 chainId, address token) internal {
        emit SubscriptionRequested(
            keccak256("Subscription:Balance:v1"),
            abi.encode(chainId, token)
        );
    }

    function _unsubscribeBalance(uint256 chainId, address token) internal {
        emit UnsubscriptionRequested(
            keccak256("Subscription:Balance:v1"),
            abi.encode(chainId, token)
        );
    }

    // Events
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
}
```

### Usage Example

```solidity
contract MyStrategy is BaseStrategy {
    constructor(address _owner, bytes32 _poolId) BaseStrategy(_owner) {
        // Subscribe in constructor
        _subscribePool(_poolId);
        _subscribeBalance(1, 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48); // USDC on Ethereum
    }

    function switchPool(bytes32 oldPoolId, bytes32 newPoolId) external onlyOwner {
        // Dynamic subscription changes
        _unsubscribePool(oldPoolId);
        _subscribePool(newPoolId);
    }
}
```

---

## Resource ID Conventions

All resource IDs follow a namespaced string format for debuggability and uniqueness.

### Format Specifications

| Resource | Format | Example |
|----------|--------|---------|
| `poolId` | `"uniswapv3:{chainId}:{poolAddress}"` | `"uniswapv3:1:0xCBCdF9626bC03E24f779434178A73a0B4bad62eD"` |
| `positionId` | `"uniswapv3:{chainId}:{nftTokenId}"` | `"uniswapv3:1:123456"` |
| `marketId` | `"{base}/{quote}"` | `"ETH/USD"` |

### Design Rationale

- **String format** allows easy debugging and logging
- **Converted to `bytes32`** via `keccak256()` when used in Solidity
- **chainId included** in pool/position IDs for multi-chain uniqueness
- **Market IDs** use standard trading pair notation

### ID Helper Library

```solidity
library ResourceIds {
    function poolId(uint256 chainId, address poolAddress) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("uniswapv3:", chainId, ":", poolAddress));
    }

    function positionId(uint256 chainId, uint256 nftTokenId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("uniswapv3:", chainId, ":", nftTokenId));
    }

    function marketId(string memory base, string memory quote) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(base, "/", quote));
    }
}
```

---

## Store Architecture

Stores are smart contracts deployed inside the embedded EVM that hold synchronized external state.

### Design Principles

- **Written by Core**: Only the Core orchestrator can update Stores
- **Readable by Strategies**: Strategies can read via public view functions
- **Access Controlled**: Some data restricted to owning strategy

### Store Contracts

#### PoolStore

```solidity
contract PoolStore {
    struct PoolState {
        uint256 chainId;
        address poolAddress;
        address token0;
        address token1;
        uint24 fee;
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
        uint256 feeGrowthGlobal0X128;
        uint256 feeGrowthGlobal1X128;
        uint256 lastUpdated;
    }

    mapping(bytes32 => PoolState) public pools;

    function updatePool(bytes32 poolId, PoolState calldata state) external onlyCore;
    function getPool(bytes32 poolId) external view returns (PoolState memory);
    function getCurrentPrice(bytes32 poolId) external view returns (uint160 sqrtPriceX96);
    function getCurrentTick(bytes32 poolId) external view returns (int24 tick);
}
```

#### PositionStore

```solidity
contract PositionStore {
    struct PositionState {
        uint256 chainId;
        uint256 nftTokenId;
        bytes32 poolId;
        address owner;           // Strategy address
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
        uint256 lastUpdated;
    }

    mapping(bytes32 => PositionState) internal _positions;

    function updatePosition(bytes32 positionId, PositionState calldata state) external onlyCore;

    // Access-controlled: only position owner can read
    function getPosition(bytes32 positionId) external view returns (PositionState memory) {
        PositionState memory pos = _positions[positionId];
        require(pos.owner == msg.sender, "Not position owner");
        return pos;
    }

    function isOwner(bytes32 positionId, address strategy) external view returns (bool) {
        return _positions[positionId].owner == strategy;
    }
}
```

#### BalanceStore

```solidity
contract BalanceStore {
    struct BalanceEntry {
        uint256 chainId;
        address token;
        uint256 balance;
        uint256 lastUpdated;
    }

    // strategyAddress => chainId => token => balance
    mapping(address => mapping(uint256 => mapping(address => BalanceEntry))) internal _balances;

    function updateBalance(
        address strategy,
        uint256 chainId,
        address token,
        uint256 balance
    ) external onlyCore;

    // Access-controlled: strategy can only read its own balances
    function getBalance(uint256 chainId, address token) external view returns (uint256) {
        return _balances[msg.sender][chainId][token].balance;
    }

    function getAllBalances(uint256 chainId) external view returns (BalanceEntry[] memory);
}
```

#### OhlcStore

```solidity
contract OhlcStore {
    struct OhlcCandle {
        uint256 timestamp;
        uint256 open;
        uint256 high;
        uint256 low;
        uint256 close;
        uint256 volume;
    }

    // marketId => timeframe => candles (ring buffer)
    mapping(bytes32 => mapping(uint8 => OhlcCandle[])) internal _candles;

    function appendCandle(
        bytes32 marketId,
        uint8 timeframe,
        OhlcCandle calldata candle
    ) external onlyCore;

    function getLatestCandle(bytes32 marketId, uint8 timeframe)
        external view returns (OhlcCandle memory);

    function getCandles(bytes32 marketId, uint8 timeframe, uint256 count)
        external view returns (OhlcCandle[] memory);
}
```

### Access Control Summary

| Store | Write Access | Read Access |
|-------|--------------|-------------|
| PoolStore | Core only | Any strategy |
| PositionStore | Core only | Owner strategy only |
| BalanceStore | Core only | Owner strategy only |
| OhlcStore | Core only | Any strategy |

---

## SystemRegistry

The SystemRegistry holds current implementation addresses for all system components.

### Contract Definition

```solidity
contract SystemRegistry {
    // Fixed addresses for system components
    address public constant CORE = address(0x0000000000000000000000000000000000000001);

    // Upgradeable store addresses
    address public poolStore;
    address public positionStore;
    address public balanceStore;
    address public ohlcStore;

    modifier onlyCore() {
        require(msg.sender == CORE, "Only Core");
        _;
    }

    function setPoolStore(address _poolStore) external onlyCore {
        poolStore = _poolStore;
    }

    function setPositionStore(address _positionStore) external onlyCore {
        positionStore = _positionStore;
    }

    function setBalanceStore(address _balanceStore) external onlyCore {
        balanceStore = _balanceStore;
    }

    function setOhlcStore(address _ohlcStore) external onlyCore {
        ohlcStore = _ohlcStore;
    }
}
```

### Well-Known Address

**Registry Address:** `0x0000000000000000000000000000000000001000`

### Usage in BaseStrategy

```solidity
abstract contract BaseStrategy {
    SystemRegistry constant REGISTRY = SystemRegistry(0x0000000000000000000000000000000000001000);

    function _poolStore() internal view returns (PoolStore) {
        return PoolStore(REGISTRY.poolStore());
    }

    function _positionStore() internal view returns (PositionStore) {
        return PositionStore(REGISTRY.positionStore());
    }

    function _balanceStore() internal view returns (BalanceStore) {
        return BalanceStore(REGISTRY.balanceStore());
    }

    function _ohlcStore() internal view returns (OhlcStore) {
        return OhlcStore(REGISTRY.ohlcStore());
    }
}
```

---

## Strategy Deployment & Ownership

### Ownership Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                         User Wallet                          │
│                    (EOA, e.g., MetaMask)                     │
└─────────────────────────┬───────────────────────────────────┘
                          │ owns (1:N)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Automation Wallet(s)                       │
│              (Smart contract or EOA per user)                │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ AutoWallet 1 │  │ AutoWallet 2 │  │ AutoWallet 3 │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
└─────────┼─────────────────┼─────────────────┼───────────────┘
          │ owns (1:1)      │ owns (1:1)      │ owns (1:1)
          ▼                 ▼                 ▼
    ┌──────────┐      ┌──────────┐      ┌──────────┐
    │ Strategy │      │ Strategy │      │ Strategy │
    │    A     │      │    B     │      │    C     │
    └──────────┘      └──────────┘      └──────────┘
```

### Key Rules

- **1 User → N Automation Wallets**
- **1 Automation Wallet ↔ 1 Strategy** (bidirectional 1:1)
- Strategy is owned by its Automation Wallet
- Automation Wallet holds funds used by the strategy
- User can withdraw from Automation Wallet back to User Wallet

### Deployment Flow

```
1. User creates Automation Wallet (on-chain, tracked by Midcurve)
       ↓
2. User funds Automation Wallet with tokens
       ↓
3. User submits compiled strategy bytecode via API
       ↓
4. Core deploys strategy into embedded EVM
       ↓
5. Core links strategy address ↔ automation wallet address
       ↓
6. Strategy constructor runs, sets up subscriptions
       ↓
7. Strategy begins receiving events
```

### StrategyManager Contract

```solidity
contract StrategyManager {
    struct StrategyInfo {
        address automationWallet;
        uint256 deployedAt;
        bool active;
    }

    mapping(address => StrategyInfo) public strategies;

    function registerStrategy(
        address strategyAddress,
        address automationWallet
    ) external onlyCore {
        strategies[strategyAddress] = StrategyInfo({
            automationWallet: automationWallet,
            deployedAt: block.timestamp,
            active: true
        });
    }

    function deactivateStrategy(address strategyAddress) external onlyCore {
        strategies[strategyAddress].active = false;
    }

    function getAutomationWallet() external view returns (address) {
        return strategies[msg.sender].automationWallet;
    }
}
```

---

## Core Identity & Access Control

### Core Address

**Fixed Address:** `0x0000000000000000000000000000000000000001`

The Core orchestrator uses this address when making calls into the embedded EVM.

### onlyCore Modifier

```solidity
abstract contract CoreControlled {
    address constant CORE = address(0x0000000000000000000000000000000000000001);

    modifier onlyCore() {
        require(msg.sender == CORE, "Only Core can call this function");
        _;
    }
}

contract PoolStore is CoreControlled {
    function updatePool(bytes32 poolId, PoolState calldata state) external onlyCore {
        pools[poolId] = state;
    }
}
```

### How Core Calls into EVM

```typescript
// Pseudocode for Core calling a strategy callback
async function deliverPoolUpdate(strategyAddress: Address, params: PoolUpdateParams) {
  const calldata = encodeABI('onPoolStateUpdate', params);

  const result = await evm.call({
    from: CORE_ADDRESS,  // 0x000...0001
    to: strategyAddress,
    data: calldata,
    gasLimit: CALLBACK_GAS_LIMIT,
  });

  // Extract and process logs
  const logs = result.logs;
  // Process SubscriptionRequested, ActionRequested events
}
```

### Well-Known Addresses Summary

| Contract | Address | Purpose |
|----------|---------|---------|
| Core (caller) | `0x0000...0001` | Core orchestrator identity |
| SystemRegistry | `0x0000...1000` | Store address discovery |
| StrategyManager | `0x0000...1001` | Strategy ↔ AutoWallet mapping |
| PoolStore | (dynamic) | Pool state storage |
| PositionStore | (dynamic) | Position state storage |
| BalanceStore | (dynamic) | Balance storage |
| OhlcStore | (dynamic) | OHLC candle storage |

---

## Gas Metering & Billing

### Pay-Per-Gas Model

Strategies are billed based on actual gas consumption.

```typescript
interface GasAccounting {
  strategyAddress: string;

  // Usage tracking
  totalGasUsed: bigint;           // Lifetime consumption
  periodGasUsed: bigint;          // Current billing period

  // Billing
  gasPrice: bigint;               // Cost per gas unit
  balanceRemaining: bigint;       // Prepaid balance

  // Limits
  callbackGasLimit: bigint;       // Max gas per callback
  periodGasLimit: bigint;         // Max gas per billing period
}
```

### Gas Tracking Flow

```
1. Core calls strategy callback with gasLimit
       ↓
2. EVM executes callback, returns gasUsed
       ↓
3. Core records gasUsed to strategy's account
       ↓
4. If balanceRemaining < gasUsed → strategy paused
       ↓
5. User tops up balance → strategy resumes
```

### Gas Limits

| Callback Type | Default Gas Limit |
|---------------|-------------------|
| Event callbacks | 500,000 gas |
| Effect result callbacks | 500,000 gas |
| Constructor (deployment) | 3,000,000 gas |

---

## Strategy Lifecycle

### States

```
┌─────────┐     deploy      ┌────────┐
│  None   │ ───────────────▶│ Active │◀─────────┐
└─────────┘                 └────┬───┘          │
                                 │              │
                    pause        │    resume    │
                    ┌────────────▼──────────────┤
                    │                           │
                    ▼                           │
               ┌─────────┐                      │
               │ Paused  │──────────────────────┘
               └────┬────┘
                    │
                    │ shutdown
                    ▼
               ┌──────────┐
               │ Shutdown │ (terminal)
               └──────────┘
```

### State Definitions

| State | Receives Events | Can Emit Actions | Pending Effects |
|-------|-----------------|------------------|-----------------|
| **Active** | Yes | Yes | Execute normally |
| **Paused** | No | No | Complete (results delivered) |
| **Shutdown** | No | No | Cancelled (no results) |

### State Transitions

```solidity
contract StrategyManager {
    enum StrategyState { Active, Paused, Shutdown }

    struct StrategyInfo {
        address automationWallet;
        uint256 deployedAt;
        StrategyState state;
    }

    mapping(address => StrategyInfo) public strategies;

    function pauseStrategy(address strategyAddress) external onlyCore {
        require(strategies[strategyAddress].state == StrategyState.Active, "Not active");
        strategies[strategyAddress].state = StrategyState.Paused;
        emit StrategyPaused(strategyAddress);
    }

    function resumeStrategy(address strategyAddress) external onlyCore {
        require(strategies[strategyAddress].state == StrategyState.Paused, "Not paused");
        strategies[strategyAddress].state = StrategyState.Active;
        emit StrategyResumed(strategyAddress);
    }

    function shutdownStrategy(address strategyAddress) external onlyCore {
        require(strategies[strategyAddress].state != StrategyState.Shutdown, "Already shutdown");
        strategies[strategyAddress].state = StrategyState.Shutdown;
        emit StrategyShutdown(strategyAddress);
    }

    event StrategyPaused(address indexed strategyAddress);
    event StrategyResumed(address indexed strategyAddress);
    event StrategyShutdown(address indexed strategyAddress);
}
```

### Pause Behavior

When paused:
- **No new events** delivered to strategy
- **Pending effects continue** to execute in real world
- **Effect results ARE delivered** (so strategy can update internal state)
- Strategy can emit new actions from effect result callbacks (queued until resume)

### Shutdown Behavior

When shutdown:
- **No events** delivered
- **Pending effects cancelled** (where possible)
- **No effect results** delivered
- Strategy state is frozen
- Funds remain in automation wallet (user can withdraw)

---

## Logging System

### Strategy-Side Logging Helpers

```solidity
abstract contract BaseStrategy {
    enum LogLevel { Debug, Info, Warn, Error }

    event LogMessage(
        LogLevel indexed level,
        string message,
        bytes data
    );

    function _logDebug(string memory message) internal {
        emit LogMessage(LogLevel.Debug, message, "");
    }

    function _logDebug(string memory message, bytes memory data) internal {
        emit LogMessage(LogLevel.Debug, message, data);
    }

    function _logInfo(string memory message) internal {
        emit LogMessage(LogLevel.Info, message, "");
    }

    function _logInfo(string memory message, bytes memory data) internal {
        emit LogMessage(LogLevel.Info, message, data);
    }

    function _logWarn(string memory message) internal {
        emit LogMessage(LogLevel.Warn, message, "");
    }

    function _logWarn(string memory message, bytes memory data) internal {
        emit LogMessage(LogLevel.Warn, message, data);
    }

    function _logError(string memory message) internal {
        emit LogMessage(LogLevel.Error, message, "");
    }

    function _logError(string memory message, bytes memory data) internal {
        emit LogMessage(LogLevel.Error, message, data);
    }
}
```

### Core-Side Log Processing

```typescript
interface StrategyLogEntry {
  id: string;
  strategyAddress: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data: string;                  // Hex-encoded bytes
  callbackType: string;
  effectId?: string;
  timestamp: Date;
  gasUsedAtLog: bigint;
}

async function processCallbackLogs(
  strategyAddress: Address,
  callbackType: string,
  logs: Log[]
): Promise<void> {
  for (const log of logs) {
    if (log.topics[0] === LOG_MESSAGE_TOPIC) {
      const { level, message, data } = decodeLogMessage(log);
      await db.strategyLogs.create({
        strategyAddress,
        level: LogLevel[level],
        message,
        data,
        callbackType,
        timestamp: new Date(),
      });
    }
  }
}
```

### Log Retention

- **Debug logs**: 7 days
- **Info logs**: 30 days
- **Warn/Error logs**: 90 days
- Configurable per user/strategy

### Log Access

Users can view logs via:
- Midcurve UI dashboard
- API endpoint: `GET /api/v1/strategies/{strategyId}/logs`
- Real-time streaming (WebSocket)

---

## User Actions

Strategies can define custom user-callable functions for parameter changes and manual triggers.

### Owner Injection via Constructor

```solidity
abstract contract BaseStrategy {
    address public immutable owner;

    constructor(address _owner) {
        require(_owner != address(0), "Owner cannot be zero address");
        owner = _owner;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
}
```

### Example Strategy with User Actions

```solidity
contract RebalanceStrategy is BaseStrategy {
    int24 public rangeWidth;
    uint256 public rebalanceThreshold;
    bool public autoCompound;
    bytes32 public activePositionId;
    bytes32 public targetPoolId;

    constructor(
        address _owner,
        bytes32 _poolId,
        int24 _rangeWidth,
        uint256 _rebalanceThreshold,
        bool _autoCompound
    ) BaseStrategy(_owner) {
        targetPoolId = _poolId;
        rangeWidth = _rangeWidth;
        rebalanceThreshold = _rebalanceThreshold;
        autoCompound = _autoCompound;
        _subscribePool(_poolId);
    }

    // === User Actions ===

    function setRangeWidth(int24 _rangeWidth) external onlyOwner {
        require(_rangeWidth > 0 && _rangeWidth <= 10000, "Invalid range width");
        rangeWidth = _rangeWidth;
        _logInfo("Range width updated");
    }

    function setRebalanceThreshold(uint256 _threshold) external onlyOwner {
        require(_threshold > 0 && _threshold <= 10000, "Invalid threshold");
        rebalanceThreshold = _threshold;
        _logInfo("Rebalance threshold updated");
    }

    function setAutoCompound(bool _enabled) external onlyOwner {
        autoCompound = _enabled;
        _logInfo("Auto-compound toggled");
    }

    function triggerRebalance() external onlyOwner {
        require(activePositionId != bytes32(0), "No active position");
        _startRebalance();
        _logInfo("Manual rebalance triggered");
    }

    function triggerCollectFees() external onlyOwner {
        require(activePositionId != bytes32(0), "No active position");
        _emitCollectFees(activePositionId);
        _logInfo("Manual fee collection triggered");
    }

    function withdrawToWallet(
        uint256 chainId,
        address token,
        uint256 amount
    ) external onlyOwner {
        _emitWithdraw(chainId, token, amount);
        _logInfo("Withdrawal requested");
    }

    function emergencyExit() external onlyOwner {
        require(activePositionId != bytes32(0), "No active position");
        _emitRemoveLiquidity(activePositionId, type(uint128).max);
        _logInfo("Emergency exit triggered");
    }

    function switchPool(bytes32 newPoolId) external onlyOwner {
        _unsubscribePool(targetPoolId);
        targetPoolId = newPoolId;
        _subscribePool(newPoolId);
        _logInfo("Pool switched");
    }

    // Internal logic...
    function _startRebalance() internal {
        // Rebalance implementation
    }
}
```

### User Action Execution Flow

```
1. User signs transaction calling strategy function (e.g., triggerRebalance())
       ↓
2. User submits signed tx to Midcurve API
       ↓
3. Core verifies signature matches strategy owner
       ↓
4. Core executes call in EVM:
   evm.call({
     from: userAddress,  // User's EOA (verified via signature)
     to: strategyAddress,
     data: encodedFunctionCall,
     gasLimit: USER_ACTION_GAS_LIMIT,
   })
       ↓
5. Strategy's onlyOwner modifier checks msg.sender == owner
       ↓
6. Function executes, may emit ActionRequested events
       ↓
7. Core processes emitted actions normally
```

### Signature Verification (EIP-712)

```typescript
const domain = {
  name: 'SEMSEE',
  version: '1',
  chainId: 1,
  verifyingContract: strategyAddress,
};

const types = {
  UserAction: [
    { name: 'strategyAddress', type: 'address' },
    { name: 'functionSelector', type: 'bytes4' },
    { name: 'params', type: 'bytes' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
```

### Common User Action Patterns

| Pattern | Functions | Description |
|---------|-----------|-------------|
| **Parameter Tuning** | `setRangeWidth`, `setThreshold` | Adjust strategy behavior |
| **Manual Triggers** | `triggerRebalance`, `triggerCompound` | Override automatic logic |
| **Emergency Controls** | `emergencyExit`, `pauseStrategy` | Quick exit/pause |
| **Fund Management** | `withdrawToWallet`, `depositFromWallet` | Move funds |
| **Pool Management** | `switchPool`, `addPool` | Change target pools |

---

## Modular Strategy Architecture

SEMSEE uses a modular architecture where strategies are composed from **interfaces** (defining callbacks) and **libraries** (providing helper functions). This design allows developers to include only the features they need while maintaining type safety.

### Design Philosophy

1. **Interfaces define callbacks** - Strategies implement interfaces to receive events
2. **Libraries provide helpers** - Subscription and action functions live in libraries
3. **Minimal base contract** - `BaseStrategy` contains only essential infrastructure
4. **Core-side safety** - Subscriptions auto-disable if callbacks don't exist

### Architecture Diagram

```
                    ┌─────────────────────────────────┐
                    │       IStrategy                 │ (interface)
                    │  - owner()                      │
                    └─────────────┬───────────────────┘
                                  │ implements
                    ┌─────────────▼───────────────┐
                    │       BaseStrategy          │ (minimal contract)
                    │  - owner storage            │
                    │  - Effect ID generation     │
                    │  - Logging (uses library)   │
                    │  - onlyOwner modifier       │
                    └─────────────────────────────┘

Interfaces (devs implement):         Libraries (devs use via `using`):
┌───────────────────┐               ┌────────────────────────┐
│ IOhlcConsumer     │ ◄───────────► │ OhlcConsumerLib        │
│ - onOhlcCandle()  │               │ - subscribeOhlc()      │
└───────────────────┘               │ - unsubscribeOhlc()    │
                                    │ - ohlcStore()          │
┌───────────────────┐               └────────────────────────┘
│ IPoolConsumer     │ ◄───────────► ┌────────────────────────┐
│ - onPoolState()   │               │ PoolConsumerLib        │
└───────────────────┘               │ - subscribePool()      │
                                    │ - unsubscribePool()    │
┌───────────────────┐               │ - poolStore()          │
│ IBalanceConsumer  │               └────────────────────────┘
│ - onBalanceUpdate │ ◄───────────► ┌────────────────────────┐
└───────────────────┘               │ BalanceConsumerLib     │
                                    │ - subscribeBalance()   │
┌───────────────────┐               │ - unsubscribeBalance() │
│ IUniswapV3Actions │               │ - balanceStore()       │
│ - onPositionUpdate│               └────────────────────────┘
│ - onAddComplete   │ ◄───────────► ┌────────────────────────┐
│ - onRemoveComplete│               │ UniswapV3ActionLib     │
│ - onCollectComplete               │ - emitAddLiquidity()   │
└───────────────────┘               │ - emitRemoveLiquidity()│
                                    │ - emitCollectFees()    │
┌───────────────────┐               │ - subscribePosition()  │
│ IFundingActions   │               │ - positionStore()      │
│ - onWithdrawComplete              └────────────────────────┘
└───────────────────┘ ◄───────────► ┌────────────────────────┐
                                    │ FundingActionLib       │
                                    │ - emitWithdraw()       │
                                    └────────────────────────┘
```

### Module Responsibility Matrix

| Module | Interface | Library | Subscriptions | Callbacks | Actions |
|--------|-----------|---------|---------------|-----------|---------|
| **Base** | IStrategy | LoggingLib | None | None | None |
| **OHLC** | IOhlcConsumer | OhlcConsumerLib | OHLC | onOhlcCandle | None |
| **Pool** | IPoolConsumer | PoolConsumerLib | Pool | onPoolStateUpdate | None |
| **Balance** | IBalanceConsumer | BalanceConsumerLib | Balance | onBalanceUpdate | None |
| **UniswapV3** | IUniswapV3Actions | UniswapV3ActionLib | Position | onPosition*, on*Complete | Add/Remove/Collect |
| **Funding** | IFundingActions | FundingActionLib | None | onWithdrawComplete | Withdraw |

### Subscription Safety: Core-Side Runtime Detection

When a strategy subscribes to events but hasn't implemented the corresponding callback, Core handles this gracefully:

1. **First event delivery** - Core attempts to call the callback
2. **If callback missing** - Call reverts with "function selector not found"
3. **Core disables subscription** - Marks subscription as disabled, logs warning
4. **User code errors** - If callback exists but reverts with user error, subscription remains active

```typescript
// Core pseudocode
async function deliverEvent(strategyAddress, callbackName, params) {
  try {
    await evm.call({ to: strategyAddress, data: encodeABI(callbackName, params) });
  } catch (error) {
    if (isFunctionNotFoundError(error)) {
      subscriptionManager.disableSubscription(strategyAddress, subscriptionType);
      logger.warn(`Strategy ${strategyAddress} missing ${callbackName}, subscription disabled`);
    }
  }
}
```

**Benefits:**
- No compile-time restrictions on library usage
- Graceful degradation (system continues operating)
- Clear feedback via logs
- Gas efficient (one failed attempt per missing callback)

### Event Handling Note

Each module library declares its own events. While Solidity allows multiple declarations of the same event signature, we recommend strategies use consistent library imports to avoid confusion in log parsing.

---

## BaseStrategy Reference

The minimal `BaseStrategy` contract provides only essential infrastructure:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IStrategy.sol";
import "./LoggingLib.sol";

contract BaseStrategy is IStrategy {
    using LoggingLib for *;

    // =========== System Constants ===========
    SystemRegistry constant REGISTRY = SystemRegistry(0x0000000000000000000000000000000000001000);

    // =========== Owner ===========
    address public immutable owner;

    constructor(address _owner) {
        require(_owner != address(0), "Owner cannot be zero address");
        owner = _owner;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    // =========== Effect ID Generation ===========
    uint256 private _effectCounter;

    function _nextEffectId() internal returns (bytes32) {
        _effectCounter++;
        return keccak256(abi.encodePacked(address(this), _effectCounter));
    }
}
```

### LoggingLib

```solidity
library LoggingLib {
    enum LogLevel { Debug, Info, Warn, Error }
    event LogMessage(LogLevel indexed level, string message, bytes data);

    function logDebug(string memory message) internal {
        emit LogMessage(LogLevel.Debug, message, "");
    }

    function logInfo(string memory message) internal {
        emit LogMessage(LogLevel.Info, message, "");
    }

    function logWarn(string memory message) internal {
        emit LogMessage(LogLevel.Warn, message, "");
    }

    function logError(string memory message) internal {
        emit LogMessage(LogLevel.Error, message, "");
    }
}
```

**BaseStrategy does NOT contain:**
- Store accessors (moved to module libraries)
- Subscription helpers (moved to module libraries)
- Callbacks (defined by module interfaces)
- Action emitters (moved to module libraries)

---

## Module Interfaces & Libraries

### IOhlcConsumer + OhlcConsumerLib

**Interface:**
```solidity
interface IOhlcConsumer {
    function onOhlcCandle(
        bytes32 marketId,
        uint8 timeframe,
        OhlcCandle calldata candle
    ) external;
}
```

**Library:**
```solidity
library OhlcConsumerLib {
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    function subscribeOhlc(bytes32 marketId, uint8 timeframe) internal {
        emit SubscriptionRequested(keccak256("Subscription:Ohlc:v1"), abi.encode(marketId, timeframe));
    }

    function unsubscribeOhlc(bytes32 marketId, uint8 timeframe) internal {
        emit UnsubscriptionRequested(keccak256("Subscription:Ohlc:v1"), abi.encode(marketId, timeframe));
    }

    function ohlcStore() internal view returns (OhlcStore) {
        SystemRegistry registry = SystemRegistry(0x0000000000000000000000000000000000001000);
        return OhlcStore(registry.ohlcStore());
    }
}
```

### IPoolConsumer + PoolConsumerLib

**Interface:**
```solidity
interface IPoolConsumer {
    function onPoolStateUpdate(
        bytes32 poolId,
        uint256 chainId,
        address poolAddress,
        uint160 sqrtPriceX96,
        int24 tick,
        uint128 liquidity,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128
    ) external;
}
```

**Library:**
```solidity
library PoolConsumerLib {
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    function subscribePool(bytes32 poolId) internal {
        emit SubscriptionRequested(keccak256("Subscription:Pool:v1"), abi.encode(poolId));
    }

    function unsubscribePool(bytes32 poolId) internal {
        emit UnsubscriptionRequested(keccak256("Subscription:Pool:v1"), abi.encode(poolId));
    }

    function poolStore() internal view returns (PoolStore) {
        SystemRegistry registry = SystemRegistry(0x0000000000000000000000000000000000001000);
        return PoolStore(registry.poolStore());
    }
}
```

### IBalanceConsumer + BalanceConsumerLib

**Interface:**
```solidity
interface IBalanceConsumer {
    function onBalanceUpdate(
        uint256 chainId,
        address token,
        uint256 balance
    ) external;
}
```

**Library:**
```solidity
library BalanceConsumerLib {
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);

    function subscribeBalance(uint256 chainId, address token) internal {
        emit SubscriptionRequested(keccak256("Subscription:Balance:v1"), abi.encode(chainId, token));
    }

    function unsubscribeBalance(uint256 chainId, address token) internal {
        emit UnsubscriptionRequested(keccak256("Subscription:Balance:v1"), abi.encode(chainId, token));
    }

    function balanceStore() internal view returns (BalanceStore) {
        SystemRegistry registry = SystemRegistry(0x0000000000000000000000000000000000001000);
        return BalanceStore(registry.balanceStore());
    }
}
```

### IUniswapV3Actions + UniswapV3ActionLib

**Interface:**
```solidity
interface IUniswapV3Actions {
    function onPositionUpdate(
        bytes32 positionId,
        uint256 chainId,
        uint256 nftTokenId,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    ) external;

    function onAddLiquidityComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint256 chainId,
        uint256 nftTokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external;

    function onRemoveLiquidityComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint128 liquidityRemoved,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external;

    function onCollectFeesComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external;
}
```

**Library:**
```solidity
library UniswapV3ActionLib {
    event SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
    event UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload);
    event ActionRequested(bytes32 indexed actionType, bytes payload);

    function subscribePosition(bytes32 positionId) internal {
        emit SubscriptionRequested(keccak256("Subscription:Position:v1"), abi.encode(positionId));
    }

    function unsubscribePosition(bytes32 positionId) internal {
        emit UnsubscriptionRequested(keccak256("Subscription:Position:v1"), abi.encode(positionId));
    }

    function emitAddLiquidity(
        bytes32 effectId,
        bytes32 poolId,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) internal {
        emit ActionRequested(
            keccak256("Action:UniswapV3:AddLiquidity:v1"),
            abi.encode(effectId, poolId, tickLower, tickUpper, amount0Desired, amount1Desired)
        );
    }

    function emitRemoveLiquidity(
        bytes32 effectId,
        bytes32 positionId,
        uint128 liquidityAmount
    ) internal {
        emit ActionRequested(
            keccak256("Action:UniswapV3:RemoveLiquidity:v1"),
            abi.encode(effectId, positionId, liquidityAmount)
        );
    }

    function emitCollectFees(bytes32 effectId, bytes32 positionId) internal {
        emit ActionRequested(
            keccak256("Action:UniswapV3:CollectFees:v1"),
            abi.encode(effectId, positionId)
        );
    }

    function positionStore() internal view returns (PositionStore) {
        SystemRegistry registry = SystemRegistry(0x0000000000000000000000000000000000001000);
        return PositionStore(registry.positionStore());
    }
}
```

### IFundingActions + FundingActionLib

**Interface:**
```solidity
interface IFundingActions {
    function onWithdrawComplete(
        bytes32 effectId,
        uint256 chainId,
        address token,
        uint256 requestedAmount,
        uint256 executedAmount,
        bytes32 txHash,
        bool success,
        string calldata errorMessage
    ) external;
}
```

**Library:**
```solidity
library FundingActionLib {
    event ActionRequested(bytes32 indexed actionType, bytes payload);

    function emitWithdraw(
        bytes32 effectId,
        uint256 chainId,
        address token,
        uint256 amount
    ) internal {
        emit ActionRequested(
            keccak256("Action:Funding:Withdraw:v1"),
            abi.encode(effectId, chainId, token, amount)
        );
    }
}
```

---

## Module Composition Examples

### Example 1: Simple Price Monitor (OHLC only)

A minimal strategy that tracks price data without any actions:

```solidity
contract PriceMonitor is BaseStrategy, IOhlcConsumer {
    using OhlcConsumerLib for *;
    using LoggingLib for *;

    bytes32 public monitoredMarket;
    uint256 public lastPrice;

    constructor(address _owner, bytes32 _marketId) BaseStrategy(_owner) {
        monitoredMarket = _marketId;
        OhlcConsumerLib.subscribeOhlc(_marketId, TIMEFRAME_1H);
    }

    function onOhlcCandle(
        bytes32 marketId,
        uint8 timeframe,
        OhlcCandle calldata candle
    ) external override {
        if (marketId == monitoredMarket) {
            lastPrice = candle.close;
            LoggingLib.logInfo("Price updated");
        }
    }
}
```

### Example 2: Pool Watcher (Pool + Balance)

Monitors pool state and token balances:

```solidity
contract PoolWatcher is BaseStrategy, IPoolConsumer, IBalanceConsumer {
    using PoolConsumerLib for *;
    using BalanceConsumerLib for *;
    using LoggingLib for *;

    bytes32 public targetPool;

    constructor(
        address _owner,
        bytes32 _poolId,
        address _token0,
        address _token1
    ) BaseStrategy(_owner) {
        targetPool = _poolId;
        PoolConsumerLib.subscribePool(_poolId);
        BalanceConsumerLib.subscribeBalance(1, _token0);
        BalanceConsumerLib.subscribeBalance(1, _token1);
    }

    function onPoolStateUpdate(
        bytes32 poolId,
        uint256 chainId,
        address poolAddress,
        uint160 sqrtPriceX96,
        int24 tick,
        uint128 liquidity,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128
    ) external override {
        LoggingLib.logInfo("Pool state updated");
    }

    function onBalanceUpdate(
        uint256 chainId,
        address token,
        uint256 balance
    ) external override {
        LoggingLib.logInfo("Balance updated");
    }
}
```

### Example 3: Full Rebalancer (Pool + UniswapV3 Actions)

A complete rebalancing strategy using pool events and position actions:

```solidity
contract Rebalancer is BaseStrategy, IPoolConsumer, IUniswapV3Actions {
    using PoolConsumerLib for *;
    using UniswapV3ActionLib for *;
    using LoggingLib for *;

    bytes32 public targetPool;
    bytes32 public activePosition;
    int24 public rangeWidth;

    constructor(address _owner, bytes32 _poolId, int24 _rangeWidth) BaseStrategy(_owner) {
        targetPool = _poolId;
        rangeWidth = _rangeWidth;
        PoolConsumerLib.subscribePool(_poolId);
    }

    function onPoolStateUpdate(
        bytes32 poolId,
        uint256 chainId,
        address poolAddress,
        uint160 sqrtPriceX96,
        int24 tick,
        uint128 liquidity,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128
    ) external override {
        if (poolId == targetPool && activePosition != bytes32(0)) {
            if (_shouldRebalance(tick)) {
                bytes32 effectId = _nextEffectId();
                UniswapV3ActionLib.emitRemoveLiquidity(effectId, activePosition, type(uint128).max);
            }
        }
    }

    function onPositionUpdate(
        bytes32 positionId,
        uint256 chainId,
        uint256 nftTokenId,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    ) external override {
        // Track position state
    }

    function onAddLiquidityComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint256 chainId,
        uint256 nftTokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external override {
        if (success) {
            activePosition = positionId;
            UniswapV3ActionLib.subscribePosition(positionId);
            LoggingLib.logInfo("Position created");
        }
    }

    function onRemoveLiquidityComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint128 liquidityRemoved,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external override {
        if (success) {
            int24 currentTick = PoolConsumerLib.poolStore().getCurrentTick(targetPool);
            int24 newLower = currentTick - rangeWidth / 2;
            int24 newUpper = currentTick + rangeWidth / 2;

            bytes32 newEffectId = _nextEffectId();
            UniswapV3ActionLib.emitAddLiquidity(newEffectId, targetPool, newLower, newUpper, amount0, amount1);
        }
    }

    function onCollectFeesComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external override {
        LoggingLib.logInfo("Fees collected");
    }

    function _shouldRebalance(int24 tick) internal view returns (bool) {
        return false; // Implementation placeholder
    }
}
```

---

## Complete Example: Rebalancing Strategy

A production-ready rebalancing strategy using the modular architecture with user actions:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseStrategy.sol";
import "./interfaces/IPoolConsumer.sol";
import "./interfaces/IUniswapV3Actions.sol";
import "./libraries/PoolConsumerLib.sol";
import "./libraries/UniswapV3ActionLib.sol";
import "./libraries/LoggingLib.sol";

contract RebalanceStrategy is BaseStrategy, IPoolConsumer, IUniswapV3Actions {
    using PoolConsumerLib for *;
    using UniswapV3ActionLib for *;
    using LoggingLib for *;

    // =========== Configuration ===========
    bytes32 public targetPoolId;
    int24 public rangeWidth;
    uint256 public rebalanceThresholdBps; // Basis points (100 = 1%)

    // =========== State ===========
    bytes32 public activePositionId;
    int24 public positionTickLower;
    int24 public positionTickUpper;

    struct PendingRebalance {
        bytes32 poolId;
        int24 targetTickLower;
        int24 targetTickUpper;
    }

    mapping(bytes32 => PendingRebalance) public pendingRebalances;

    // =========== Constructor ===========
    constructor(
        address _owner,
        bytes32 _poolId,
        int24 _rangeWidth,
        uint256 _rebalanceThresholdBps
    ) BaseStrategy(_owner) {
        targetPoolId = _poolId;
        rangeWidth = _rangeWidth;
        rebalanceThresholdBps = _rebalanceThresholdBps;

        // Subscribe to pool updates using library
        PoolConsumerLib.subscribePool(_poolId);

        LoggingLib.logInfo("Strategy initialized");
    }

    // =========== IPoolConsumer Callback ===========

    function onPoolStateUpdate(
        bytes32 poolId,
        uint256 chainId,
        address poolAddress,
        uint160 sqrtPriceX96,
        int24 tick,
        uint128 liquidity,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128
    ) external override {
        // Only react to our target pool
        if (poolId != targetPoolId) return;

        // Skip if no active position
        if (activePositionId == bytes32(0)) return;

        // Check if price moved out of our range
        if (_isPriceOutOfRange(tick)) {
            LoggingLib.logInfo("Price out of range, triggering rebalance");
            _startRebalance(tick);
        }
    }

    // =========== IUniswapV3Actions Callbacks ===========

    function onPositionUpdate(
        bytes32 positionId,
        uint256 chainId,
        uint256 nftTokenId,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    ) external override {
        // Track position state changes
        if (positionId == activePositionId) {
            LoggingLib.logDebug("Position state updated");
        }
    }

    function onAddLiquidityComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint256 chainId,
        uint256 nftTokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external override {
        if (!success) {
            LoggingLib.logError("Add liquidity failed");
            return;
        }

        // Update active position
        activePositionId = positionId;

        // Subscribe to position updates
        UniswapV3ActionLib.subscribePosition(positionId);

        LoggingLib.logInfo("Position created/updated");
    }

    function onRemoveLiquidityComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint128 liquidityRemoved,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external override {
        PendingRebalance memory rebalance = pendingRebalances[effectId];
        delete pendingRebalances[effectId];

        if (!success) {
            LoggingLib.logError("Remove liquidity failed");
            return;
        }

        // Add liquidity at new range
        bytes32 newEffectId = _nextEffectId();
        UniswapV3ActionLib.emitAddLiquidity(
            newEffectId,
            rebalance.poolId,
            rebalance.targetTickLower,
            rebalance.targetTickUpper,
            amount0,
            amount1
        );

        // Update position bounds
        positionTickLower = rebalance.targetTickLower;
        positionTickUpper = rebalance.targetTickUpper;

        LoggingLib.logInfo("Rebalance: adding liquidity at new range");
    }

    function onCollectFeesComplete(
        bytes32 effectId,
        bytes32 positionId,
        uint256 amount0,
        uint256 amount1,
        bool success,
        string calldata errorMessage
    ) external override {
        if (success) {
            LoggingLib.logInfo("Fees collected");
        } else {
            LoggingLib.logError("Fee collection failed");
        }
    }

    // =========== User Actions ===========

    function setRangeWidth(int24 _rangeWidth) external onlyOwner {
        require(_rangeWidth > 0 && _rangeWidth <= 10000, "Invalid range");
        rangeWidth = _rangeWidth;
        LoggingLib.logInfo("Range width updated");
    }

    function setRebalanceThreshold(uint256 _thresholdBps) external onlyOwner {
        require(_thresholdBps > 0 && _thresholdBps <= 10000, "Invalid threshold");
        rebalanceThresholdBps = _thresholdBps;
        LoggingLib.logInfo("Rebalance threshold updated");
    }

    function triggerRebalance() external onlyOwner {
        require(activePositionId != bytes32(0), "No active position");
        int24 currentTick = PoolConsumerLib.poolStore().getCurrentTick(targetPoolId);
        _startRebalance(currentTick);
        LoggingLib.logInfo("Manual rebalance triggered");
    }

    function collectFees() external onlyOwner {
        require(activePositionId != bytes32(0), "No active position");
        bytes32 effectId = _nextEffectId();
        UniswapV3ActionLib.emitCollectFees(effectId, activePositionId);
        LoggingLib.logInfo("Fee collection triggered");
    }

    function emergencyExit() external onlyOwner {
        require(activePositionId != bytes32(0), "No active position");
        bytes32 effectId = _nextEffectId();
        UniswapV3ActionLib.emitRemoveLiquidity(effectId, activePositionId, type(uint128).max);
        activePositionId = bytes32(0);
        LoggingLib.logInfo("Emergency exit executed");
    }

    function switchPool(bytes32 newPoolId) external onlyOwner {
        PoolConsumerLib.unsubscribePool(targetPoolId);
        targetPoolId = newPoolId;
        PoolConsumerLib.subscribePool(newPoolId);
        LoggingLib.logInfo("Pool switched");
    }

    // =========== Internal Functions ===========

    function _isPriceOutOfRange(int24 currentTick) internal view returns (bool) {
        if (positionTickLower == 0 && positionTickUpper == 0) {
            return false; // No position bounds set
        }
        return currentTick < positionTickLower || currentTick >= positionTickUpper;
    }

    function _startRebalance(int24 currentTick) internal {
        // Calculate new range centered on current tick
        int24 newTickLower = currentTick - rangeWidth / 2;
        int24 newTickUpper = currentTick + rangeWidth / 2;

        // Align to tick spacing (simplified - assume 60 for 0.3% fee tier)
        newTickLower = (newTickLower / 60) * 60;
        newTickUpper = (newTickUpper / 60) * 60;

        // Remove all liquidity from current position
        bytes32 effectId = _nextEffectId();
        UniswapV3ActionLib.emitRemoveLiquidity(effectId, activePositionId, type(uint128).max);

        // Store rebalance context for callback
        pendingRebalances[effectId] = PendingRebalance({
            poolId: targetPoolId,
            targetTickLower: newTickLower,
            targetTickUpper: newTickUpper
        });

        LoggingLib.logInfo("Rebalance started: removing liquidity");
    }
}
```

### Key Features Demonstrated

1. **Modular imports** - Uses interfaces (`IPoolConsumer`, `IUniswapV3Actions`) and libraries (`PoolConsumerLib`, `UniswapV3ActionLib`, `LoggingLib`)

2. **Library usage pattern** - `using XxxLib for *;` enables clean function calls

3. **Event-driven flow** - Pool state changes trigger rebalancing logic

4. **Effect tracking** - `pendingRebalances` mapping tracks async operation context

5. **User actions** - Parameter tuning, manual triggers, and emergency controls

6. **Subscription management** - Dynamic subscribe/unsubscribe via libraries

---

## Appendix: Core Orchestrator Flow

```
1. External Event Arrives (e.g., pool price update)
       ↓
2. StoreSynchronizer updates PoolStore
       ↓
3. SubscriptionManager.getSubscribers(poolId) → [strategyA, strategyB]
       ↓
4. For each subscriber:
   │
   ├─→ VmRunner.call(strategyA, "onPoolStateUpdate", params)
   │       ↓
   │   Extract logs: SubscriptionRequested, ActionRequested
   │       ↓
   │   Update SubscriptionManager (if subscription changed)
   │       ↓
   │   Route Actions to EffectEngine
   │       ↓
   │   (async) EffectEngine executes on-chain tx
   │       ↓
   │   (async) VmRunner.call(strategyA, "onRemoveLiquidityComplete", result)
   │
   └─→ VmRunner.call(strategyB, "onPoolStateUpdate", params)
           ↓
       ... same flow ...
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.8 | - | Initial whitepaper |
| 0.9 | 2025-12 | Explicit typed callbacks, subscription system, user actions |
| 0.10 | 2025-12 | Modular strategy architecture: interfaces + libraries pattern, Core-side subscription safety |

---

## License

MIT License - Midcurve Finance
