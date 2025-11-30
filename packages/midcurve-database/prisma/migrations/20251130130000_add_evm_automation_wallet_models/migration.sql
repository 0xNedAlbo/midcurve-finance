-- CreateTable
CREATE TABLE "evm_automation_wallets" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kmsKeyId" TEXT NOT NULL,
    "keyProvider" TEXT NOT NULL DEFAULT 'aws-kms',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "evm_automation_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intent_nonces" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signer" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "nonce" TEXT NOT NULL,
    "intentType" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intent_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signing_audit_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "intentHash" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "signing_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evm_automation_wallets_kmsKeyId_key" ON "evm_automation_wallets"("kmsKeyId");

-- CreateIndex
CREATE INDEX "evm_automation_wallets_userId_idx" ON "evm_automation_wallets"("userId");

-- CreateIndex
CREATE INDEX "evm_automation_wallets_isActive_idx" ON "evm_automation_wallets"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "evm_automation_wallets_userId_walletAddress_key" ON "evm_automation_wallets"("userId", "walletAddress");

-- CreateIndex
CREATE INDEX "intent_nonces_signer_chainId_idx" ON "intent_nonces"("signer", "chainId");

-- CreateIndex
CREATE UNIQUE INDEX "intent_nonces_signer_chainId_nonce_key" ON "intent_nonces"("signer", "chainId", "nonce");

-- CreateIndex
CREATE INDEX "signing_audit_logs_userId_idx" ON "signing_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "signing_audit_logs_walletAddress_idx" ON "signing_audit_logs"("walletAddress");

-- CreateIndex
CREATE INDEX "signing_audit_logs_status_idx" ON "signing_audit_logs"("status");

-- CreateIndex
CREATE INDEX "signing_audit_logs_operation_idx" ON "signing_audit_logs"("operation");

-- CreateIndex
CREATE INDEX "signing_audit_logs_requestedAt_idx" ON "signing_audit_logs"("requestedAt");

-- AddForeignKey
ALTER TABLE "evm_automation_wallets" ADD CONSTRAINT "evm_automation_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
