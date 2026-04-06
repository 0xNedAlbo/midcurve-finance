-- Make tokenHash required (all existing rows already backfilled)
ALTER TABLE "public"."tokens" ALTER COLUMN "tokenHash" SET NOT NULL;
