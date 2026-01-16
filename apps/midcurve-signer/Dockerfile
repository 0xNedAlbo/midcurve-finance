# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm and build dependencies
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache python3 make g++

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json ./

# Copy packages (dependencies for Signer)
COPY packages/ packages/

# Copy Signer app
COPY apps/midcurve-signer/ apps/midcurve-signer/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm --filter @midcurve/database db:generate

# Build dependent packages (skip DTS for faster builds)
RUN pnpm --filter @midcurve/shared build:docker
RUN pnpm --filter @midcurve/api-shared build:docker
RUN pnpm --filter @midcurve/services build:docker

# Build the Signer
RUN pnpm --filter @midcurve/signer build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3003

# Install required system packages
RUN apk add --no-cache openssl

# Copy standalone build
COPY --from=builder /app/apps/midcurve-signer/.next/standalone ./
COPY --from=builder /app/apps/midcurve-signer/.next/static ./apps/midcurve-signer/.next/static

# Copy Prisma client
COPY --from=builder /app/packages/midcurve-database/src/generated/prisma ./packages/midcurve-database/src/generated/prisma
COPY --from=builder /app/packages/midcurve-database/prisma ./packages/midcurve-database/prisma

EXPOSE 3003

# Start the server
CMD ["node", "apps/midcurve-signer/server.js"]
