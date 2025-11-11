-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "auth_wallet_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_wallet_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "lastUsed" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
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
    "email" TEXT,
    "image" TEXT,

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
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "protocol" TEXT NOT NULL,
    "poolType" TEXT NOT NULL,
    "token0Id" TEXT NOT NULL,
    "token1Id" TEXT NOT NULL,
    "feeBps" INTEGER NOT NULL,
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
    "positionType" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionHash" TEXT,
    "currentValue" TEXT NOT NULL,
    "currentCostBasis" TEXT NOT NULL,
    "realizedPnl" TEXT NOT NULL,
    "unrealizedPnl" TEXT NOT NULL,
    "collectedFees" TEXT NOT NULL,
    "unClaimedFees" TEXT NOT NULL,
    "lastFeesCollectedAt" TIMESTAMP(3),
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
CREATE TABLE "position_sync_states" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "positionId" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncBy" TEXT,
    "state" JSONB NOT NULL,

    CONSTRAINT "position_sync_states_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "user_quote_token_preferences" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "preferredQuoteTokens" JSONB NOT NULL,

    CONSTRAINT "user_quote_token_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_accounts_userId_idx" ON "auth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_accounts_provider_providerAccountId_key" ON "auth_accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_sessionToken_key" ON "auth_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_verification_tokens_token_key" ON "auth_verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "auth_verification_tokens_identifier_token_key" ON "auth_verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "auth_wallet_addresses_userId_idx" ON "auth_wallet_addresses"("userId");

-- CreateIndex
CREATE INDEX "auth_wallet_addresses_address_idx" ON "auth_wallet_addresses"("address");

-- CreateIndex
CREATE UNIQUE INDEX "auth_wallet_addresses_address_chainId_key" ON "auth_wallet_addresses"("address", "chainId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "cache_expiresAt_idx" ON "cache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_name_idx" ON "users"("name");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "tokens_tokenType_idx" ON "tokens"("tokenType");

-- CreateIndex
CREATE INDEX "tokens_symbol_idx" ON "tokens"("symbol");

-- CreateIndex
CREATE INDEX "tokens_coingeckoId_idx" ON "tokens"("coingeckoId");

-- CreateIndex
CREATE INDEX "pools_protocol_idx" ON "pools"("protocol");

-- CreateIndex
CREATE INDEX "pools_poolType_idx" ON "pools"("poolType");

-- CreateIndex
CREATE INDEX "pools_token0Id_idx" ON "pools"("token0Id");

-- CreateIndex
CREATE INDEX "pools_token1Id_idx" ON "pools"("token1Id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_positionHash_key" ON "positions"("positionHash");

-- CreateIndex
CREATE INDEX "positions_protocol_idx" ON "positions"("protocol");

-- CreateIndex
CREATE INDEX "positions_positionType_idx" ON "positions"("positionType");

-- CreateIndex
CREATE INDEX "positions_userId_idx" ON "positions"("userId");

-- CreateIndex
CREATE INDEX "positions_poolId_idx" ON "positions"("poolId");

-- CreateIndex
CREATE INDEX "positions_isActive_idx" ON "positions"("isActive");

-- CreateIndex
CREATE INDEX "positions_userId_positionHash_idx" ON "positions"("userId", "positionHash");

-- CreateIndex
CREATE UNIQUE INDEX "position_sync_states_positionId_key" ON "position_sync_states"("positionId");

-- CreateIndex
CREATE INDEX "position_sync_states_positionId_idx" ON "position_sync_states"("positionId");

-- CreateIndex
CREATE INDEX "position_sync_states_lastSyncAt_idx" ON "position_sync_states"("lastSyncAt");

-- CreateIndex
CREATE INDEX "position_sync_states_lastSyncBy_idx" ON "position_sync_states"("lastSyncBy");

-- CreateIndex
CREATE INDEX "pool_prices_protocol_idx" ON "pool_prices"("protocol");

-- CreateIndex
CREATE INDEX "pool_prices_poolId_idx" ON "pool_prices"("poolId");

-- CreateIndex
CREATE INDEX "pool_prices_timestamp_idx" ON "pool_prices"("timestamp");

-- CreateIndex
CREATE INDEX "pool_prices_poolId_timestamp_idx" ON "pool_prices"("poolId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "position_ledger_events_inputHash_key" ON "position_ledger_events"("inputHash");

-- CreateIndex
CREATE INDEX "position_ledger_events_positionId_timestamp_idx" ON "position_ledger_events"("positionId", "timestamp");

-- CreateIndex
CREATE INDEX "position_ledger_events_protocol_idx" ON "position_ledger_events"("protocol");

-- CreateIndex
CREATE INDEX "position_ledger_events_eventType_idx" ON "position_ledger_events"("eventType");

-- CreateIndex
CREATE INDEX "position_ledger_events_inputHash_idx" ON "position_ledger_events"("inputHash");

-- CreateIndex
CREATE INDEX "position_ledger_events_previousId_idx" ON "position_ledger_events"("previousId");

-- CreateIndex
CREATE INDEX "position_apr_periods_positionId_startTimestamp_idx" ON "position_apr_periods"("positionId", "startTimestamp");

-- CreateIndex
CREATE INDEX "position_apr_periods_positionId_endTimestamp_idx" ON "position_apr_periods"("positionId", "endTimestamp");

-- CreateIndex
CREATE INDEX "position_apr_periods_aprBps_idx" ON "position_apr_periods"("aprBps");

-- CreateIndex
CREATE INDEX "user_quote_token_preferences_userId_idx" ON "user_quote_token_preferences"("userId");

-- CreateIndex
CREATE INDEX "user_quote_token_preferences_protocol_idx" ON "user_quote_token_preferences"("protocol");

-- CreateIndex
CREATE UNIQUE INDEX "user_quote_token_preferences_userId_protocol_key" ON "user_quote_token_preferences"("userId", "protocol");

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_wallet_addresses" ADD CONSTRAINT "auth_wallet_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_token0Id_fkey" FOREIGN KEY ("token0Id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_token1Id_fkey" FOREIGN KEY ("token1Id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_sync_states" ADD CONSTRAINT "position_sync_states_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_prices" ADD CONSTRAINT "pool_prices_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_ledger_events" ADD CONSTRAINT "position_ledger_events_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_ledger_events" ADD CONSTRAINT "position_ledger_events_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "position_ledger_events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "position_apr_periods" ADD CONSTRAINT "position_apr_periods_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quote_token_preferences" ADD CONSTRAINT "user_quote_token_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
