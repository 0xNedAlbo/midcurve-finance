/*
  Warnings:

  - You are about to drop the `user_quote_token_preferences` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "user_quote_token_preferences" DROP CONSTRAINT "user_quote_token_preferences_userId_fkey";

-- DropTable
DROP TABLE "user_quote_token_preferences";
