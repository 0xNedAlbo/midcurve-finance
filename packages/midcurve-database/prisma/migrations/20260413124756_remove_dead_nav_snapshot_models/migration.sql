/*
  Warnings:

  - You are about to drop the `nav_snapshots` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `snapshot_state_cache` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "accounting"."nav_snapshots" DROP CONSTRAINT "nav_snapshots_userId_fkey";

-- DropForeignKey
ALTER TABLE "accounting"."snapshot_state_cache" DROP CONSTRAINT "snapshot_state_cache_snapshotId_fkey";

-- DropTable
DROP TABLE "accounting"."nav_snapshots";

-- DropTable
DROP TABLE "accounting"."snapshot_state_cache";
