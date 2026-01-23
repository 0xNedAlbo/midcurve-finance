# @midcurve/hedges

Smart contracts for the MidcurveHedgeVault system, implementing the Diamond Pattern (EIP-2535) for Uniswap V3 position management with hedging capabilities.

## Overview

This package contains:

- **Diamond Pattern Implementation** - Modular, upgradeable vault contracts split into facets
- **Legacy Contracts** - Original monolithic contracts (for reference)
- **Factory Contract** - Deploys vault diamonds with shared facets for 99% gas savings
- **Position Closer** - Atomic position closing with Paraswap integration

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SHARED (Deploy Once Per Chain)                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │PositionFacet│ │DepositFacet  │ │StateFacet    │            │
│  │  ~8KB       │ │  ~6KB        │ │  ~7KB        │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ SwapFacet   │ │SettingsFacet │ │ LoupeFacet   │            │
│  │  ~4KB       │ │  ~3KB        │ │  ~2KB        │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ delegatecall
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 PER-USER (Deploy via Factory)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Diamond Proxy (~100K gas)                   │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ AppStorage (user-specific state)                │    │   │
│  │  │ - positionId, manager, operator                 │    │   │
│  │  │ - shares, fees, state machine                   │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Contract Structure

```
contracts/
├── diamond/                    # Diamond infrastructure (EIP-2535)
│   ├── Diamond.sol             # Main proxy contract
│   ├── DiamondCutFacet.sol     # Facet management
│   ├── DiamondLoupeFacet.sol   # Introspection
│   └── LibDiamond.sol          # Diamond storage library
├── facets/                     # Diamond facets (10 files)
│   ├── DepositWithdrawFacet.sol
│   ├── InitFacet.sol
│   ├── OwnershipFacet.sol
│   ├── PositionFacet.sol
│   ├── SettingsFacet.sol
│   ├── StateFacet.sol
│   ├── StateTransitionFacet.sol
│   ├── SwapFacet.sol
│   ├── ViewFacet.sol
│   └── WhitelistFacet.sol
├── storage/
│   └── AppStorage.sol          # Shared storage struct
├── libraries/
│   └── LibVault.sol            # Shared vault logic
├── interfaces/                 # Contract interfaces
├── legacy/                     # Original monolithic contracts
│   ├── MidcurveHedgeVaultV1.sol
│   ├── HedgeVault.sol
│   └── UniswapV3PositionVault.sol
├── mocks/                      # Test mocks
├── test/                       # Foundry tests
│   ├── unit/
│   └── integration/
├── MidcurveHedgeVaultDiamondFactory.sol  # Factory for deploying vaults
└── UniswapV3PositionCloser.sol           # Position closing logic
```

## Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Node.js 20.x

### Setup

```bash
# Install dependencies
forge install

# Build contracts
forge build

# Run tests
forge test
```

### Commands

```bash
# Build all contracts
pnpm forge:build

# Build with size output
pnpm forge:build:sizes

# Run all tests
pnpm forge:test

# Run unit tests only
pnpm forge:test:unit

# Run integration tests (requires fork)
pnpm forge:test:integration

# Format code
pnpm forge:fmt
```

## Deployment

### Production Deployment

Deploy facets and factory to production chains:

```bash
# Dry run (simulation)
pnpm deploy:production:dry-run

# Production deployment
pnpm deploy:production
```

Required environment variables:
- `DEPLOYER_PRIVATE_KEY` - Deployer wallet private key
- `RPC_URL_ETHEREUM` - Ethereum RPC endpoint
- `RPC_URL_ARBITRUM` - Arbitrum RPC endpoint
- `RPC_URL_BASE` - Base RPC endpoint
- `ETHERSCAN_API_KEY` - For contract verification

### Individual Chain Deployment

```bash
# Deploy to Ethereum
pnpm deploy:ethereum

# Deploy to Arbitrum
pnpm deploy:arbitrum

# Deploy to Base
pnpm deploy:base
```

## Gas Comparison

| Approach | Gas per Vault | Cost @ 0.179 gwei, $2,990 ETH |
|----------|---------------|-------------------------------|
| Monolithic | ~6.6M | ~$3.53 (also exceeds 24KB) |
| Diamond Factory | ~100-150K | **~$0.05-0.08** |

**99% gas savings** for users deploying vaults.

## Key Benefits

1. **Solves 24KB limit** - Each facet well under the EIP-170 limit
2. **99% gas savings** - Deploy ~100K gas proxy vs 6.6M full contract
3. **Shared facets** - One deployment per chain, reused by all vaults
4. **Upgradeable** - Can fix bugs by replacing facets
5. **On-chain registry** - Factory tracks all deployed diamonds

## License

MIT
