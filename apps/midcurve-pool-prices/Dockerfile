# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm and build dependencies
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache python3 make g++

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json ./

# Copy packages (dependencies)
COPY packages/ packages/

# Copy pool-prices app
COPY apps/midcurve-pool-prices/ apps/midcurve-pool-prices/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm --filter @midcurve/database db:generate

# Build dependent packages
RUN pnpm --filter @midcurve/shared build
RUN pnpm --filter @midcurve/services build

# Build the pool-prices app
RUN pnpm --filter @midcurve/pool-prices build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built application
COPY --from=builder /app/apps/midcurve-pool-prices/dist ./dist

# Copy package.json for module resolution
COPY --from=builder /app/apps/midcurve-pool-prices/package.json ./

# Copy node_modules (includes workspace packages)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/midcurve-pool-prices/node_modules ./apps/midcurve-pool-prices/node_modules

# Copy Prisma client
COPY --from=builder /app/packages/midcurve-database/src/generated/prisma ./packages/midcurve-database/src/generated/prisma

# Copy built workspace packages
COPY --from=builder /app/packages/midcurve-shared/dist ./packages/midcurve-shared/dist
COPY --from=builder /app/packages/midcurve-shared/package.json ./packages/midcurve-shared/package.json
COPY --from=builder /app/packages/midcurve-services/dist ./packages/midcurve-services/dist
COPY --from=builder /app/packages/midcurve-services/package.json ./packages/midcurve-services/package.json
COPY --from=builder /app/packages/midcurve-database/package.json ./packages/midcurve-database/package.json

# Start the service
CMD ["node", "dist/index.js"]
