# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

# Build args for Vite (must be available at build time)
ARG VITE_WALLETCONNECT_PROJECT_ID

# Convert ARG to ENV so Vite can access them during build
ENV VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json ./

# Copy packages (dependencies for UI)
COPY packages/ packages/

# Copy UI app
COPY apps/midcurve-ui/ apps/midcurve-ui/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build dependent packages first
RUN pnpm --filter @midcurve/shared build
RUN pnpm --filter @midcurve/api-shared build

# Build the UI
RUN pnpm --filter @midcurve/ui build

# Production stage - serve static files with nginx
FROM nginx:alpine AS runner

# Copy built assets
COPY --from=builder /app/apps/midcurve-ui/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/midcurve-ui/nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint script that generates runtime config
COPY apps/midcurve-ui/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port 3000 (nginx configured to listen on 3000)
EXPOSE 3000

# Start with entrypoint that injects runtime env vars
ENTRYPOINT ["/docker-entrypoint.sh"]
