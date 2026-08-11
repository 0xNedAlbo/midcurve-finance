-- CreateTable
CREATE TABLE "public"."operator_nonces" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "nextNonce" INTEGER NOT NULL,

    CONSTRAINT "operator_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operator_nonces_chainId_address_key" ON "public"."operator_nonces"("chainId", "address");
