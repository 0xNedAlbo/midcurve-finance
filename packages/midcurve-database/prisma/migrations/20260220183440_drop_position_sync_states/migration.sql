/*
  Warnings:

  - You are about to drop the `position_sync_states` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "position_sync_states" DROP CONSTRAINT "position_sync_states_positionId_fkey";

-- DropTable
DROP TABLE "position_sync_states";
