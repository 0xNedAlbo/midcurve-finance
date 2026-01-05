-- DropIndex
DROP INDEX IF EXISTS "positions_positionHash_key";

-- DropIndex
DROP INDEX IF EXISTS "positions_userId_positionHash_idx";

-- CreateIndex (composite unique constraint)
CREATE UNIQUE INDEX "positions_userId_positionHash_key" ON "positions"("userId", "positionHash");
