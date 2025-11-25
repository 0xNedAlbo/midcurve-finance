# Risk Layer Architecture

The Risk Layer provides a protocol-agnostic abstraction for mapping on-chain tokens to economic risk assets and determining hedge eligibility for concentrated liquidity positions.

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Risk Layer Architecture                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐                                               │
│  │  Uniswap V3      │                                               │
│  │  Position        │                                               │
│  │  (WETH/USDC)     │                                               │
│  └────────┬─────────┘                                               │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │              RiskAssetRegistry (Singleton)                │       │
│  │  ┌────────────────────────────────────────────────────┐  │       │
│  │  │ Token Mappings:                                     │  │       │
│  │  │   WETH (0xC02...) → ETH (volatile)                 │  │       │
│  │  │   USDC (0xA0b...) → USD (stable)                   │  │       │
│  │  │   WBTC (0x2260...) → BTC (volatile)                │  │       │
│  │  └────────────────────────────────────────────────────┘  │       │
│  └────────┬─────────────────────────────────────────────────┘       │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │              RiskLayerService                             │       │
│  │  ┌────────────────────────────────────────────────────┐  │       │
│  │  │ deriveRiskPair() → PositionRiskPair                │  │       │
│  │  │ classifyHedgeEligibility() → HedgeEligibility      │  │       │
│  │  │ buildPositionRiskView() → PositionRiskView         │  │       │
│  │  └────────────────────────────────────────────────────┘  │       │
│  └────────┬─────────────────────────────────────────────────┘       │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │              Protocol-Specific Resolvers                  │       │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────┐  │       │
│  │  │ Hyperliquid     │  │ Deribit         │  │ GMX      │  │       │
│  │  │ Resolver        │  │ Resolver        │  │ Resolver │  │       │
│  │  │ (implemented)   │  │ (future)        │  │ (future) │  │       │
│  │  └─────────────────┘  └─────────────────┘  └──────────┘  │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Economic Risk Assets

On-chain tokens (WETH, WBTC, USDC) are mapped to their underlying economic risk:

| Risk Asset ID | Role     | On-chain Tokens                    |
|---------------|----------|-------------------------------------|
| `ETH`         | volatile | WETH, stETH, cbETH                 |
| `BTC`         | volatile | WBTC, tBTC                         |
| `USD`         | stable   | USDC, USDT, DAI, FRAX              |
| `EUR`         | stable   | EURS, EURT                         |
| `SOL`         | volatile | (Solana native)                    |
| `OTHER`       | other    | Unknown/unmapped tokens            |

### Risk Asset Roles

- **volatile**: Assets with significant price volatility (ETH, BTC, SOL)
- **stable**: Assets pegged to fiat currencies (USDC, USDT, DAI)
- **other**: Unclassified or exotic assets

### Hedge Eligibility

Positions are classified based on their hedge-ability:

| Eligibility   | Criteria                                      | Example              |
|---------------|-----------------------------------------------|----------------------|
| `simplePerp`  | Volatile base + stable quote                  | ETH/USD, BTC/USD     |
| `advanced`    | Volatile/volatile pairs (future support)      | ETH/BTC              |
| `none`        | Stable/stable, other/other, unknown           | USDC/USDT            |

## Package Structure

### @midcurve/shared (Types)

```
packages/midcurve-shared/src/types/risk/
├── risk-asset.ts      # RiskAssetId, RiskAssetRole, RiskAsset
├── risk-pair.ts       # PositionRiskPair, HedgeEligibility, PositionRiskView
└── index.ts           # Barrel exports
```

**Key Types:**

```typescript
// Economic risk asset identifier
type RiskAssetId = 'ETH' | 'BTC' | 'USD' | 'EUR' | 'SOL' | 'OTHER';

// Asset classification
type RiskAssetRole = 'volatile' | 'stable' | 'other';

// Risk analysis output
interface PositionRiskView {
  riskBase: RiskAssetId;
  riskQuote: RiskAssetId;
  baseRole: RiskAssetRole;
  quoteRole: RiskAssetRole;
  hedgeEligibility: HedgeEligibility;
  hedgeIneligibleReason?: string;
}
```

### @midcurve/services (Implementation)

```
packages/midcurve-services/src/services/risk/
├── risk-asset-registry.ts         # Token → RiskAsset mapping
├── risk-layer-service.ts          # Core risk analysis service
├── resolvers/
│   ├── types.ts                   # HedgeResolver interface
│   ├── hyperliquid-hedge-resolver.ts  # Hyperliquid implementation
│   └── index.ts                   # Resolver exports
└── index.ts                       # Risk layer exports
```

## Usage

### Basic Risk Analysis

```typescript
import { RiskLayerService } from '@midcurve/services';

const riskService = new RiskLayerService();

// Analyze a Uniswap V3 position
const position = {
  /* UniswapV3Position with baseToken, quoteToken */
};

// Get full risk view
const riskView = riskService.buildPositionRiskView(position);

console.log(riskView);
// {
//   riskBase: 'ETH',
//   riskQuote: 'USD',
//   baseRole: 'volatile',
//   quoteRole: 'stable',
//   hedgeEligibility: 'simplePerp'
// }

// Quick check for perp hedge eligibility
if (riskService.canHedgeWithPerp(position)) {
  // Position can be hedged with a perpetual short
}
```

### Hyperliquid-Specific Resolution

```typescript
import {
  RiskLayerService,
  getHyperliquidMarket,
  HyperliquidHedgeResolver,
} from '@midcurve/services';

const riskService = new RiskLayerService();
const riskView = riskService.buildPositionRiskView(position);

// Option 1: Use helper function
const hlMarket = getHyperliquidMarket(riskView);
if (hlMarket) {
  console.log(hlMarket);
  // { coin: 'ETH', market: 'ETH-USD', quote: 'USD' }
}

// Option 2: Use resolver class directly
const resolver = new HyperliquidHedgeResolver();

if (resolver.canResolve(riskView.riskBase)) {
  const params = resolver.resolve(riskView);
  // { protocol: 'hyperliquid', data: { coin: 'ETH', market: 'ETH-USD', quote: 'USD' } }
}
```

### Registry Customization

```typescript
import { RiskAssetRegistry } from '@midcurve/services';

const registry = RiskAssetRegistry.getInstance();

// Register custom token mapping
registry.registerToken(
  '0xYourTokenAddress',
  1, // chainId
  {
    id: 'ETH',
    role: 'volatile',
    displayName: 'Ethereum',
  }
);

// Lookup risk asset for any token
const riskAsset = registry.getRiskAsset('0xC02...', 1);
// { id: 'ETH', role: 'volatile', displayName: 'Ethereum' }
```

## Extending for New Protocols

To add support for a new hedging protocol (e.g., Deribit, GMX):

### 1. Create a New Resolver

```typescript
// packages/midcurve-services/src/services/risk/resolvers/deribit-hedge-resolver.ts

import type { PositionRiskView, RiskAssetId } from '@midcurve/shared';
import type { HedgeResolver, HedgeParams } from './types.js';

export interface DeribitResolvedMarket {
  instrument: string; // e.g., 'ETH-PERPETUAL'
  currency: string; // e.g., 'ETH'
}

const RISK_ASSET_TO_DERIBIT: Partial<Record<RiskAssetId, string>> = {
  ETH: 'ETH',
  BTC: 'BTC',
};

export class DeribitHedgeResolver implements HedgeResolver {
  readonly protocol = 'deribit';

  canResolve(riskAssetId: RiskAssetId): boolean {
    return riskAssetId in RISK_ASSET_TO_DERIBIT;
  }

  resolve(riskView: PositionRiskView): HedgeParams | null {
    if (riskView.hedgeEligibility !== 'simplePerp') {
      return null;
    }

    const currency = RISK_ASSET_TO_DERIBIT[riskView.riskBase];
    if (!currency) {
      return null;
    }

    return {
      protocol: this.protocol,
      data: {
        instrument: `${currency}-PERPETUAL`,
        currency,
      } as DeribitResolvedMarket,
    };
  }
}

export function getDeribitMarket(
  riskView: PositionRiskView
): DeribitResolvedMarket | null {
  const resolver = new DeribitHedgeResolver();
  const result = resolver.resolve(riskView);
  return result?.data as DeribitResolvedMarket | null;
}
```

### 2. Export from Resolvers Index

```typescript
// packages/midcurve-services/src/services/risk/resolvers/index.ts

export type { HedgeParams, HedgeResolver } from './types.js';

export {
  HyperliquidHedgeResolver,
  getHyperliquidMarket,
} from './hyperliquid-hedge-resolver.js';
export type { HyperliquidResolvedMarket } from './hyperliquid-hedge-resolver.js';

// Add new resolver
export {
  DeribitHedgeResolver,
  getDeribitMarket,
} from './deribit-hedge-resolver.js';
export type { DeribitResolvedMarket } from './deribit-hedge-resolver.js';
```

## Design Decisions

### Why Separate Risk Layer from Resolvers?

1. **Single Responsibility**: Risk analysis (volatile/stable classification) is distinct from protocol-specific market mapping
2. **Extensibility**: Add new hedging protocols without modifying core risk logic
3. **Testability**: Test risk classification independently from protocol integrations
4. **Reusability**: Risk views can be used for analytics, not just hedging

### Why Singleton for RiskAssetRegistry?

1. **Global State**: Token mappings are application-wide constants
2. **Memory Efficiency**: Single instance shared across all services
3. **Lazy Loading**: Instance created on first access
4. **Runtime Registration**: Allows dynamic token additions

### Why Protocol-Agnostic Types in @midcurve/shared?

1. **Portability**: Types work in browser, Node.js, and edge runtimes
2. **No Dependencies**: Pure TypeScript, no service layer coupling
3. **API Contracts**: Types can be used in API request/response definitions
4. **UI Integration**: Frontend can display risk classifications without backend code

## Token Mappings

The registry includes pre-configured mappings for major tokens across supported chains:

### Ethereum (Chain ID: 1)

| Token   | Address                                      | Risk Asset |
|---------|----------------------------------------------|------------|
| WETH    | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | ETH        |
| WBTC    | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | BTC        |
| USDC    | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | USD        |
| USDT    | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | USD        |
| DAI     | `0x6B175474E89094C44Da98b954EescdeCB5BE3D85` | USD        |

### Arbitrum (Chain ID: 42161)

| Token   | Address                                      | Risk Asset |
|---------|----------------------------------------------|------------|
| WETH    | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | ETH        |
| WBTC    | `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f` | BTC        |
| USDC    | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | USD        |
| USDT    | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | USD        |

*(Additional chains: Base, Optimism, Polygon, BSC)*

## Future Enhancements

1. **Advanced Hedge Eligibility**: Support for volatile/volatile pairs (ETH/BTC delta-neutral strategies)
2. **Dynamic Registry**: Load token mappings from database or external API
3. **Multi-Protocol Resolution**: Return all compatible protocols for a risk view
4. **Risk Metrics**: Calculate Greeks (delta, gamma) based on position and risk view
5. **Options Support**: Extend eligibility classification for options-based hedging
