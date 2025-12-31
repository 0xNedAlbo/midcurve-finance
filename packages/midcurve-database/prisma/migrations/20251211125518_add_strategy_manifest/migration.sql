-- AlterTable
ALTER TABLE "strategies" ADD COLUMN     "manifestId" TEXT,
ADD COLUMN     "skippedPositionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "strategy_manifests" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "abi" JSONB NOT NULL,
    "bytecode" TEXT NOT NULL,
    "constructorParams" JSONB NOT NULL,
    "capabilities" JSONB NOT NULL,
    "basicCurrencyId" TEXT NOT NULL,
    "userParams" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAudited" BOOLEAN NOT NULL DEFAULT false,
    "author" TEXT,
    "repository" TEXT,
    "tags" TEXT[],

    CONSTRAINT "strategy_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_manifests_slug_key" ON "strategy_manifests"("slug");

-- CreateIndex
CREATE INDEX "strategy_manifests_isActive_idx" ON "strategy_manifests"("isActive");

-- CreateIndex
CREATE INDEX "strategy_manifests_basicCurrencyId_idx" ON "strategy_manifests"("basicCurrencyId");

-- CreateIndex
CREATE INDEX "strategies_manifestId_idx" ON "strategies"("manifestId");

-- AddForeignKey
ALTER TABLE "strategy_manifests" ADD CONSTRAINT "strategy_manifests_basicCurrencyId_fkey" FOREIGN KEY ("basicCurrencyId") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "strategy_manifests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
