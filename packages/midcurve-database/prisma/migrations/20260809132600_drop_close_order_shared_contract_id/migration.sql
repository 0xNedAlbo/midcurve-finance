-- DropForeignKey
ALTER TABLE "close_orders" DROP CONSTRAINT "close_orders_sharedContractId_fkey";

-- DropIndex
DROP INDEX "close_orders_sharedContractId_idx";

-- AlterTable
ALTER TABLE "public"."close_orders" DROP COLUMN "sharedContractId";

