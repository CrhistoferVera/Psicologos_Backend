-- CreateEnum
CREATE TYPE "ContractEventType" AS ENUM ('MINTED', 'BURNED', 'REDEMPTION_REQUESTED', 'REDEMPTION_FINALIZED', 'REDEMPTION_REJECTED', 'CONFISCATED', 'SYSTEM_PAUSED', 'SYSTEM_UNPAUSED', 'ADDED_TO_BLACKLIST', 'REMOVED_FROM_BLACKLIST', 'TOKENS_RECOVERED', 'TRANSFER');

-- CreateEnum
CREATE TYPE "BlacklistAction" AS ENUM ('ADDED', 'REMOVED', 'CONFISCATED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'ANFITRIONA');

-- CreateEnum
CREATE TYPE "KycDocumentType" AS ENUM ('ID_FRONT', 'ID_BACK', 'LIVENESS_VIDEO');

-- CreateEnum
CREATE TYPE "KycResourceType" AS ENUM ('image', 'video', 'raw');

-- CreateEnum
CREATE TYPE "FiatOperationType" AS ENUM ('DEPOSIT', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "FiatOperationStatus" AS ENUM ('PENDING', 'PROOF_SUBMITTED', 'NEED_CORRECTION', 'RATE_EXPIRED', 'APPROVED', 'REJECTED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "FiatCurrency" AS ENUM ('BOB', 'PEN');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('MINT', 'BURN', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "Network" AS ENUM ('BNB_CHAIN_MAINNET', 'BNB_CHAIN_TESTNET');

-- CreateEnum
CREATE TYPE "country_banks" AS ENUM ('Bolivia', 'PERU');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isProfileComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLogin" TIMESTAMP(3),
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "resetPasswordExpiry" TIMESTAMP(3),
    "resetPasswordToken" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kycRequestId" TEXT NOT NULL,
    "docType" "KycDocumentType" NOT NULL,
    "docUrl" TEXT,
    "publicId" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "resourceType" "KycResourceType" NOT NULL,
    "mimeType" TEXT,
    "bytes" INTEGER,
    "uploadedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_details" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "expectedBOBH" DECIMAL(36,18) NOT NULL,
    "safeTxHash" TEXT,
    "safeProposedAt" TIMESTAMP(3),
    "mintTxHash" TEXT,
    "mintedAt" TIMESTAMP(3),
    "proofUrl" TEXT,
    "proofUploadedAt" TIMESTAMP(3),
    "proofFileName" TEXT,
    "proofMimeType" TEXT,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "deposit_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "bankId" INTEGER NOT NULL,
    "accountNumber" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Banks" (
    "name" TEXT NOT NULL,
    "logo_url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "country" "country_banks" NOT NULL,
    "id" SERIAL NOT NULL,

    CONSTRAINT "Banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_bank_accounts" (
    "id" TEXT NOT NULL,
    "currency" "FiatCurrency" NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "cci" TEXT,
    "qrImageUrl" TEXT,
    "qrPublicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "users"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "kyc_documents_kycRequestId_idx" ON "kyc_documents"("kycRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_documents_kycRequestId_docType_key" ON "kyc_documents"("kycRequestId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_details_operationId_key" ON "deposit_details"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_details_safeTxHash_key" ON "deposit_details"("safeTxHash");

-- CreateIndex
CREATE INDEX "bank_accounts_userId_idx" ON "bank_accounts"("userId");

-- CreateIndex
CREATE INDEX "bank_accounts_bankId_idx" ON "bank_accounts"("bankId");

-- CreateIndex
CREATE INDEX "bank_accounts_accountNumber_idx" ON "bank_accounts"("accountNumber");

-- CreateIndex
CREATE INDEX "company_bank_accounts_currency_idx" ON "company_bank_accounts"("currency");

-- CreateIndex
CREATE INDEX "company_bank_accounts_bankName_idx" ON "company_bank_accounts"("bankName");

-- CreateIndex
CREATE UNIQUE INDEX "company_bank_accounts_currency_key" ON "company_bank_accounts"("currency");

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_kycRequestId_fkey" FOREIGN KEY ("kycRequestId") REFERENCES "kyc_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_requests" ADD CONSTRAINT "kyc_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_requests" ADD CONSTRAINT "kyc_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
