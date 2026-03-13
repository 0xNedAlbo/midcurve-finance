# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm and build dependencies
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache python3 make g++

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json ./

# Copy packages (dependencies for API)
COPY packages/ packages/

# Copy API app
COPY apps/midcurve-api/ apps/midcurve-api/

# Copy contract deployment files (for seed script)
COPY apps/midcurve-contracts/deployments/ apps/midcurve-contracts/deployments/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm --filter @midcurve/database db:generate

# Build dependent packages
RUN pnpm --filter @midcurve/shared build
RUN pnpm --filter @midcurve/api-shared build
RUN pnpm --filter @midcurve/services build

# Build the API (skip migrations - they run at deploy time)
RUN cd apps/midcurve-api && npx next build --webpack

# Bundle seed scripts with esbuild (self-contained JS, Prisma client external)
RUN pnpm exec esbuild \
  packages/midcurve-database/prisma/seed-accounts.ts \
  packages/midcurve-database/prisma/seed-contracts.ts \
  packages/midcurve-database/prisma/seed-allowlist.ts \
  packages/midcurve-database/prisma/seed-coingecko-tokens.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=cjs \
  --out-extension:.js=.cjs \
  --outdir=packages/midcurve-database/prisma \
  --external:../src/generated/prisma/index.js

# Production stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Apply Alpine security patches and install required system packages for Prisma
RUN apk upgrade --no-cache && apk add --no-cache openssl

# Update npm to patch bundled dependency CVEs (tar, minimatch, glob)
RUN npm install -g npm@latest

# Install prisma CLI for migrations (pinned to 6.x)
RUN npm install -g prisma@6.19.0

# Copy standalone build
COPY --from=builder /app/apps/midcurve-api/.next/standalone ./
COPY --from=builder /app/apps/midcurve-api/.next/static ./apps/midcurve-api/.next/static
COPY --from=builder /app/apps/midcurve-api/public ./apps/midcurve-api/public

# Copy Prisma client and query engine
COPY --from=builder /app/packages/midcurve-database/src/generated/prisma ./packages/midcurve-database/src/generated/prisma

# Copy Prisma schema, migrations, bundled seed scripts, and seed data
COPY --from=builder /app/packages/midcurve-database/prisma ./packages/midcurve-database/prisma

# Copy contract deployment files (for contract seed script)
COPY --from=builder /app/apps/midcurve-contracts/deployments ./apps/midcurve-contracts/deployments

# Copy entrypoint script
COPY apps/midcurve-api/entrypoint.sh ./apps/midcurve-api/entrypoint.sh
RUN chmod +x apps/midcurve-api/entrypoint.sh

EXPOSE 3001

# Run migrations, seeds, then start the server
CMD ["sh", "apps/midcurve-api/entrypoint.sh"]
