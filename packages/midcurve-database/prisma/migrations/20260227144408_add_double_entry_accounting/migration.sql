-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "accounting";

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "reportingCurrency" TEXT NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "accounting"."account_definitions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "normalSide" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "account_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting"."journal_entries" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "domainEventId" TEXT,
    "domainEventType" TEXT,
    "ledgerEventRef" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "memo" TEXT,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting"."journal_lines" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "instrumentRef" TEXT,
    "side" TEXT NOT NULL,
    "amountQuote" TEXT NOT NULL,
    "amountReporting" TEXT,
    "reportingCurrency" TEXT,
    "exchangeRate" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting"."nav_snapshots" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "snapshotType" TEXT NOT NULL,
    "reportingCurrency" TEXT NOT NULL,
    "valuationMethod" TEXT NOT NULL,
    "totalAssets" TEXT NOT NULL,
    "totalLiabilities" TEXT NOT NULL,
    "netAssetValue" TEXT NOT NULL,
    "totalContributedCapital" TEXT NOT NULL,
    "totalCapitalReturned" TEXT NOT NULL,
    "totalAccumulatedPnl" TEXT NOT NULL,
    "periodFeeIncome" TEXT NOT NULL,
    "periodRealizedPnl" TEXT NOT NULL,
    "periodUnrealizedPnl" TEXT NOT NULL,
    "periodGasExpense" TEXT NOT NULL,
    "activePositionCount" INTEGER NOT NULL,
    "positionBreakdown" JSONB NOT NULL,

    CONSTRAINT "nav_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_definitions_code_key" ON "accounting"."account_definitions"("code");

-- CreateIndex
CREATE INDEX "account_definitions_category_idx" ON "accounting"."account_definitions"("category");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_domainEventId_key" ON "accounting"."journal_entries"("domainEventId");

-- CreateIndex
CREATE INDEX "journal_entries_userId_entryDate_idx" ON "accounting"."journal_entries"("userId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_entries_ledgerEventRef_idx" ON "accounting"."journal_entries"("ledgerEventRef");

-- CreateIndex
CREATE INDEX "journal_lines_journalEntryId_idx" ON "accounting"."journal_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "accounting"."journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "journal_lines_instrumentRef_idx" ON "accounting"."journal_lines"("instrumentRef");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_instrumentRef_idx" ON "accounting"."journal_lines"("accountId", "instrumentRef");

-- CreateIndex
CREATE INDEX "nav_snapshots_userId_snapshotDate_idx" ON "accounting"."nav_snapshots"("userId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "nav_snapshots_userId_snapshotDate_snapshotType_key" ON "accounting"."nav_snapshots"("userId", "snapshotDate", "snapshotType");

-- AddForeignKey
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."journal_lines" ADD CONSTRAINT "journal_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "accounting"."journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting"."account_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."nav_snapshots" ADD CONSTRAINT "nav_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
