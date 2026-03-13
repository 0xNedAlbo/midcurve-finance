#!/bin/sh
set -e

echo "=== Midcurve API Startup ==="

# 1. Run Prisma migrations
echo "Running database migrations..."
prisma migrate deploy --schema=packages/midcurve-database/prisma/schema.prisma

# 2. Seed shared contracts (idempotent)
echo "Seeding shared contracts..."
node packages/midcurve-database/prisma/seed-contracts.cjs

# 3. Seed chart of accounts (idempotent)
echo "Seeding chart of accounts..."
node packages/midcurve-database/prisma/seed-accounts.cjs

# 4. Seed CoinGecko tokens (idempotent)
echo "Seeding CoinGecko tokens..."
node packages/midcurve-database/prisma/seed-coingecko-tokens.cjs

# Note: Admin allowlist seeding is now handled by the config wizard (POST /api/config)

echo "=== Starting API server ==="
exec node apps/midcurve-api/server.js
