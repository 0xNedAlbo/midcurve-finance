# Midcurve Signer API

## Overview

The Midcurve Signer API is a **private, internal-only signing service** that provides EVM transaction signatures for automated DeFi operations. It runs in an isolated subnet and is only accessible by the midcurve-ui service layer.

**Key Responsibilities:**
- Generate and manage automation wallets (1 per user)
- Verify strategy intents signed by users
- Build and sign EVM transactions for DeFi operations
- Return signed transactions for the caller to broadcast

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PUBLIC INTERNET                          │
│                           │                                  │
│              ┌────────────▼────────────┐                    │
│              │    midcurve-ui          │                    │
│              │  - User authentication  │                    │
│              │  - Intent creation      │                    │
│              │  - TX broadcast         │                    │
│              └────────────┬────────────┘                    │
│                           │ Internal API Call                │
│              PRIVATE SUBNET (Security Groups)                │
│              ┌────────────▼────────────┐                    │
│              │   midcurve-signer       │  ← This service    │
│              │  - Intent verification  │                    │
│              │  - TX building          │                    │
│              │  - TX signing           │                    │
│              └────────────┬────────────┘                    │
│                           │                                  │
│              ┌────────────▼────────────┐                    │
│              │       AWS KMS           │                    │
│              │  - Key generation       │                    │
│              │  - Signing (HSM)        │                    │
│              └─────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Strategy Intent

An **intent** is a strategy-level authorization that the user signs ONCE when establishing an automation strategy. It is NOT per-transaction.

**Examples:**
- "Close position NFT #12345 on Arbitrum when price drops below 2000 USDC/WETH"
- "Keep position NFT #12345 hedged with a Hyperliquid short matching ETH exposure"

The intent document is sent with ALL subsequent signing requests and verified for compliance.

### Key Management

**Production (AWS KMS):**
- Private key NEVER leaves the HSM
- KMS generates key, returns only KeyId + wallet address
- All signing happens within KMS

**Development (Local):**
- Uses AES-256-GCM encrypted keys
- Same interface, different backend
- Set `SIGNER_USE_LOCAL_KEYS=true`

### checkIntent()

Every signing endpoint calls `checkIntent()` to verify:
1. Intent signature is valid (EIP-712)
2. Intent is not expired
3. Operation is allowed by intent boundaries

## API Endpoints

### Health
- `GET /api/health` - Health check

### Wallet Management
- `POST /api/wallets` - Create automation wallet via KMS
- `GET /api/wallets/:address` - Get wallet details

### Signing (require intent verification)
- `POST /api/sign/test-evm-wallet` - Test signing infrastructure
- `POST /api/sign/erc20/approve` - Sign ERC-20 approve
- `POST /api/sign/erc20/transfer` - Sign ERC-20 transfer
- `POST /api/sign/uniswapv3/open-position` - Sign Uniswap V3 mint
- `POST /api/sign/uniswapv3/close-position` - Sign Uniswap V3 burn
- `POST /api/sign/uniswapv3/increase-liquidity` - Sign increase liquidity
- `POST /api/sign/uniswapv3/decrease-liquidity` - Sign decrease liquidity
- `POST /api/sign/uniswapv3/collect-fees` - Sign collect fees

## Authentication

All endpoints require internal API key authentication via `X-Internal-API-Key` header.

```typescript
// Example request
const response = await fetch('http://signer-api/api/sign/test-evm-wallet', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-API-Key': process.env.SIGNER_INTERNAL_API_KEY,
  },
  body: JSON.stringify({
    intent: { /* StrategyIntent */ },
    operation: 'test-evm-wallet',
    params: { message: 'Hello, World!' },
    userId: 'user-id',
  }),
});
```

## Directory Structure

```
src/
├── app/
│   ├── api/
│   │   ├── health/route.ts
│   │   ├── wallets/
│   │   │   ├── route.ts
│   │   │   └── [walletAddress]/route.ts
│   │   └── sign/
│   │       ├── test-evm-wallet/route.ts
│   │       ├── uniswapv3/*.ts
│   │       └── erc20/*.ts
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── intent/
│   │   ├── verify.ts         # EIP-712 verification
│   │   ├── check-intent.ts   # Intent compliance checking
│   │   └── eip712.ts         # Typed data definitions
│   ├── kms/
│   │   ├── kms-signer.ts     # AWS KMS signing
│   │   ├── local-signer.ts   # Local dev fallback
│   │   └── index.ts
│   ├── logger.ts
│   └── prisma.ts
├── middleware/
│   ├── with-internal-auth.ts
│   └── with-intent-verification.ts
└── services/
    ├── wallet-service.ts
    └── tx-builder/
        ├── base-tx-builder.ts
        ├── uniswapv3/*.ts
        └── erc20/*.ts
```

## Environment Variables

```bash
# Required
DATABASE_URL="postgresql://..."
SIGNER_INTERNAL_API_KEY="shared-secret"

# Key Provider (choose one)
SIGNER_USE_LOCAL_KEYS="true"                    # Development
AUTOMATION_WALLET_ENCRYPTION_KEY="64-hex-chars" # Development

AWS_REGION="us-east-1"                          # Production
AWS_KMS_KEY_ARN="arn:aws:kms:..."               # Production

# EVM RPCs
RPC_URL_ETHEREUM="..."
RPC_URL_ARBITRUM="..."
# etc.
```

## Development

```bash
# Start dev server (port 3001)
pnpm dev

# With pretty logging
pnpm dev:pretty

# Type check
pnpm typecheck

# Run tests
pnpm test
```

## Security Considerations

1. **No Public Access** - API lives in private subnet
2. **Internal Auth** - All requests require valid API key
3. **Intent Verification** - Every signing request verified against user's signed intent
4. **Key Security** - Private keys never leave KMS HSM in production
5. **Audit Logging** - All signing operations logged for forensics

## Related Packages

- `@midcurve/database` - Prisma schema and client
- `@midcurve/services` - Business logic and existing signing infrastructure
- `@midcurve/api-shared` - API types and validation schemas
- `@midcurve/shared` - Core types and utilities
