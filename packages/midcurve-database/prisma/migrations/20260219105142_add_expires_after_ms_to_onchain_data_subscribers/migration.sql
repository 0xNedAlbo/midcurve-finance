-- AlterTable
ALTER TABLE "onchain_data_subscribers" ADD COLUMN     "expiresAfterMs" INTEGER;

-- Set default expiry for existing subscriptions (preserves current 60s stale threshold behavior)
UPDATE "onchain_data_subscribers" SET "expiresAfterMs" = 60000 WHERE "expiresAfterMs" IS NULL;
