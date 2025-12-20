-- AlterTable
ALTER TABLE "strategies" ADD COLUMN     "vaultConfig" JSONB,
ADD COLUMN     "vaultDeployedAt" TIMESTAMP(3),
ADD COLUMN     "vaultTokenId" TEXT;

-- CreateIndex
CREATE INDEX "strategies_vaultTokenId_idx" ON "strategies"("vaultTokenId");

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_vaultTokenId_fkey" FOREIGN KEY ("vaultTokenId") REFERENCES "tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
