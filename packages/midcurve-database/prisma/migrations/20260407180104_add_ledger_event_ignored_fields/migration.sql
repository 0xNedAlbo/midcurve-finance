-- AlterTable
ALTER TABLE "public"."position_ledger_events" ADD COLUMN     "ignoredReason" TEXT,
ADD COLUMN     "isIgnored" BOOLEAN NOT NULL DEFAULT false;
