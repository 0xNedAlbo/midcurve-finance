-- DropForeignKey
ALTER TABLE "public"."close_orders" DROP CONSTRAINT "close_orders_sharedContractId_fkey";

-- DropIndex
DROP INDEX "public"."close_orders_sharedContractId_idx";

-- AlterTable
ALTER TABLE "public"."close_orders" DROP COLUMN "sharedContractId";

