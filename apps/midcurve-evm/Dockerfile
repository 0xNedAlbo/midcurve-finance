# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm and build dependencies
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache python3 make g++

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json ./

# Copy packages (dependencies for EVM)
COPY packages/ packages/

# Copy EVM app (excluding contracts - built separately)
COPY apps/midcurve-evm/ apps/midcurve-evm/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm --filter @midcurve/database db:generate

# Build the EVM API
RUN pnpm --filter @midcurve/evm build:api

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3002

# Install required system packages
RUN apk add --no-cache openssl

# Copy standalone build
COPY --from=builder /app/apps/midcurve-evm/.next/standalone ./
COPY --from=builder /app/apps/midcurve-evm/.next/static ./apps/midcurve-evm/.next/static

# Copy Prisma client
COPY --from=builder /app/packages/midcurve-database/src/generated/prisma ./packages/midcurve-database/src/generated/prisma

# Copy core orchestrator source (for tsx execution)
COPY --from=builder /app/apps/midcurve-evm/core ./apps/midcurve-evm/core
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3002

# Start the API server
CMD ["node", "apps/midcurve-evm/server.js"]
