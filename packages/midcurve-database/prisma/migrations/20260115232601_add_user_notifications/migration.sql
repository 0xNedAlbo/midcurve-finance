-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('POSITION_OUT_OF_RANGE', 'POSITION_IN_RANGE', 'STOP_LOSS_EXECUTED', 'STOP_LOSS_FAILED', 'TAKE_PROFIT_EXECUTED', 'TAKE_PROFIT_FAILED');

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

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_webhook_configs" ADD CONSTRAINT "user_webhook_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_range_statuses" ADD CONSTRAINT "position_range_statuses_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
