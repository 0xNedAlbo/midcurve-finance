/*
  Warnings:

  - You are about to drop the `automation_wallet_nonces` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "automation_wallet_nonces" DROP CONSTRAINT "automation_wallet_nonces_walletId_fkey";

-- DropTable
DROP TABLE "automation_wallet_nonces";
