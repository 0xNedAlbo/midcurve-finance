/*
  Warnings:

  - You are about to drop the `automation_wallets` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "public"."system_config" RENAME CONSTRAINT "settings_pkey" TO "system_config_pkey";

-- DropTable
DROP TABLE "automation_wallets";

-- CreateTable
CREATE TABLE "public"."user_wallets" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "walletType" TEXT NOT NULL,
    "walletHash" TEXT NOT NULL,
    "label" TEXT,
    "config" JSONB NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."known_protocol_addresses" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chainType" TEXT NOT NULL,
    "protocolName" TEXT NOT NULL,
    "interactionType" TEXT NOT NULL,
    "protocolAddressHash" TEXT NOT NULL,
    "label" TEXT,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "known_protocol_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_wallets_walletHash_key" ON "public"."user_wallets"("walletHash");

-- CreateIndex
CREATE INDEX "user_wallets_userId_idx" ON "public"."user_wallets"("userId");

-- CreateIndex
CREATE INDEX "user_wallets_walletType_idx" ON "public"."user_wallets"("walletType");

-- CreateIndex
CREATE UNIQUE INDEX "user_wallets_userId_walletHash_key" ON "public"."user_wallets"("userId", "walletHash");

-- CreateIndex
CREATE UNIQUE INDEX "known_protocol_addresses_protocolAddressHash_key" ON "public"."known_protocol_addresses"("protocolAddressHash");

-- CreateIndex
CREATE INDEX "known_protocol_addresses_chainType_idx" ON "public"."known_protocol_addresses"("chainType");

-- CreateIndex
CREATE INDEX "known_protocol_addresses_protocolName_idx" ON "public"."known_protocol_addresses"("protocolName");

-- CreateIndex
CREATE INDEX "known_protocol_addresses_interactionType_idx" ON "public"."known_protocol_addresses"("interactionType");

-- CreateIndex
CREATE INDEX "known_protocol_addresses_isActive_idx" ON "public"."known_protocol_addresses"("isActive");

-- AddForeignKey
ALTER TABLE "public"."user_wallets" ADD CONSTRAINT "user_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
