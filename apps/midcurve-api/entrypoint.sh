#!/bin/sh
set -e

echo "=== Midcurve API Startup ==="

# 1. Run Prisma migrations
echo "Running database migrations..."
prisma migrate deploy --schema=packages/midcurve-database/prisma/schema.prisma

# 2. Seed shared contracts (idempotent)
echo "Seeding shared contracts..."
node packages/midcurve-database/prisma/dist/seed-contracts.js

# 3. Seed chart of accounts (idempotent)
echo "Seeding chart of accounts..."
node packages/midcurve-database/prisma/dist/seed-accounts.js

# 4. Seed CoinGecko tokens (idempotent)
echo "Seeding CoinGecko tokens..."
node packages/midcurve-database/prisma/dist/seed-coingecko-tokens.js

# 5. Seed admin allowlist entry (if ADMIN_WALLET_ADDRESS set)
echo "Seeding allowlist..."
node packages/midcurve-database/prisma/dist/seed-allowlist.js

echo "=== Starting API server ==="
exec node apps/midcurve-api/server.js
