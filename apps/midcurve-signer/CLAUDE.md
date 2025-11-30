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

### Strategy Intent (StrategyIntentV1)

A **StrategyIntentV1** is a platform-agnostic authorization document that the user signs ONCE when establishing an automation strategy. It is NOT per-transaction—it grants permission for a class of operations.

**Structure:**
```typescript
interface StrategyIntentV1 {
  id: string;                        // Unique identifier (UUID)
  name?: string;                     // Human-readable name
  description?: string;              // Description of what this intent allows
  allowedCurrencies: AllowedCurrency[];  // Tokens the strategy can use
  allowedEffects: AllowedEffect[];       // Contract calls the strategy can make
  strategy: StrategyEnvelope;            // Strategy-specific configuration
}

// Discriminated union for allowed currencies
type AllowedCurrency =
  | { currencyType: 'erc20'; chainId: number; address: string; symbol: string; }
  | { currencyType: 'evmNative'; chainId: number; symbol: string; };

// Discriminated union for allowed effects (contract calls)
type AllowedEffect = {
  effectType: 'evmContractCall';
  chainId: number;
  contractAddress: string;
  functionSelectors: string[];  // 4-byte function selectors (0x...)
};

// Strategy envelope with type-specific config
interface StrategyEnvelope {
  strategyType: 'basicUniswapV3';  // Extensible via registry
  config: BasicUniswapV3StrategyConfig;
}
```

**EIP-712 Signing:**

The intent is signed using EIP-712 typed data. Nested structures (`allowedCurrencies`, `allowedEffects`, `strategy`) are JSON-stringified and keccak256-hashed as `bytes32` fields:

```typescript
const StrategyIntentV1Types = {
  StrategyIntentV1: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'allowedCurrenciesHash', type: 'bytes32' },
    { name: 'allowedEffectsHash', type: 'bytes32' },
    { name: 'strategyHash', type: 'bytes32' },
  ],
};
```

**Signed Intent:**
```typescript
interface SignedStrategyIntentV1 {
  intent: StrategyIntentV1;
  signature: Hex;      // EIP-712 signature
  signer: Address;     // Address that signed (user's wallet)
}
```

**Examples:**
- "Allow WETH and USDC operations on Arbitrum for BasicUniswapV3 strategy on pool 0x..."
- "Permit calls to Uniswap NonfungiblePositionManager for mint, burn, collect functions"

The signed intent is sent with ALL subsequent signing requests and verified for signature validity.

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
1. Intent schema is valid (Zod validation via `SignedStrategyIntentV1Schema`)
2. EIP-712 signature is valid (recovered signer matches claimed signer)
3. User has an automation wallet

**Note:** Intent compliance checking (verifying that an operation is within intent boundaries) is NOT YET IMPLEMENTED. Currently, the signer only verifies that the intent signature is valid.

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
│   │   ├── intent-verifier.ts  # EIP-712 signature verification
│   │   ├── check-intent.ts     # Intent + wallet verification
│   │   └── eip712-types.ts     # EIP-712 domain and type definitions
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
