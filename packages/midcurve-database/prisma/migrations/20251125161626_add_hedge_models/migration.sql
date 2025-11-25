-- CreateTable
CREATE TABLE "hedges" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "hedgeType" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "notionalValue" TEXT NOT NULL,
    "costBasis" TEXT NOT NULL,
    "realizedPnl" TEXT NOT NULL,
    "unrealizedPnl" TEXT NOT NULL,
    "currentApr" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "hedges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hedge_ledger_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hedgeId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "eventType" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "deltaNotional" TEXT NOT NULL,
    "deltaCostBasis" TEXT NOT NULL,
    "deltaRealizedPnl" TEXT NOT NULL,
    "deltaMargin" TEXT,
    "tokenAmounts" JSONB NOT NULL,
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "hedge_ledger_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hedge_sync_states" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hedgeId" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncBy" TEXT,
    "state" JSONB NOT NULL,

    CONSTRAINT "hedge_sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hedges_userId_idx" ON "hedges"("userId");

-- CreateIndex
CREATE INDEX "hedges_positionId_idx" ON "hedges"("positionId");

-- CreateIndex
CREATE INDEX "hedges_protocol_idx" ON "hedges"("protocol");

-- CreateIndex
CREATE INDEX "hedges_hedgeType_idx" ON "hedges"("hedgeType");

-- CreateIndex
CREATE INDEX "hedges_isActive_idx" ON "hedges"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "hedge_ledger_events_inputHash_key" ON "hedge_ledger_events"("inputHash");

-- CreateIndex
CREATE INDEX "hedge_ledger_events_hedgeId_timestamp_idx" ON "hedge_ledger_events"("hedgeId", "timestamp");

-- CreateIndex
CREATE INDEX "hedge_ledger_events_eventType_idx" ON "hedge_ledger_events"("eventType");

-- CreateIndex
CREATE INDEX "hedge_ledger_events_inputHash_idx" ON "hedge_ledger_events"("inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "hedge_sync_states_hedgeId_key" ON "hedge_sync_states"("hedgeId");

-- CreateIndex
CREATE INDEX "hedge_sync_states_lastSyncAt_idx" ON "hedge_sync_states"("lastSyncAt");

-- AddForeignKey
ALTER TABLE "hedges" ADD CONSTRAINT "hedges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hedges" ADD CONSTRAINT "hedges_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hedge_ledger_events" ADD CONSTRAINT "hedge_ledger_events_hedgeId_fkey" FOREIGN KEY ("hedgeId") REFERENCES "hedges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hedge_sync_states" ADD CONSTRAINT "hedge_sync_states_hedgeId_fkey" FOREIGN KEY ("hedgeId") REFERENCES "hedges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
