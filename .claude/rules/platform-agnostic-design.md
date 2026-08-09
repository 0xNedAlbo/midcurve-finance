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
    - Positions (NFT): "uniswapv3/{chainId}/{nftId}"
    - Positions (vault): "uniswapv3-vault/{chainId}/{vaultAddress}/{ownerAddress}", both
      addresses EIP-55 checksummed — a vault is an ERC-20, so the holder is part of the
      identity. Build it with `UniswapV3VaultPosition.createHash()`, never by hand.
    - Tokens: "erc20/{chainId}/{address}"
    - Pools: "uniswapv3/{chainId}/{poolAddress}"

### On-Chain Event → Position Resolution Assumes One Tracker

An on-chain event carries no user. Resolving an event to a Position therefore matches on
chain-level identity only — (chainId, nftId) for NFT positions, (chainId, vaultAddress,
ownerAddress) for vault positions — and cannot scope by userId.

Position is unique on `@@unique([userId, positionHash, ownerWallet])`, so two users tracking
one wallet produce two position rows for one on-chain identity. CloseOrder.positionId is a
single FK and CloseOrder.orderIdentityHash is globally `@unique`, so the close-order table
holds exactly one row per on-chain identity. "This order belongs to both positions" is not a
representable state.

**The precondition: at most one user tracks any given on-chain position.** It is load-bearing
for every event → position lookup, not only close orders. Note that the Position layer
deliberately permits what this precondition forbids — the two disagree, and the close-order
side is the one that is load-bearing.

Two lookups, two failure modes under the same precondition, deliberately not unified —
both in `UniswapV3ProcessCloseOrderEventsRule.findPositionForEvent()`:

- Vault: throws `UnroutableCloseOrderEventError` on more than one match. Every close-order
  event for that vault dead-letters permanently and re-dead-letters on each catch-up replay.
- NFT: takes the first match silently. Arbitrary attribution rather than none — worse in
  kind, but it only fires under the same precondition. Pre-existing, left as is.

Lifting the precondition is a data-model change, not a lookup change: a close order would
have to fan out per position, or hang off the wallet rather than the position.
Trailhead: issue #83.

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
