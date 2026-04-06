-- AlterTable
ALTER TABLE "public"."tokens" ADD COLUMN "tokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tokens_tokenHash_key" ON "public"."tokens"("tokenHash");
