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

# Copy automation app
COPY apps/midcurve-automation/ apps/midcurve-automation/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm --filter @midcurve/database db:generate

# Build dependent packages first
RUN pnpm --filter @midcurve/shared build
RUN pnpm --filter @midcurve/services build

# Build the automation app
RUN pnpm --filter @midcurve/automation build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3004
ENV HOSTNAME=0.0.0.0

# Install required system packages (wget for healthcheck)
RUN apk add --no-cache openssl wget

# Copy standalone build
COPY --from=builder /app/apps/midcurve-automation/.next/standalone ./
COPY --from=builder /app/apps/midcurve-automation/.next/static ./apps/midcurve-automation/.next/static

# Copy Prisma client
COPY --from=builder /app/packages/midcurve-database/src/generated/prisma ./packages/midcurve-database/src/generated/prisma

# Copy scripts for worker entrypoint
COPY --from=builder /app/apps/midcurve-automation/scripts ./apps/midcurve-automation/scripts
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3004

# Start the API server (workers start automatically via Next.js instrumentation)
CMD ["node", "apps/midcurve-automation/server.js"]
