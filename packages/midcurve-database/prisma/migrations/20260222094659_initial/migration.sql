-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('POSITION_OUT_OF_RANGE', 'POSITION_IN_RANGE', 'STOP_LOSS_EXECUTED', 'STOP_LOSS_FAILED', 'TAKE_PROFIT_EXECUTED', 'TAKE_PROFIT_FAILED');

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "address" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tokenType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "logoUrl" TEXT,
    "coingeckoId" TEXT,
    "marketCap" DOUBLE PRECISION,
    "config" JSONB NOT NULL,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coingecko_tokens" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "coingeckoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "enrichedAt" TIMESTAMP(3),
    "imageUrl" TEXT,
    "marketCapUsd" DOUBLE PRECISION,
    "config" JSONB NOT NULL,

    CONSTRAINT "coingecko_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "protocol" TEXT NOT NULL,
    "token0Id" TEXT NOT NULL,
    "token1Id" TEXT NOT NULL,
    "poolHash" TEXT,
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "protocol" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionHash" TEXT,
    "currentValue" TEXT NOT NULL,
    "currentCostBasis" TEXT NOT NULL,
    "realizedPnl" TEXT NOT NULL,
    "unrealizedPnl" TEXT NOT NULL,
    "realizedCashflow" TEXT NOT NULL DEFAULT '0',
    "unrealizedCashflow" TEXT NOT NULL DEFAULT '0',
    "collectedFees" TEXT NOT NULL,
    "unClaimedFees" TEXT NOT NULL,
    "lastFeesCollectedAt" TIMESTAMP(3),
    "totalApr" DOUBLE PRECISION,
    "priceRangeLower" TEXT NOT NULL,
    "priceRangeUpper" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "isToken0Quote" BOOLEAN NOT NULL,
    "positionOpenedAt" TIMESTAMP(3) NOT NULL,
    "positionClosedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL,
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_prices" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "protocol" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "token1PricePerToken0" TEXT NOT NULL,
    "token0PricePerToken1" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "pool_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_ledger_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "positionId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "previousId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "eventType" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "poolPrice" TEXT NOT NULL,
    "token0Amount" TEXT NOT NULL,
    "token1Amount" TEXT NOT NULL,
    "tokenValue" TEXT NOT NULL,
    "rewards" JSONB NOT NULL,
    "deltaCostBasis" TEXT NOT NULL,
    "costBasisAfter" TEXT NOT NULL,
    "deltaPnl" TEXT NOT NULL,
    "pnlAfter" TEXT NOT NULL,
    "deltaCollectedFees" TEXT NOT NULL DEFAULT '0',
    "collectedFeesAfter" TEXT NOT NULL DEFAULT '0',
    "deltaRealizedCashflow" TEXT NOT NULL DEFAULT '0',
    "realizedCashflowAfter" TEXT NOT NULL DEFAULT '0',
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "position_ledger_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_apr_periods" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "positionId" TEXT NOT NULL,
    "startEventId" TEXT NOT NULL,
    "endEventId" TEXT NOT NULL,
    "startTimestamp" TIMESTAMP(3) NOT NULL,
    "endTimestamp" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "costBasis" TEXT NOT NULL,
    "collectedFeeValue" TEXT NOT NULL,
    "aprBps" INTEGER NOT NULL,
    "eventCount" INTEGER NOT NULL,

    CONSTRAINT "position_apr_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_wallets" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletType" TEXT NOT NULL,
    "walletPurpose" TEXT NOT NULL DEFAULT 'automation',
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "walletHash" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "automation_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_contracts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sharedContractType" TEXT NOT NULL,
    "sharedContractName" TEXT NOT NULL,
    "interfaceVersionMajor" INTEGER NOT NULL,
    "interfaceVersionMinor" INTEGER NOT NULL,
    "sharedContractHash" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shared_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "close_orders" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "protocol" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "sharedContractId" TEXT,
    "automationState" TEXT NOT NULL DEFAULT 'monitoring',
    "executionAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "orderIdentityHash" TEXT NOT NULL,
    "closeOrderHash" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "close_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onchain_data_subscribers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subscriptionType" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAfterMs" INTEGER,
    "lastPolledAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "onchain_data_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "positionId" TEXT NOT NULL,
    "closeOrderId" TEXT,
    "level" INTEGER NOT NULL,
    "logType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,

    CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_event_outbox" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "publishedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "positionId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_webhook_configs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "enabledEvents" JSONB NOT NULL,
    "webhookSecret" TEXT,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastDeliveryStatus" TEXT,
    "lastDeliveryError" TEXT,

    CONSTRAINT "user_webhook_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_range_statuses" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "positionId" TEXT NOT NULL,
    "isInRange" BOOLEAN NOT NULL,
    "lastSqrtPriceX96" TEXT NOT NULL,
    "lastTick" INTEGER NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_range_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_pools" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,

    CONSTRAINT "favorite_pools_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionId_key" ON "sessions"("sessionId");

-- CreateIndex
CREATE INDEX "sessions_sessionId_idx" ON "sessions"("sessionId");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "cache_expiresAt_idx" ON "cache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_address_key" ON "users"("address");

-- CreateIndex
CREATE INDEX "users_name_idx" ON "users"("name");

-- CreateIndex
CREATE INDEX "tokens_tokenType_idx" ON "tokens"("tokenType");

-- CreateIndex
CREATE INDEX "tokens_symbol_idx" ON "tokens"("symbol");

-- CreateIndex
CREATE INDEX "tokens_coingeckoId_idx" ON "tokens"("coingeckoId");

-- CreateIndex
CREATE INDEX "coingecko_tokens_coingeckoId_idx" ON "coingecko_tokens"("coingeckoId");

-- CreateIndex
CREATE INDEX "coingecko_tokens_symbol_idx" ON "coingecko_tokens"("symbol");

-- CreateIndex
CREATE INDEX "coingecko_tokens_name_idx" ON "coingecko_tokens"("name");

-- CreateIndex
CREATE INDEX "coingecko_tokens_enrichedAt_idx" ON "coingecko_tokens"("enrichedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pools_poolHash_key" ON "pools"("poolHash");

-- CreateIndex
CREATE INDEX "pools_protocol_idx" ON "pools"("protocol");

-- CreateIndex
CREATE INDEX "pools_token0Id_idx" ON "pools"("token0Id");

-- CreateIndex
CREATE INDEX "pools_token1Id_idx" ON "pools"("token1Id");

-- CreateIndex
CREATE INDEX "pools_poolHash_idx" ON "pools"("poolHash");

-- CreateIndex
CREATE INDEX "positions_protocol_idx" ON "positions"("protocol");

-- CreateIndex
CREATE INDEX "positions_userId_idx" ON "positions"("userId");

-- CreateIndex
CREATE INDEX "positions_poolId_idx" ON "positions"("poolId");

-- CreateIndex
CREATE INDEX "positions_isActive_idx" ON "positions"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "positions_userId_positionHash_key" ON "positions"("userId", "positionHash");

-- CreateIndex
CREATE INDEX "pool_prices_protocol_idx" ON "pool_prices"("protocol");

-- CreateIndex
CREATE INDEX "pool_prices_poolId_idx" ON "pool_prices"("poolId");

-- CreateIndex
CREATE INDEX "pool_prices_timestamp_idx" ON "pool_prices"("timestamp");

-- CreateIndex
CREATE INDEX "pool_prices_poolId_timestamp_idx" ON "pool_prices"("poolId", "timestamp");

-- CreateIndex
CREATE INDEX "position_ledger_events_positionId_timestamp_idx" ON "position_ledger_events"("positionId", "timestamp");

-- CreateIndex
CREATE INDEX "position_ledger_events_protocol_idx" ON "position_ledger_events"("protocol");

-- CreateIndex
CREATE INDEX "position_ledger_events_eventType_idx" ON "position_ledger_events"("eventType");

-- CreateIndex
CREATE INDEX "position_ledger_events_previousId_idx" ON "position_ledger_events"("previousId");

-- CreateIndex
CREATE UNIQUE INDEX "position_ledger_events_positionId_inputHash_key" ON "position_ledger_events"("positionId", "inputHash");

-- CreateIndex
CREATE INDEX "position_apr_periods_positionId_startTimestamp_idx" ON "position_apr_periods"("positionId", "startTimestamp");

-- CreateIndex
CREATE INDEX "position_apr_periods_positionId_endTimestamp_idx" ON "position_apr_periods"("positionId", "endTimestamp");

-- CreateIndex
CREATE INDEX "position_apr_periods_aprBps_idx" ON "position_apr_periods"("aprBps");

-- CreateIndex
CREATE UNIQUE INDEX "automation_wallets_walletHash_key" ON "automation_wallets"("walletHash");

-- CreateIndex
CREATE INDEX "automation_wallets_walletType_idx" ON "automation_wallets"("walletType");

-- CreateIndex
CREATE INDEX "automation_wallets_walletPurpose_idx" ON "automation_wallets"("walletPurpose");

-- CreateIndex
CREATE INDEX "automation_wallets_userId_idx" ON "automation_wallets"("userId");

-- CreateIndex
CREATE INDEX "automation_wallets_isActive_idx" ON "automation_wallets"("isActive");

-- CreateIndex
CREATE INDEX "automation_wallets_userId_walletHash_idx" ON "automation_wallets"("userId", "walletHash");

-- CreateIndex
CREATE UNIQUE INDEX "shared_contracts_sharedContractHash_key" ON "shared_contracts"("sharedContractHash");

-- CreateIndex
CREATE INDEX "shared_contracts_sharedContractType_idx" ON "shared_contracts"("sharedContractType");

-- CreateIndex
CREATE INDEX "shared_contracts_sharedContractName_idx" ON "shared_contracts"("sharedContractName");

-- CreateIndex
CREATE INDEX "shared_contracts_sharedContractType_sharedContractName_idx" ON "shared_contracts"("sharedContractType", "sharedContractName");

-- CreateIndex
CREATE INDEX "shared_contracts_interfaceVersionMajor_interfaceVersionMino_idx" ON "shared_contracts"("interfaceVersionMajor", "interfaceVersionMinor");

-- CreateIndex
CREATE INDEX "shared_contracts_isActive_idx" ON "shared_contracts"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "close_orders_orderIdentityHash_key" ON "close_orders"("orderIdentityHash");

-- CreateIndex
CREATE INDEX "close_orders_protocol_idx" ON "close_orders"("protocol");

-- CreateIndex
CREATE INDEX "close_orders_automationState_idx" ON "close_orders"("automationState");

-- CreateIndex
CREATE INDEX "close_orders_positionId_idx" ON "close_orders"("positionId");

-- CreateIndex
CREATE INDEX "close_orders_closeOrderHash_idx" ON "close_orders"("closeOrderHash");

-- CreateIndex
CREATE INDEX "close_orders_sharedContractId_idx" ON "close_orders"("sharedContractId");

-- CreateIndex
CREATE UNIQUE INDEX "close_orders_positionId_closeOrderHash_key" ON "close_orders"("positionId", "closeOrderHash");

-- CreateIndex
CREATE UNIQUE INDEX "onchain_data_subscribers_subscriptionId_key" ON "onchain_data_subscribers"("subscriptionId");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_subscriptionType_idx" ON "onchain_data_subscribers"("subscriptionType");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_status_idx" ON "onchain_data_subscribers"("status");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_subscriptionType_status_idx" ON "onchain_data_subscribers"("subscriptionType", "status");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_lastPolledAt_idx" ON "onchain_data_subscribers"("lastPolledAt");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_pausedAt_idx" ON "onchain_data_subscribers"("pausedAt");

-- CreateIndex
CREATE INDEX "automation_logs_positionId_createdAt_idx" ON "automation_logs"("positionId", "createdAt");

-- CreateIndex
CREATE INDEX "automation_logs_positionId_level_createdAt_idx" ON "automation_logs"("positionId", "level", "createdAt");

-- CreateIndex
CREATE INDEX "automation_logs_closeOrderId_idx" ON "automation_logs"("closeOrderId");

-- CreateIndex
CREATE INDEX "domain_event_outbox_status_createdAt_idx" ON "domain_event_outbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "domain_event_outbox_entityType_entityId_idx" ON "domain_event_outbox"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "domain_events_entityType_entityId_idx" ON "domain_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "domain_events_eventType_createdAt_idx" ON "domain_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "domain_events_userId_createdAt_idx" ON "domain_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "user_notifications_userId_createdAt_idx" ON "user_notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "user_notifications_userId_isRead_createdAt_idx" ON "user_notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "user_notifications_positionId_idx" ON "user_notifications"("positionId");

-- CreateIndex
CREATE INDEX "user_notifications_eventType_idx" ON "user_notifications"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "user_webhook_configs_userId_key" ON "user_webhook_configs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "position_range_statuses_positionId_key" ON "position_range_statuses"("positionId");

-- CreateIndex
CREATE INDEX "position_range_statuses_isInRange_idx" ON "position_range_statuses"("isInRange");

-- CreateIndex
CREATE INDEX "favorite_pools_userId_idx" ON "favorite_pools"("userId");

-- CreateIndex
CREATE INDEX "favorite_pools_poolId_idx" ON "favorite_pools"("poolId");

-- CreateIndex
CREATE INDEX "favorite_pools_userId_createdAt_idx" ON "favorite_pools"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_pools_userId_poolId_key" ON "favorite_pools"("userId", "poolId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_token0Id_fkey" FOREIGN KEY ("token0Id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_token1Id_fkey" FOREIGN KEY ("token1Id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_prices" ADD CONSTRAINT "pool_prices_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_ledger_events" ADD CONSTRAINT "position_ledger_events_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_ledger_events" ADD CONSTRAINT "position_ledger_events_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "position_ledger_events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "position_apr_periods" ADD CONSTRAINT "position_apr_periods_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_orders" ADD CONSTRAINT "close_orders_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_orders" ADD CONSTRAINT "close_orders_sharedContractId_fkey" FOREIGN KEY ("sharedContractId") REFERENCES "shared_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_closeOrderId_fkey" FOREIGN KEY ("closeOrderId") REFERENCES "close_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_webhook_configs" ADD CONSTRAINT "user_webhook_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_range_statuses" ADD CONSTRAINT "position_range_statuses_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_pools" ADD CONSTRAINT "favorite_pools_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_pools" ADD CONSTRAINT "favorite_pools_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
