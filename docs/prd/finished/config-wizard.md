# PRD: Database-Backed Configuration Wizard

**Author:** Ned Albo (Midcurve Finance)
**Status:** Implemented
**Created:** 2026-03-12
**Last Updated:** 2026-03-12

---

## 1. Overview

First-time setup wizard for self-hosted Midcurve deployments. Configuration is stored in a database `settings` table (key/value pattern) rather than environment variables. The wizard is integrated into the existing UI as a setup flow that appears when the app detects it is unconfigured.

Infrastructure secrets (database password, RabbitMQ credentials, signer keys) remain as environment variables managed by the deployment platform (Railway, Docker Compose). The wizard handles only user-provided application configuration: API keys, wallet addresses, and feature settings.

---

## 2. Problem Statement

Deploying Midcurve requires configuring ~10 environment variables across multiple services. Users must manually generate secrets, look up API key formats, and ensure consistency across services. This friction delays onboarding and is error-prone.

**Goals:**
- Reduce required manual configuration to 4 inputs (3 API keys + 1 wallet address)
- Auto-generate all infrastructure secrets at deployment time
- Store user config centrally (database) so all services read from one source
- Guide users through setup with clear instructions and validation
- Allow reconfiguration without redeployment

---

## 3. Architecture

### 3.1 Config Source Split

| Source | Variables | Managed By |
|--------|-----------|------------|
| Environment vars | `DATABASE_URL`, `RABBITMQ_PASS`, `SIGNER_INTERNAL_API_KEY`, `SIGNER_LOCAL_ENCRYPTION_KEY`, `CONFIG_PASSWORD`, `VITE_API_URL`, `ALLOWED_ORIGINS` | Railway auto-generate / template vars |
| DB `settings` table | `alchemy_api_key`, `the_graph_api_key`, `walletconnect_project_id`, `admin_wallet_address`, `coingecko_api_key` | Config wizard (user input) |
| Hardcoded defaults | Subgraph IDs, worker tuning, `EXECUTION_FEE_BPS=50`, `EXECUTION_FEE_RECIPIENT=0x0...0` | Code / docker-compose |

### 3.2 Database Schema

New Prisma model:

```prisma
model Setting {
  key       String   @id
  value     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("settings")
}
```

Additionally, the `User` model is amended with an `isAdmin` field:

```prisma
model User {
  // ... existing fields ...
  isAdmin Boolean @default(false) @map("is_admin")
}
```

When the wizard saves the admin wallet address, the POST handler:
1. Upserts the allowlist entry (existing behavior)
2. Sets `isAdmin: true` on the corresponding user record (created on first sign-in, or upserted here)

### 3.3 Service Startup Flow

All backend services (onchain-data, automation, business-logic) follow this startup pattern:

```
1. Connect to database (DATABASE_URL from env var — always available)
2. Query settings for required keys
3. If keys missing → poll every 30s until all keys present
4. Once all keys present → derive config (e.g., RPC URLs from Alchemy key)
5. Initialize service (start workers, connect to RabbitMQ, etc.)
```

A singleton `AppConfig` module in `@midcurve/services` implements this:

```typescript
// packages/midcurve-services/src/config/app-config.ts

interface AppConfig {
  // Stored in DB (user-provided)
  alchemyApiKey: string;
  theGraphApiKey: string;
  coingeckoApiKey: string | null;

  // Derived from alchemyApiKey
  rpcUrlEthereum: string;
  rpcUrlArbitrum: string;
  rpcUrlBase: string;
}

let _config: AppConfig | null = null;

export async function initAppConfig(requiredKeys: string[]): Promise<void> {
  const settings = await awaitSettings(requiredKeys); // polls DB until all keys present
  _config = buildConfig(settings); // derives RPC URLs, etc.
}

export function getAppConfig(): AppConfig {
  if (!_config) throw new Error('AppConfig not initialized — call initAppConfig() first');
  return _config;
}
```

Services call `initAppConfig()` at startup (blocks until config is available), then use `getAppConfig()` throughout. Existing code that reads `process.env.RPC_URL_*` (e.g., `EvmConfig`) is refactored to read from `getAppConfig()` instead.

### 3.4 API Behavior

The API starts as soon as `DATABASE_URL` is available (Railway provides this).

**Config endpoints (unauthenticated):**

- `GET /api/config` — Returns public config + configured status
  - Unconfigured: `{ configured: false }`
  - Configured: `{ configured: true, walletconnectProjectId: "..." }`
  - Sensitive keys (Alchemy, The Graph, CoinGecko) are NEVER returned

- `POST /api/config` — Saves wizard config to database
  - Requires `X-Config-Password` header matching `CONFIG_PASSWORD` env var
  - Validates all inputs (address format, non-empty required fields)
  - Upserts all settings in a single transaction
  - Seeds admin allowlist entry (upsert into `user_allow_list_entries`)
  - Sets `isAdmin: true` on the admin user record
  - Returns `{ success: true }`

**All other API routes:**
- Return `503 Service Unavailable` with `{ error: "not_configured" }` when config is missing
- Normal behavior once configured

**Health check:**
- Always returns 200 (prevents Railway from restarting the container)

### 3.5 UI Integration

**MidcurveConfigProvider** (React context):
- Fetches `GET /api/config` on mount
- If `configured: false` → sets unconfigured state
- If `configured: true` → provides config (walletconnectProjectId) to children via context

**Error boundary / routing:**
- When unconfigured, the app renders the wizard page instead of the normal app
- The wizard page does NOT require wallet connection (RainbowKit is not initialized yet)
- After successful config POST → refetch config → app renders normally with RainbowKit

**RainbowKit deferred initialization:**
- RainbowKit/wagmi providers wrap only the authenticated app routes, NOT the wizard
- The `walletconnectProjectId` is read from config context, not from `import.meta.env`
- Provider tree: `ConfigProvider > (wizard | (RainbowKitProvider > AuthProvider > App))`

---

## 4. Wizard UI

### 4.1 Steps

Single-page form with 4 sections:

**Section 1: Setup Password**
| Field | Required | Notes |
|-------|----------|-------|
| Config Password | Yes | Must match `CONFIG_PASSWORD` env var. Shown in Railway dashboard. |

**Section 2: Required API Keys**
| Field | Required | Notes |
|-------|----------|-------|
| Alchemy API Key | Yes | Link to https://dashboard.alchemy.com |
| The Graph API Key | Yes | Link to https://thegraph.com/studio |
| WalletConnect Project ID | Yes | Link to https://cloud.walletconnect.com |

**Section 3: Admin Access**
| Field | Required | Notes |
|-------|----------|-------|
| Admin Wallet Address | Yes | EIP-55 validated. First user who can sign in. |

**Section 4: Optional Settings** (collapsed by default)
| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| CoinGecko API Key | No | *(empty)* | Free tier works without key |

### 4.2 Validation

- **Alchemy API Key**: Non-empty string
- **The Graph API Key**: Non-empty string
- **WalletConnect Project ID**: Non-empty string
- **Admin Wallet Address**: Must match `^0x[a-fA-F0-9]{40}$`, normalized to EIP-55 checksum on save
- **Config Password**: Validated server-side against `CONFIG_PASSWORD` env var
- **CoinGecko API Key**: Optional, string if provided

### 4.3 Post-Submit Behavior

On successful save:
1. Show success message: "Configuration saved. Services are starting..."
2. Poll `GET /api/config` until `configured: true`
3. Redirect to the main app (which now shows the "Connect Wallet" screen)

---

## 5. Derived Configuration

The Alchemy API key is stored once. Services derive RPC URLs at read time:

| Derived Variable | Template |
|---|---|
| `RPC_URL_ETHEREUM` | `https://eth-mainnet.g.alchemy.com/v2/{alchemy_api_key}` |
| `RPC_URL_ARBITRUM` | `https://arb-mainnet.g.alchemy.com/v2/{alchemy_api_key}` |
| `RPC_URL_BASE` | `https://base-mainnet.g.alchemy.com/v2/{alchemy_api_key}` |

---

## 6. Railway Deployment Configuration

### 6.1 Auto-Generated Variables (Railway generates these)

| Variable | Generation Method |
|---|---|
| `POSTGRES_PASSWORD` | Railway auto-generate |
| `RABBITMQ_PASS` | Railway auto-generate |
| `SIGNER_INTERNAL_API_KEY` | Railway auto-generate |
| `SIGNER_LOCAL_ENCRYPTION_KEY` | Railway auto-generate |
| `CONFIG_PASSWORD` | Railway auto-generate (one-time setup token) |

### 6.2 Template Variables (Railway resolves these)

| Variable | Template |
|---|---|
| `VITE_API_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` |
| `ALLOWED_ORIGINS` | `https://${{ui.RAILWAY_PUBLIC_DOMAIN}}` |

### 6.3 Hardcoded Defaults (in docker-compose)

| Variable | Value |
|---|---|
| `POSTGRES_USER` | `midcurve` |
| `POSTGRES_DB` | `midcurve` |
| `RABBITMQ_USER` | `midcurve` |
| `SIGNER_USE_LOCAL_KEYS` | `true` |
| `LOG_LEVEL` | `info` |
| `EXECUTION_FEE_BPS` | `50` |
| `EXECUTION_FEE_RECIPIENT` | `0x0000000000000000000000000000000000000000` |
| `UNISWAP_V3_SUBGRAPH_ID_*` | Hardcoded current values |

---

## 7. User Flow

```
1. User deploys Midcurve template on Railway
2. Railway auto-generates infrastructure secrets
3. All containers start. Backend services poll DB for config.
4. User opens the app URL in browser
5. UI fetches GET /api/config → { configured: false }
6. UI renders config wizard
7. User copies CONFIG_PASSWORD from Railway dashboard
8. User enters password + API keys + wallet address
9. UI POSTs to /api/config with password header
10. API validates, saves to settings, seeds allowlist
11. UI polls config → { configured: true, walletconnectProjectId: "..." }
12. UI initializes RainbowKit and renders the app
13. Backend services detect config on next poll cycle (≤30s), start normally
```

---

## 8. Security Considerations

- **CONFIG_PASSWORD** gates all writes to the settings table. Without it, the wizard POST is rejected.
- **Sensitive keys** (Alchemy, The Graph, CoinGecko) are NEVER returned by the public GET endpoint.
- **Admin wallet address** is checksummed server-side (EIP-55) to prevent malformed entries.
- The config endpoint should be rate-limited to prevent brute-force attacks on CONFIG_PASSWORD.

---

## 9. Non-Railway Deployments (docker-compose)

For users running `docker-compose.railway.yml` without Railway:
- Infrastructure secrets must be set manually in a `.env` file (POSTGRES_PASSWORD, RABBITMQ_PASS, etc.)
- CONFIG_PASSWORD must also be set manually in `.env`
- The wizard flow is identical once services are running
- A `.env.railway.example` documents exactly which vars to set

---

## 10. Impact on Existing Code

| Area | Change |
|---|---|
| Prisma schema | Add `Setting` model, add `isAdmin` to `User` model + migration |
| `@midcurve/services` | Add `SettingService` (CRUD) + `AppConfig` singleton (`initAppConfig()` / `getAppConfig()`) |
| API (`/api/config`) | New route handlers (GET/POST) |
| API (all other routes) | Middleware returning 503 when unconfigured |
| UI provider tree | Add `MidcurveConfigProvider`, defer RainbowKit |
| UI routing | Add wizard page, error boundary for unconfigured state |
| Backend services (4) | Call `initAppConfig()` at startup, use `getAppConfig()` for derived values |
| `EvmConfig` | Refactor to read RPC URLs from `getAppConfig()` instead of `process.env` |
| `TheGraphClient` | Refactor to read API key from `getAppConfig()` instead of `process.env` |
| `CoinGeckoClient` | Refactor to read API key from `getAppConfig()` instead of `process.env` |
| `entrypoint.sh` | Allowlist seeding moves to POST /api/config handler (remove from entrypoint) |
| `docker-compose.railway.yml` | Add CONFIG_PASSWORD, remove ADMIN_WALLET_ADDRESS from api env |

---

## 11. Reconfiguration

Users can reconfigure by visiting the wizard URL directly (e.g., `/setup`). The wizard pre-fills existing values (redacted for sensitive fields). After saving:
- New values are written to `settings`
- Backend services pick up changes on the next poll cycle (≤30s)
- No redeployment needed

---

## 12. Summary

| Metric | Value |
|---|---|
| Required user inputs | **4** (Alchemy key, Graph key, WC project ID, admin wallet) |
| Optional user inputs | **1** (CoinGecko key) |
| Auto-generated secrets | **5** (Postgres pw, RabbitMQ pw, signer key, encryption key, config pw) |
| Platform-resolved vars | **2** (API URL, CORS origins) |
| New DB table | `settings` (key/value), `isAdmin` field on `users` |
| New API endpoints | `GET /api/config`, `POST /api/config` |
| New UI pages | Setup wizard (`/setup`) |

---

## 13. Implementation Summary

The config wizard was implemented across prior work. A follow-up added the admin Settings page (Section 11 — reconfiguration without redeployment) with allowlist management:

- **`91e1642`** — `feat: expose isAdmin flag in session and auth types`
  Added `isAdmin: boolean` to `SessionUser` and `AuthenticatedUser` interfaces in `@midcurve/api-shared`. Plumbed through auth middleware, session validation, and SIWE verify endpoints so the frontend can conditionally render admin-only UI.

- **`f2db262`** — `feat: add admin settings page with API key management and allowlist`
  New `GET/PATCH /api/v1/admin/settings` endpoint (session-authenticated, admin-only) that returns masked API keys and the full allowlist, and accepts partial updates. Admin addresses are never removed from the allowlist. New `SettingsPage` component matching the existing page layout (Notifications/Autowallet pattern). Admin-only "Settings" link in the user dropdown. Route at `/settings`.
