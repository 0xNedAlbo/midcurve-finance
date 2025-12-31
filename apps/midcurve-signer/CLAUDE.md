# Midcurve Signer API

## Overview

The Midcurve Signer API is a **private, internal-only signing service** that provides EVM transaction signatures for automated DeFi operations. It runs in an isolated subnet and is only accessible by the midcurve-ui service layer.

**Key Responsibilities:**
- Generate and manage automation wallets (1 per user)
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
│              │  - TX broadcast         │                    │
│              └────────────┬────────────┘                    │
│                           │ Internal API Call                │
│              PRIVATE SUBNET (Security Groups)                │
│              ┌────────────▼────────────┐                    │
│              │   midcurve-signer       │  ← This service    │
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

### Key Management

**Production (AWS KMS):**
- Private key NEVER leaves the HSM
- KMS generates key, returns only KeyId + wallet address
- All signing happens within KMS

**Development (Local):**
- Uses AES-256-GCM encrypted keys
- Same interface, different backend
- Set `SIGNER_USE_LOCAL_KEYS=true`

### Automation Wallets

Each user can have ONE automation wallet:
- Created via `POST /api/wallets`
- Wallet address derived from KMS key
- Stored in database with reference to KMS key ID

## API Endpoints

### Health
- `GET /api/health` - Health check

### Wallet Management
- `POST /api/wallets` - Create automation wallet via KMS
- `GET /api/wallets/:userId` - Get wallet details by user ID

### Signing
- `POST /api/sign/erc20/approve` - Sign ERC-20 approve transaction

## Authentication

All endpoints require internal API key authentication via `Authorization: Bearer <key>` header.

```typescript
// Example request
const response = await fetch('http://signer-api/api/sign/erc20/approve', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.SIGNER_INTERNAL_API_KEY}`,
  },
  body: JSON.stringify({
    userId: 'user-id',
    chainId: 42161,
    tokenAddress: '0x...',
    spenderAddress: '0x...',
    amount: '1000000000000000000',
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
│   │   │   └── [userId]/route.ts
│   │   └── sign/
│   │       └── erc20/
│   │           └── approve/route.ts
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── kms/
│   │   ├── aws-kms-signer.ts   # AWS KMS signing
│   │   ├── local-dev-signer.ts # Local dev fallback
│   │   ├── types.ts            # Signer interfaces
│   │   └── index.ts
│   ├── logger.ts
│   └── prisma.ts
├── middleware/
│   └── internal-auth.ts
└── services/
    └── wallet-service.ts
```

## Environment Variables

```bash
# Required
DATABASE_URL="postgresql://..."
SIGNER_INTERNAL_API_KEY="shared-secret"

# Key Provider (choose one)
SIGNER_USE_LOCAL_KEYS="true"                    # Development
SIGNER_LOCAL_ENCRYPTION_KEY="64-hex-chars"      # Development

AWS_REGION="us-east-1"                          # Production
AWS_KMS_KEY_ARN="arn:aws:kms:..."               # Production
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
3. **Key Security** - Private keys never leave KMS HSM in production
4. **Audit Logging** - All signing operations logged for forensics

## Related Packages

- `@midcurve/database` - Prisma schema and client
- `@midcurve/services` - Business logic
- `@midcurve/api-shared` - API types and validation schemas
- `@midcurve/shared` - Core types and utilities
