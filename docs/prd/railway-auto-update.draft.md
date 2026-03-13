# PRD: Railway Auto-Update Feature

## Overview

Self-hosted Midcurve instances on Railway should be updatable with a single click directly from the UI — no CLI, no manual redeploy in the Railway dashboard required. The system detects when a newer version is available and offers a one-click "Update Now" action.

---

## Goals

- Zero-friction updates for non-technical self-hosters
- No external tooling required (no Railway CLI, no GitHub Actions knowledge)
- Version awareness: UI shows current version and whether an update is available
- Single Railway API Token as the only manual user setup step

---

## Non-Goals

- Automatic/scheduled updates without user consent
- Rollback functionality (v1)
- Update changelog display (v1)
- Support for non-Railway deployments (Coolify etc.) in this iteration

---

## Architecture

### Environment Variables (API service)

Railway injects the following reference variables automatically — no manual input required from the user except `RAILWAY_API_TOKEN`:

```env
# Manually provided by user (once, via Midcurve Settings UI)
RAILWAY_API_TOKEN=<user-generated Railway token>

# Auto-resolved via Railway Reference Variables
RAILWAY_PROJECT_ID=${{RAILWAY_PROJECT_ID}}
RAILWAY_ENVIRONMENT_ID=${{RAILWAY_ENVIRONMENT_ID}}
SIGNER_SERVICE_ID=${{signer.RAILWAY_SERVICE_ID}}
ONCHAIN_DATA_SERVICE_ID=${{onchain-data.RAILWAY_SERVICE_ID}}
AUTOMATION_SERVICE_ID=${{automation.RAILWAY_SERVICE_ID}}
BUSINESS_LOGIC_SERVICE_ID=${{business-logic.RAILWAY_SERVICE_ID}}
API_SERVICE_ID=${{api.RAILWAY_SERVICE_ID}}
UI_SERVICE_ID=${{ui.RAILWAY_SERVICE_ID}}
```

All service IDs and project/environment IDs are available at runtime with zero user configuration beyond the API token.

---

### Version Detection

**Current version** is embedded at build time as an environment variable:

```env
APP_VERSION=sha-<git-short-sha>   # injected by GitHub Actions
```

GitHub Actions workflow adds to the build step:
```yaml
- name: Set version
  run: echo "APP_VERSION=sha-$(git rev-parse --short HEAD)" >> $GITHUB_ENV
```

**Latest version** is fetched from GHCR via the container registry API:

```
GET https://ghcr.io/v2/0xnedalbo/midcurve-api/manifests/latest
Authorization: Bearer <anonymous token>
```

The `Docker-Content-Digest` header or the `org.opencontainers.image.revision` label in the manifest contains the latest SHA.

Alternatively, use the GitHub API (no auth needed for public repos):
```
GET https://api.github.com/repos/0xNedAlbo/midcurve-finance/commits/main
```
Returns `sha` of the latest commit on `main`.

**Update available** = `latestSha !== APP_VERSION`

---

### API Endpoints

#### `GET /api/version`

Returns current and latest version info. No auth required (public endpoint).

**Response:**
```json
{
  "currentVersion": "sha-a1b2c3d",
  "latestVersion": "sha-e4f5g6h",
  "updateAvailable": true
}
```

Caches the GitHub API response for 60 minutes to avoid rate limiting.

---

#### `POST /api/admin/update`

Triggers redeployment of all services via Railway GraphQL API. Requires `CONFIG_PASSWORD` in the `Authorization` header (reuses existing admin auth).

**Request:**
```http
POST /api/admin/update
Authorization: Bearer <CONFIG_PASSWORD>
```

**Behavior:**
1. Validates `RAILWAY_API_TOKEN` is configured — returns `503` if missing
2. Calls Railway GraphQL API to trigger `serviceInstanceRedeploy` for each service ID
3. Services redeploy in this order: `signer` → `onchain-data` → `automation` → `business-logic` → `api` → `ui`
4. Note: API will restart mid-process — this is expected and acceptable
5. Returns `202 Accepted` immediately (does not wait for completion)

**Railway GraphQL mutation:**
```graphql
mutation RedployService($serviceId: String!, $environmentId: String!) {
  serviceInstanceRedeploy(
    serviceId: $serviceId
    environmentId: $environmentId
  )
}
```

**Endpoint:** `https://backboard.railway.app/graphql/v2`
**Auth header:** `Authorization: Bearer <RAILWAY_API_TOKEN>`

**Error responses:**
- `503` — `RAILWAY_API_TOKEN` not configured
- `401` — invalid `CONFIG_PASSWORD`
- `502` — Railway API call failed (includes error detail)

---

### Settings: Railway API Token

A new field is added to the existing config wizard and settings page:

**Label:** Railway API Token
**Description:** Required for one-click updates. Generate at railway.com → Account Settings → Tokens.
**Required:** No (updates simply unavailable without it)
**Stored:** In the `Setting` table like all other config values (key: `railwayApiToken`)
**Displayed:** Masked, with a "Reveal" toggle

If not configured, `GET /api/version` still works (shows versions) but `POST /api/admin/update` returns `503`.

---

### UI: Update Notification

A persistent notification bar appears at the top of the app when `updateAvailable === true`.

**Component:** `<UpdateNotification />`
**Location:** Rendered inside the root layout, above the main content
**Visibility:** Admin-only (only shown when user has `isAdmin === true`)

**Design:**
```
┌─────────────────────────────────────────────────────────────┐
│  🔄  A new version of Midcurve is available.   [Update Now] │
└─────────────────────────────────────────────────────────────┘
```

**Update Now button behavior:**
1. Calls `POST /api/admin/update`
2. Shows loading spinner + "Updating... This will take a few minutes."
3. After `202` received: "Update started. The app will restart shortly. Please refresh in 2–3 minutes."
4. If `RAILWAY_API_TOKEN` not configured (`503`): Shows inline prompt "Add your Railway API Token in Settings to enable updates."

**Polling:** `GET /api/version` is called once on app load and cached in the ConfigContext. No continuous polling.

---

## Deployment Consistency

All services — including the UI — must be updated atomically to avoid version skew between frontend and backend.

**Railway UI Service: Auto-Deploy must be disabled.**

By default Railway re-deploys the UI service on every push to `main` (since it builds from the Git repo). This would cause the UI to run ahead of the backend services which only update via the "Update Now" button.

**Setup step (once, per instance):**
UI Service → Settings → Build → **Auto Deploy → Off**

This applies both to Jan's own instance and must be documented as a required setup step in the Railway template onboarding / `RAILWAY_TEMPLATE_SETUP.md`. With Auto Deploy off, all 7 services are symmetric: none deploys automatically, all are triggered exclusively via `POST /api/admin/update`.

---

## Implementation Plan

### Backend (`apps/api`)

1. Add env vars to Railway template: `RAILWAY_API_TOKEN` (user-provided), all `*_SERVICE_ID` reference vars, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`
2. Add `APP_VERSION` injection to GitHub Actions workflow
3. Implement `GET /api/version`:
   - Read `APP_VERSION` from env
   - Fetch latest SHA from GitHub API (with 60min cache)
   - Return comparison result
4. Implement `POST /api/admin/update`:
   - Auth via `CONFIG_PASSWORD`
   - Loop through service IDs, call Railway GraphQL API per service
   - Return `202` immediately
5. Add `railwayApiToken` to `Setting` model and config save/load logic

### Frontend (`apps/midcurve-ui`)

1. Extend `ConfigContext` to include `versionInfo` from `GET /api/version`
2. Implement `<UpdateNotification />` component
3. Add Railway API Token field to Settings page
4. Wire "Update Now" button to `POST /api/admin/update`

---

## Security Considerations

- `RAILWAY_API_TOKEN` is stored in the DB (encrypted at rest by Railway/Postgres) and never exposed via any public API endpoint
- `POST /api/admin/update` requires `CONFIG_PASSWORD` — same admin gate as all other write operations
- Railway API Token should have minimal scope: only "Deploy" permissions, not "Admin"
- The token only controls the user's own Railway project (scoped by project/environment IDs)

---

## Open Questions

1. Should we support partial updates (single service) or always redeploy all? — All for v1, simpler UX.
2. Should the update notification be dismissible per session? — Yes, add a close button that suppresses until next app load.
3. Railway API Token scope: Railway currently only offers full-access tokens, not scoped tokens. Document this limitation.
