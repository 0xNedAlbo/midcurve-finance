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

# Copy business-logic app
COPY apps/midcurve-business-logic/ apps/midcurve-business-logic/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm --filter @midcurve/database db:generate

# Build dependent packages
RUN pnpm --filter @midcurve/shared build
RUN pnpm --filter @midcurve/api-shared build
RUN pnpm --filter @midcurve/services build

# Build the business-logic app
RUN pnpm --filter @midcurve/business-logic build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built application
COPY --from=builder /app/apps/midcurve-business-logic/dist ./dist

# Copy package.json for module resolution
COPY --from=builder /app/apps/midcurve-business-logic/package.json ./

# Copy node_modules (non-workspace deps: amqplib, pino, node-cron, etc.)
COPY --from=builder /app/node_modules ./node_modules

# Copy Prisma client (native bindings, not bundled by tsup)
COPY --from=builder /app/packages/midcurve-database/src/generated/prisma ./packages/midcurve-database/src/generated/prisma

# Start the service
CMD ["node", "dist/index.js"]
