-- CreateTable
CREATE TABLE "accounting"."tracked_instruments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "instrumentRef" TEXT NOT NULL,

    CONSTRAINT "tracked_instruments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracked_instruments_userId_idx" ON "accounting"."tracked_instruments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_instruments_userId_instrumentRef_key" ON "accounting"."tracked_instruments"("userId", "instrumentRef");

-- AddForeignKey
ALTER TABLE "accounting"."tracked_instruments" ADD CONSTRAINT "tracked_instruments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
