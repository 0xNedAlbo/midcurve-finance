-- CreateTable
CREATE TABLE "coingecko_tokens" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "coingeckoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "coingecko_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coingecko_tokens_coingeckoId_idx" ON "coingecko_tokens"("coingeckoId");

-- CreateIndex
CREATE INDEX "coingecko_tokens_symbol_idx" ON "coingecko_tokens"("symbol");

-- CreateIndex
CREATE INDEX "coingecko_tokens_name_idx" ON "coingecko_tokens"("name");
