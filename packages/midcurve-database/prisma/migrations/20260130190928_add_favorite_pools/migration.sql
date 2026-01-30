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
CREATE INDEX "favorite_pools_userId_idx" ON "favorite_pools"("userId");

-- CreateIndex
CREATE INDEX "favorite_pools_poolId_idx" ON "favorite_pools"("poolId");

-- CreateIndex
CREATE INDEX "favorite_pools_userId_createdAt_idx" ON "favorite_pools"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_pools_userId_poolId_key" ON "favorite_pools"("userId", "poolId");

-- AddForeignKey
ALTER TABLE "favorite_pools" ADD CONSTRAINT "favorite_pools_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_pools" ADD CONSTRAINT "favorite_pools_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
