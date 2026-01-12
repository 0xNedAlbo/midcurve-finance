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
