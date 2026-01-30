-- AlterTable
ALTER TABLE "coingecko_tokens" ADD COLUMN     "enrichedAt" TIMESTAMP(3),
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "marketCapUsd" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "coingecko_tokens_enrichedAt_idx" ON "coingecko_tokens"("enrichedAt");
