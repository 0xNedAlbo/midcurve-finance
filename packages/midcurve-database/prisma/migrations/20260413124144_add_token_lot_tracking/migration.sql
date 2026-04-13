-- CreateEnum
CREATE TYPE "accounting"."TokenLotTransferEvent" AS ENUM ('INCREASE_POSITION', 'DECREASE_POSITION', 'TRANSFER_IN', 'TRANSFER_OUT', 'VAULT_MINT', 'VAULT_BURN', 'DEPOSIT_TO_PROTOCOL', 'WITHDRAWAL_FROM_PROTOCOL');

-- CreateTable
CREATE TABLE "accounting"."token_lots" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "costBasisAbsolute" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "acquisitionEventId" TEXT NOT NULL,
    "transferEvent" "accounting"."TokenLotTransferEvent" NOT NULL,
    "sequenceNum" INTEGER NOT NULL,
    "journalEntryId" TEXT,

    CONSTRAINT "token_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting"."token_lot_states" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lotId" TEXT NOT NULL,
    "openQuantity" TEXT NOT NULL,
    "isFullyConsumed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "token_lot_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting"."token_lot_disposals" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantityDisposed" TEXT NOT NULL,
    "proceedsReporting" TEXT NOT NULL,
    "costBasisAllocated" TEXT NOT NULL,
    "realizedPnl" TEXT NOT NULL,
    "disposedAt" TIMESTAMP(3) NOT NULL,
    "transferEvent" "accounting"."TokenLotTransferEvent" NOT NULL,
    "disposalEventId" TEXT NOT NULL,
    "sequenceNum" INTEGER NOT NULL,
    "journalEntryId" TEXT,

    CONSTRAINT "token_lot_disposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "token_lots_journalEntryId_idx" ON "accounting"."token_lots"("journalEntryId");

-- CreateIndex
CREATE INDEX "token_lots_userId_tokenHash_idx" ON "accounting"."token_lots"("userId", "tokenHash");

-- CreateIndex
CREATE INDEX "token_lots_userId_tokenHash_acquiredAt_idx" ON "accounting"."token_lots"("userId", "tokenHash", "acquiredAt");

-- CreateIndex
CREATE INDEX "token_lots_userId_sequenceNum_idx" ON "accounting"."token_lots"("userId", "sequenceNum");

-- CreateIndex
CREATE UNIQUE INDEX "token_lots_userId_tokenHash_acquisitionEventId_key" ON "accounting"."token_lots"("userId", "tokenHash", "acquisitionEventId");

-- CreateIndex
CREATE UNIQUE INDEX "token_lot_states_lotId_key" ON "accounting"."token_lot_states"("lotId");

-- CreateIndex
CREATE INDEX "token_lot_states_isFullyConsumed_idx" ON "accounting"."token_lot_states"("isFullyConsumed");

-- CreateIndex
CREATE INDEX "token_lot_disposals_lotId_idx" ON "accounting"."token_lot_disposals"("lotId");

-- CreateIndex
CREATE INDEX "token_lot_disposals_userId_disposedAt_idx" ON "accounting"."token_lot_disposals"("userId", "disposedAt");

-- CreateIndex
CREATE INDEX "token_lot_disposals_disposalEventId_idx" ON "accounting"."token_lot_disposals"("disposalEventId");

-- CreateIndex
CREATE INDEX "token_lot_disposals_journalEntryId_idx" ON "accounting"."token_lot_disposals"("journalEntryId");

-- AddForeignKey
ALTER TABLE "accounting"."token_lots" ADD CONSTRAINT "token_lots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."token_lots" ADD CONSTRAINT "token_lots_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."token_lots" ADD CONSTRAINT "token_lots_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "accounting"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."token_lot_states" ADD CONSTRAINT "token_lot_states_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "accounting"."token_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."token_lot_disposals" ADD CONSTRAINT "token_lot_disposals_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "accounting"."token_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."token_lot_disposals" ADD CONSTRAINT "token_lot_disposals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."token_lot_disposals" ADD CONSTRAINT "token_lot_disposals_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "accounting"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
