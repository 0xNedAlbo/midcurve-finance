-- CreateTable
CREATE TABLE "shared_contracts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sharedContractType" TEXT NOT NULL,
    "sharedContractName" TEXT NOT NULL,
    "interfaceVersionMajor" INTEGER NOT NULL,
    "interfaceVersionMinor" INTEGER NOT NULL,
    "sharedContractHash" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shared_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_contracts_sharedContractHash_key" ON "shared_contracts"("sharedContractHash");

-- CreateIndex
CREATE INDEX "shared_contracts_sharedContractType_idx" ON "shared_contracts"("sharedContractType");

-- CreateIndex
CREATE INDEX "shared_contracts_sharedContractName_idx" ON "shared_contracts"("sharedContractName");

-- CreateIndex
CREATE INDEX "shared_contracts_sharedContractType_sharedContractName_idx" ON "shared_contracts"("sharedContractType", "sharedContractName");

-- CreateIndex
CREATE INDEX "shared_contracts_interfaceVersionMajor_interfaceVersionMino_idx" ON "shared_contracts"("interfaceVersionMajor", "interfaceVersionMinor");

-- CreateIndex
CREATE INDEX "shared_contracts_isActive_idx" ON "shared_contracts"("isActive");
