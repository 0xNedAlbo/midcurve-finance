-- AlterTable
ALTER TABLE "automation_close_orders" ALTER COLUMN "automationContractConfig" DROP DEFAULT;

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

-- CreateIndex
CREATE INDEX "automation_logs_positionId_createdAt_idx" ON "automation_logs"("positionId", "createdAt");

-- CreateIndex
CREATE INDEX "automation_logs_positionId_level_createdAt_idx" ON "automation_logs"("positionId", "level", "createdAt");

-- CreateIndex
CREATE INDEX "automation_logs_closeOrderId_idx" ON "automation_logs"("closeOrderId");

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_closeOrderId_fkey" FOREIGN KEY ("closeOrderId") REFERENCES "automation_close_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
