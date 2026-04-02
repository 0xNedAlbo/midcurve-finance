-- DropForeignKey
ALTER TABLE "public"."favorite_pools" DROP CONSTRAINT IF EXISTS "favorite_pools_userId_fkey";
ALTER TABLE "public"."favorite_pools" DROP CONSTRAINT IF EXISTS "favorite_pools_poolId_fkey";

-- DropTable
DROP TABLE IF EXISTS "public"."favorite_pools";
