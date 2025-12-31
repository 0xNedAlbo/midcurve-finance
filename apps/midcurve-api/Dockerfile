# Build stage
FROM node:20-alpine AS builder
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

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm --filter @midcurve/database db:generate

# Build the API (skip migrations - they run at deploy time)
RUN cd apps/midcurve-api && npx next build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Install required system packages for Prisma
RUN apk add --no-cache openssl

# Copy standalone build
COPY --from=builder /app/apps/midcurve-api/.next/standalone ./
COPY --from=builder /app/apps/midcurve-api/.next/static ./apps/midcurve-api/.next/static
COPY --from=builder /app/apps/midcurve-api/public ./apps/midcurve-api/public

# Copy Prisma client and query engine
COPY --from=builder /app/packages/midcurve-database/src/generated/prisma ./packages/midcurve-database/src/generated/prisma
COPY --from=builder /app/packages/midcurve-database/prisma ./packages/midcurve-database/prisma

EXPOSE 3001

# Start the server
CMD ["node", "apps/midcurve-api/server.js"]
