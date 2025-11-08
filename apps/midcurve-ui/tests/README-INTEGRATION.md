# Integration Testing with Real API

This guide explains how to run E2E tests that use **real authentication** and call the **real backend API**.

## Overview

We have two types of E2E tests:

### 1. UI Tests (Mocked API)
- **Location:** `tests/positions/import-nft.spec.ts`
- **Purpose:** Fast, reliable UI testing
- **Requirements:** None (fully mocked)
- **What's tested:** UI logic, component state, loading states
- **What's NOT tested:** Real API integration

### 2. Integration Tests (Real API)
- **Location:** `tests/positions/import-nft-integration.spec.ts`
- **Purpose:** End-to-end API integration testing
- **Requirements:** Backend API must be running
- **What's tested:** Real authentication, API calls, database interactions
- **What's NOT tested:** Edge cases that would require specific backend state

---

## Test Wallet

Both test suites use a **deterministic test wallet** for reproducible results:

```
Mnemonic:  test test test test test test test test test test test junk
Address:   0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

⚠️  WARNING: These keys are PUBLIC and used by Hardhat/Foundry.
   NEVER use them on mainnet or with real funds!
```

This is the **first account** from the standard Hardhat/Foundry test mnemonic.

---

## Running Integration Tests

### Prerequisites

1. **Start the backend API:**
   ```bash
   cd ../midcurve-api
   npm run dev
   # Should be running on http://localhost:3001
   ```

2. **Ensure database is running:**
   ```bash
   # PostgreSQL should be accessible
   # Connection string in .env: DATABASE_URL=postgresql://...
   ```

3. **Configure RPC endpoints:**
   ```bash
   # In midcurve-api/.env
   RPC_URL_ETHEREUM=https://...
   RPC_URL_ARBITRUM=https://...
   # etc.
   ```

4. **Set API URL in UI:**
   ```bash
   # In midcurve-ui/.env
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

### Run the Tests

```bash
# Run ONLY integration tests (real API)
npm run test:e2e tests/positions/import-nft-integration.spec.ts

# Run with UI for debugging
npm run test:e2e:ui tests/positions/import-nft-integration.spec.ts

# Run in headed mode to see browser
npm run test:e2e:headed tests/positions/import-nft-integration.spec.ts

# Run with debugger
npm run test:e2e:debug tests/positions/import-nft-integration.spec.ts
```

### Run UI tests (mocked, no backend required)

```bash
# Run ONLY UI tests (mocked API)
npm run test:e2e tests/positions/import-nft.spec.ts
```

---

## How Real Authentication Works

### SIWE Flow in Tests

1. **Fetch Nonce:**
   ```typescript
   GET http://localhost:3001/api/v1/auth/nonce
   → { data: { nonce: "abc123..." } }
   ```

2. **Create SIWE Message:**
   ```
   localhost:3000 wants you to sign in with your Ethereum account:
   0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

   Sign in to Midcurve Finance (E2E Test)

   URI: http://localhost:3000
   Version: 1
   Chain ID: 1
   Nonce: abc123...
   Issued At: 2025-01-15T10:00:00Z
   Expiration Time: 2025-01-15T10:05:00Z
   ```

3. **Sign with Test Wallet:**
   ```typescript
   const signature = await signMessageWithTestWallet(message);
   // Uses viem's privateKeyToAccount with test private key
   ```

4. **Submit to API:**
   ```typescript
   POST http://localhost:3001/api/v1/auth/signup
   {
     "message": "...",
     "signature": "0x...",
     "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
   }
   ```

5. **Extract Session Cookie:**
   ```
   Set-Cookie: next-auth.session-token=eyJ...
   ```

6. **Inject into Browser:**
   ```typescript
   await page.context().addCookies([...]);
   ```

7. **All subsequent requests** include the session cookie automatically!

---

## Test Wallet Setup in Backend

The backend API should recognize the test wallet address. You can:

### Option A: Use the wallet as-is
- The test wallet will be treated like any other user
- A user record will be created in the database
- Positions imported will be associated with this user

### Option B: Seed the database
```sql
-- Optionally pre-create the test user
INSERT INTO users (address, primary_wallet_id)
VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '...');
```

### Option C: Test mode in backend
```typescript
// In midcurve-api (optional)
if (process.env.NODE_ENV === 'test' && address === TEST_WALLET_ADDRESS) {
  // Skip certain validations, use test data, etc.
}
```

---

## Debugging Integration Tests

### View API Logs
```bash
# In midcurve-api terminal
# You'll see requests from the test wallet:
# POST /api/v1/auth/nonce
# POST /api/v1/auth/signup
# POST /api/v1/positions/uniswapv3/import
```

### Check Browser Console
```typescript
// Tests include console.log statements
console.log('[E2E] Authenticated as: 0xf39F...');
console.log('[E2E] Submitting import request...');
console.log('[E2E] ✅ Position imported successfully!');
```

### View Screenshots
All test screenshots are saved to `test-results/`:
- `integration-dashboard-authenticated.png`
- `integration-form-filled.png`
- `integration-loading.png`
- `integration-success.png` or `integration-error.png`

### Check Network Tab
Run with headed mode to see network requests:
```bash
npm run test:e2e:headed tests/positions/import-nft-integration.spec.ts
```

Then open DevTools → Network tab to see actual API calls.

---

## Common Issues

### "Failed to fetch nonce"
- ❌ Backend API is not running
- ✅ Start API: `cd ../midcurve-api && npm run dev`

### "Failed to authenticate"
- ❌ Backend API returned an error during signup
- ✅ Check API logs for error details
- ✅ Verify database is accessible
- ✅ Check that SIWE signature verification is working

### "Position import failed"
- ❌ RPC endpoint not configured
- ❌ NFT doesn't exist on that chain
- ❌ Position already imported (not actually an error)
- ✅ Check API logs
- ✅ Check RPC_URL_ARBITRUM is set in API .env
- ✅ Try a different NFT ID

### "Test timeout"
- ❌ API is slow or hanging
- ❌ RPC provider is slow
- ✅ Increase timeout in test: `timeout: 60000`
- ✅ Use faster RPC provider

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  integration-tests:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install dependencies (API)
        run: |
          cd midcurve-api
          npm install
          npx prisma migrate deploy

      - name: Start API server
        run: |
          cd midcurve-api
          npm run dev &
          sleep 10 # Wait for server to start
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/midcurve_test
          RPC_URL_ARBITRUM: ${{ secrets.RPC_URL_ARBITRUM }}

      - name: Install dependencies (UI)
        run: |
          cd midcurve-ui
          npm install
          npx playwright install --with-deps

      - name: Run integration tests
        run: |
          cd midcurve-ui
          npm run test:e2e tests/positions/import-nft-integration.spec.ts
        env:
          NEXT_PUBLIC_API_URL: http://localhost:3001

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: midcurve-ui/test-results/
```

---

## Best Practices

### ✅ Do:
- Run integration tests **before** merging to main
- Keep integration tests **separate** from UI tests
- Use **realistic test data** (real NFT IDs that exist on-chain)
- **Clean up** test data after tests (optional)
- Take **screenshots** at key steps for debugging

### ❌ Don't:
- Run integration tests in parallel (can cause rate limits)
- Use integration tests for **every** UI interaction (too slow)
- Commit sensitive data (all test keys are public anyway)
- Run integration tests without backend

---

## Next Steps

1. **Add more integration tests:**
   - Import wallet flow
   - Position wizard
   - Position list display
   - Position detail page

2. **Add test data seeding:**
   - Pre-populate database with test positions
   - Reset database between test runs

3. **Add performance monitoring:**
   - Track API response times
   - Alert on slow tests

4. **Add visual regression testing:**
   - Compare screenshots to baselines
   - Catch UI changes automatically
