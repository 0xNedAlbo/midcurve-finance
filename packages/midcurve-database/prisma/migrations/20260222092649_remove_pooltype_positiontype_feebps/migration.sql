-- DropIndex
DROP INDEX IF EXISTS "pools_poolType_idx";

-- DropIndex
DROP INDEX IF EXISTS "positions_positionType_idx";

-- AlterTable
ALTER TABLE "pools" DROP COLUMN "poolType",
DROP COLUMN "feeBps";

-- AlterTable
ALTER TABLE "positions" DROP COLUMN "positionType";
