-- DropForeignKey
ALTER TABLE "positions" DROP CONSTRAINT "positions_userId_fkey";

-- DropForeignKey
ALTER TABLE "strategies" DROP CONSTRAINT "strategies_userId_fkey";

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
