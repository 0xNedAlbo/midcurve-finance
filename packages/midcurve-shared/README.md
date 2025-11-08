# @midcurve/shared

Shared types and utilities for **Midcurve Finance** - a comprehensive risk management platform for concentrated liquidity (CL) provisioning across multiple blockchain ecosystems.

## Overview

This package provides the foundational types and utility functions used across all Midcurve Finance projects:
- **API** (Next.js on Vercel)
- **UI/Frontend** (React/Next.js)
- **Workers** (Background processors)
- **Services** (Business logic layer)

## Installation

```bash
npm install @midcurve/shared
```

## Features

### TypeScript Types

Protocol-agnostic type definitions for:
- **Tokens** (`Token`, `Erc20Token`, `Erc20TokenConfig`)
- **Pools** (`Pool`, `UniswapV3Pool`, `UniswapV3PoolConfig`, `UniswapV3PoolState`)
- **Positions** (`Position`, `UniswapV3Position`, `UniswapV3PositionConfig`, `UniswapV3PositionState`)
- **Pool Prices** (`PoolPrice`, `UniswapV3PoolPrice`)
- **Position Ledger Events** (`PositionLedgerEvent`, `UniswapV3LedgerEvent`)
- **Users** (`User`)

### Utility Functions

- **Math Utilities** - Core mathematical operations for DeFi calculations
- **UniswapV3 Utilities** - Specialized calculations for Uniswap V3:
  - Price conversions (sqrtPriceX96 ↔ decimal price)
  - Liquidity calculations
  - Fee calculations
  - Position value calculations

## Usage

### Importing Types

```typescript
import {
  Token,
  Erc20Token,
  Pool,
  UniswapV3Pool,
  Position,
  UniswapV3Position,
  PoolPrice,
  PositionLedgerEvent,
} from '@midcurve/shared';

// Use types in your application
const token: Erc20Token = {
  id: 'token_001',
  tokenType: 'evm-erc20',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  config: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};
```

### Importing Utilities

```typescript
import { sqrtPriceX96ToPrice, priceToSqrtPriceX96 } from '@midcurve/shared/utils';

// Convert sqrtPriceX96 to decimal price
const sqrtPrice = 1234567890123456789n;
const decimals0 = 6;
const decimals1 = 18;
const price = sqrtPriceX96ToPrice(sqrtPrice, decimals0, decimals1);

// Convert decimal price to sqrtPriceX96
const targetPrice = 2500.5;
const sqrtPriceX96 = priceToSqrtPriceX96(targetPrice, decimals0, decimals1);
```

## Type System Architecture

### Discriminated Unions

The package uses TypeScript's discriminated unions for type safety:

```typescript
import { AnyToken } from '@midcurve/shared';

function processToken(token: AnyToken) {
  if (token.tokenType === 'evm-erc20') {
    // TypeScript knows token.config is Erc20TokenConfig
    console.log(`ERC-20 on chain ${token.config.chainId}`);
  }
}
```

### Generic Interfaces

Types are designed with generics for maximum flexibility:

```typescript
interface Token<TConfig> {
  id: string;
  tokenType: TokenType;
  name: string;
  symbol: string;
  decimals: number;
  config: TConfig;  // Platform-specific config
  createdAt: Date;
  updatedAt: Date;
}

// Platform-specific type alias
type Erc20Token = Token<Erc20TokenConfig>;
```

## Supported Protocols

- **Uniswap V3** (Ethereum, Arbitrum, Base, Polygon, Optimism)
- Future: Orca (Solana), Raydium (Solana), PancakeSwap V3 (BSC)

## Development

### Building

```bash
npm install
npm run build
```

### Testing

```bash
npm test              # Watch mode
npm run test:run      # Single run
npm run test:coverage # With coverage
```

### Type Checking

```bash
npm run type-check
```

## License

MIT License - see [LICENSE](./LICENSE) for details

## Contributing

This package is part of the Midcurve Finance monorepo. For contribution guidelines, please refer to the main repository documentation.

## Links

- [Midcurve Finance](https://midcurve.finance)
- [Documentation](https://docs.midcurve.finance)
- [GitHub](https://github.com/midcurve-finance)
