# Testing Guide

This document explains the testing infrastructure for Midcurve Services, including both unit tests and integration tests.

## Test Structure

Midcurve Services uses **Vitest workspaces** to separate unit tests from integration tests:

```
├── Unit Tests (*.test.ts)
│   - Fast, isolated tests with mocked dependencies
│   - Mock Prisma client, RPC calls, external services
│   - Run frequently during development
│   - Execution time: ~350ms for 121 tests
│
└── Integration Tests (*.integration.test.ts)
    - Slower tests with real PostgreSQL database
    - Real Prisma client, actual database operations
    - Verify database constraints, relations, transactions
    - Run before commits, in CI/CD pipelines
    - Execution time: varies based on database operations
```

## Quick Start

### Unit Tests (Fast, Always Available)

```bash
# Watch mode (interactive)
npm test

# Single run
npm run test:run

# Only unit tests (watch mode)
npm run test:unit

# Only unit tests (single run)
npm run test:unit:run

# With coverage
npm run test:coverage
```

### Integration Tests (Requires Database)

**Step 1: Create .env.test File**
```bash
# Copy example configuration
cp .env.example .env.test

# Edit .env.test and configure:
# - DATABASE_URL (already set to test database)
# - RPC_URL_* for chains you'll test against
```

**Note:** `.env.test` is git-ignored and should contain your API keys. The file is automatically loaded when running integration tests via Node's `--env-file` flag.

**Step 2: Start Test Database**
```bash
# Start PostgreSQL test database via Docker
npm run db:test:up

# Wait for health check (5-10 seconds)
# The container will be ready when you see "database system is ready to accept connections"
```

**Step 3: Run Integration Tests**
```bash
# Watch mode
npm run test:integration

# Single run
npm run test:integration:run

# With coverage
npm run test:integration:coverage
```

**Step 3: Stop Test Database (Optional)**
```bash
# Stop but keep data
npm run db:test:down

# Stop and delete all data (full reset)
npm run db:test:reset
```

## Test Database Configuration

### Docker Compose Setup

The test database runs in a separate Docker container configured in [docker-compose.test.yml](./docker-compose.test.yml):

- **Image**: `postgres:16-alpine`
- **Port**: `5433` (different from dev database on 5432)
- **Database**: `midcurve_test`
- **User**: `testuser`
- **Password**: `testpass`
- **Connection**: `postgresql://testuser:testpass@localhost:5433/midcurve_test?schema=public`

### Environment Variables

Integration tests load environment variables from **`.env.test`** using Node's native `--env-file` flag (Node v20+):

```bash
# Integration test scripts use --env-file flag
node --env-file=.env.test vitest --project integration
```

**Required Variables in `.env.test`:**
- `DATABASE_URL` - Test database connection (already configured)
- `RPC_URL_ETHEREUM` - Ethereum mainnet RPC endpoint
- `RPC_URL_ARBITRUM` - Arbitrum One RPC endpoint
- `RPC_URL_BASE` - Base mainnet RPC endpoint
- Other RPC URLs as needed for your tests

**How It Works:**
1. Node loads all variables from `.env.test` before Vitest starts
2. Variables are available in `process.env` throughout tests
3. Vitest config can override specific variables (NODE_ENV, LOG_LEVEL)
4. No need for dotenv package - uses native Node v20+ feature

### Why a Separate Database?

Integration tests use a **dedicated test database** to:
- ✅ Avoid interfering with development data
- ✅ Enable parallel test execution without conflicts
- ✅ Provide consistent, reproducible test environment
- ✅ Support full database reset between test runs

### Database Lifecycle

1. **Global Setup** (`src/test/global-setup.ts`)
   - Runs once before all tests
   - Connects to test database
   - Runs Prisma schema migrations (`prisma db push`)
   - Ensures database schema is ready

2. **Per-Test Cleanup** (`src/test/setup-integration.ts`)
   - Runs after each test
   - Clears all data from tables
   - Maintains schema, removes records
   - Ensures test isolation

3. **Test Execution**
   - Each test starts with clean database
   - Creates its own test data
   - Verifies expected behavior
   - Data automatically cleaned up

## Writing Tests

### Unit Test Example

Create a file named `*.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { TokenService } from './token-service.js';

describe('TokenService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let service: TokenService;

  beforeEach(() => {
    // Mock Prisma client
    prismaMock = mockDeep<PrismaClient>();
    service = new TokenService({ prisma: prismaMock });
  });

  it('should create token with correct data', async () => {
    // Arrange
    const input = { tokenType: 'erc20', name: 'USDC', /* ... */ };
    prismaMock.token.create.mockResolvedValue(mockDbResult);

    // Act
    const result = await service.create(input);

    // Assert
    expect(result.name).toBe('USDC');
    expect(prismaMock.token.create).toHaveBeenCalledTimes(1);
  });
});
```

**Key Points:**
- Use `mockDeep<PrismaClient>()` for type-safe mocking
- Fast execution (no I/O)
- Test business logic in isolation

### Integration Test Example

Create a file named `*.integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { TokenService } from './token-service.js';
import { getPrismaClient, disconnectPrisma } from '../../test/helpers.js';

describe('TokenService - Integration Tests', () => {
  let service: TokenService;
  const prisma = getPrismaClient();

  beforeEach(() => {
    // Use REAL Prisma client
    service = new TokenService({ prisma });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('should persist token to database', async () => {
    // Arrange
    const input = { tokenType: 'erc20', name: 'USDC', /* ... */ };

    // Act - writes to real database
    const token = await service.create(input);

    // Assert - verify persistence
    const dbToken = await prisma.token.findUnique({
      where: { id: token.id },
    });
    expect(dbToken).toBeDefined();
    expect(dbToken?.name).toBe('USDC');
  });

  it('should enforce database constraints', async () => {
    // Test unique indexes, foreign keys, etc.
  });
});
```

**Key Points:**
- Use real `getPrismaClient()` from test helpers
- Tests actual database behavior
- Verifies constraints, relations, transactions
- Database cleaned automatically after each test

## Test Helpers

### Available Utilities

Located in [src/test/helpers.ts](./src/test/helpers.ts):

```typescript
import {
  getPrismaClient,    // Get singleton Prisma client
  clearDatabase,      // Remove all data from tables
  disconnectPrisma,   // Close database connection
  seedTestData,       // Create common test data
  countAllRecords,    // Count records across tables
} from '../../test/helpers.js';
```

**Example Usage:**

```typescript
it('should handle concurrent creates', async () => {
  // Create test data in parallel
  const promises = [
    service.create(token1),
    service.create(token2),
    service.create(token3),
  ];

  await Promise.all(promises);

  // Verify all persisted
  const counts = await countAllRecords();
  expect(counts.tokens).toBe(3);
});
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'  # Required for --env-file support
      - run: npm ci
      - run: npm run test:unit:run

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: testuser
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: midcurve_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'  # Required for --env-file support

      # Create .env.test with secrets from GitHub
      - name: Create .env.test
        run: |
          cat > .env.test << EOF
          DATABASE_URL=postgresql://testuser:testpass@localhost:5433/midcurve_test?schema=public
          RPC_URL_ETHEREUM=${{ secrets.RPC_URL_ETHEREUM }}
          RPC_URL_ARBITRUM=${{ secrets.RPC_URL_ARBITRUM }}
          RPC_URL_BASE=${{ secrets.RPC_URL_BASE }}
          RPC_URL_BSC=${{ secrets.RPC_URL_BSC }}
          RPC_URL_POLYGON=${{ secrets.RPC_URL_POLYGON }}
          RPC_URL_OPTIMISM=${{ secrets.RPC_URL_OPTIMISM }}
          NODE_ENV=test
          LOG_LEVEL=silent
          EOF

      - run: npm ci
      - run: npm run test:integration:run
        # .env.test is loaded automatically via --env-file flag
```

**Note:** Add your RPC URLs as GitHub Secrets in repository settings.

### GitLab CI Example

```yaml
unit-tests:
  stage: test
  image: node:20  # Required for --env-file support
  script:
    - npm ci
    - npm run test:unit:run

integration-tests:
  stage: test
  image: node:20  # Required for --env-file support
  services:
    - postgres:16-alpine
  variables:
    POSTGRES_DB: midcurve_test
    POSTGRES_USER: testuser
    POSTGRES_PASSWORD: testpass
  before_script:
    # Create .env.test from CI variables
    - |
      cat > .env.test << EOF
      DATABASE_URL=postgresql://testuser:testpass@postgres:5432/midcurve_test?schema=public
      RPC_URL_ETHEREUM=${RPC_URL_ETHEREUM}
      RPC_URL_ARBITRUM=${RPC_URL_ARBITRUM}
      RPC_URL_BASE=${RPC_URL_BASE}
      RPC_URL_BSC=${RPC_URL_BSC}
      RPC_URL_POLYGON=${RPC_URL_POLYGON}
      RPC_URL_OPTIMISM=${RPC_URL_OPTIMISM}
      NODE_ENV=test
      LOG_LEVEL=silent
      EOF
  script:
    - npm ci
    - npm run test:integration:run
    # .env.test is loaded automatically via --env-file flag
```

**Note:** Add your RPC URLs as GitLab CI/CD variables in project settings.

## Troubleshooting

### Database Connection Issues

**Error:** `Can't reach database server at localhost:5433`

**Solution:**
```bash
# Check if container is running
docker ps | grep midcurve-test-db

# If not running, start it
npm run db:test:up

# Check logs
docker logs midcurve-test-db

# Try full reset
npm run db:test:reset
```

### Port Already in Use

**Error:** `port 5433 is already allocated`

**Solution:**
```bash
# Find process using port 5433
lsof -i :5433

# Kill existing container
docker stop midcurve-test-db
docker rm midcurve-test-db

# Start fresh
npm run db:test:up
```

### Schema Out of Sync

**Error:** `Column doesn't exist` or `Table not found`

**Solution:**
```bash
# Regenerate Prisma client
npm run prisma:generate

# Reset test database
npm run db:test:reset

# Re-run integration tests
npm run test:integration:run
```

### Tests Hang or Timeout

**Cause:** Prisma client not disconnected

**Solution:**
```typescript
import { afterAll } from 'vitest';
import { disconnectPrisma } from '../../test/helpers.js';

afterAll(async () => {
  await disconnectPrisma(); // Always disconnect!
});
```

## Best Practices

### When to Use Unit Tests

✅ **Use unit tests for:**
- Business logic validation
- Input/output transformations
- Edge cases and error handling
- Algorithm correctness
- Type safety verification
- Fast feedback during development

### When to Use Integration Tests

✅ **Use integration tests for:**
- Database constraints (unique indexes, foreign keys)
- Transaction handling
- Complex queries with joins/relations
- Data persistence verification
- Migration testing
- End-to-end workflows

### Test Naming Conventions

```typescript
// Unit tests
src/services/token/token-service.test.ts
src/utils/evm/address.test.ts

// Integration tests
src/services/token/token-service.integration.test.ts
src/services/pool/pool-service.integration.test.ts
```

### Test Structure (AAA Pattern)

```typescript
it('should do something', async () => {
  // Arrange - set up test data and preconditions
  const input = { /* ... */ };

  // Act - perform the operation being tested
  const result = await service.create(input);

  // Assert - verify the expected outcome
  expect(result.id).toBeDefined();
});
```

## Performance

### Current Test Stats

**Unit Tests:**
- Total: 121 tests
- Execution time: ~350ms
- Coverage: High (utils, config, services)

**Integration Tests:**
- Total: Will grow as features are added
- Execution time: Varies (database operations)
- Run sequentially to avoid conflicts

### Optimization Tips

1. **Unit Tests First**: Write comprehensive unit tests before integration tests
2. **Minimize Database I/O**: Only test what requires real database
3. **Use Transactions**: Wrap tests in transactions when possible
4. **Parallel Execution**: Unit tests run in parallel; integration tests sequential
5. **Targeted Testing**: Don't duplicate unit test coverage in integration tests

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vitest Workspaces](https://vitest.dev/guide/workspace)
- [Prisma Testing Guide](https://www.prisma.io/docs/guides/testing)
- [vitest-mock-extended](https://github.com/marchaos/vitest-mock-extended)

## Summary

```bash
# Development workflow
npm test                      # Unit tests (watch mode)
npm run db:test:up           # Start test database
npm run test:integration     # Integration tests (watch mode)

# CI/CD workflow
npm run test:unit:run        # Unit tests (single run)
npm run test:integration:run # Integration tests (single run)

# Cleanup
npm run db:test:down         # Stop test database
npm run db:test:reset        # Full reset
```

---

**Questions?** Check [CLAUDE.md](./CLAUDE.md) for project overview or open an issue on GitHub.
