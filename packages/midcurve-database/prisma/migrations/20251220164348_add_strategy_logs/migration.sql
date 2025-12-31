-- CreateTable
CREATE TABLE "strategy_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "strategyId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "epoch" BIGINT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "topicName" TEXT,
    "data" TEXT NOT NULL,
    "dataDecoded" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategy_logs_strategyId_timestamp_idx" ON "strategy_logs"("strategyId", "timestamp");

-- CreateIndex
CREATE INDEX "strategy_logs_strategyId_level_timestamp_idx" ON "strategy_logs"("strategyId", "level", "timestamp");

-- CreateIndex
CREATE INDEX "strategy_logs_timestamp_idx" ON "strategy_logs"("timestamp");

-- AddForeignKey
ALTER TABLE "strategy_logs" ADD CONSTRAINT "strategy_logs_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
