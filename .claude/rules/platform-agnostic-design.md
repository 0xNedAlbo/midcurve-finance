# .claude/rules/platform-agnostic-design.md

## Multi-Platform Architecture

This project supports multiple DeFi platforms (UniswapV3 today, Orca/Aerodrome/Solana/SUI future).
All core types are platform-agnostic with platform-specific data in typed config/state fields.

### Type Structure

- Every Pool, Position, Token, Transaction has a `type` discriminator field
  (e.g. "uniswapv3", "erc20", "evm")
- `config`: immutable platform-specific data (flat Record, no nesting)
- `state`: mutable platform-specific data (flat Record, no nesting)
- Database: config and state are JSON columns
- TypeScript: typed as Record<string, unknown> at the base, narrowed by discriminator
- Never add protocol-specific fields to the base type — they go in config or state

### Identity

- Database primary key: CUID (`id` field)
- Human-readable identity: `{type}Hash` field using slash-separated format
    - Positions: "uniswapv3/{chainId}/{nftId}"
    - Tokens: "erc20/{chainId}/{address}"
    - Pools: "uniswapv3/{chainId}/{poolAddress}"

### File & Naming Conventions

- All platform-specific code must reflect its platform in path and name
- ✅ workers/uniswapv3/uniswapv3-range-monitor.ts
- ✅ services/uniswapv3/uniswapv3-position-service.ts
- ❌ workers/range-monitor.ts
- ❌ services/position-service.ts (if it's platform-specific)
- Platform-agnostic code lives at the parent level without a platform prefix

### Adding a New Platform

- Add new discriminator value (e.g. "orca")
- Define config/state types for the new platform
- Create platform-specific directory and files
- Never modify existing platform implementations to accommodate the new one
