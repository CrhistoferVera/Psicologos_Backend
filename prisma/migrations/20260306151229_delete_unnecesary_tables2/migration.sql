/*
  Warnings:

  - You are about to drop the `Banks` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `bank_accounts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `company_bank_accounts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `deposit_details` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `kyc_documents` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `kyc_requests` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_bankId_fkey";

-- DropForeignKey
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_userId_fkey";

-- DropForeignKey
ALTER TABLE "kyc_documents" DROP CONSTRAINT "kyc_documents_kycRequestId_fkey";

-- DropForeignKey
ALTER TABLE "kyc_documents" DROP CONSTRAINT "kyc_documents_userId_fkey";

-- DropForeignKey
ALTER TABLE "kyc_requests" DROP CONSTRAINT "kyc_requests_reviewedById_fkey";

-- DropForeignKey
ALTER TABLE "kyc_requests" DROP CONSTRAINT "kyc_requests_userId_fkey";

-- DropTable
DROP TABLE "Banks";

-- DropTable
DROP TABLE "bank_accounts";

-- DropTable
DROP TABLE "company_bank_accounts";

-- DropTable
DROP TABLE "deposit_details";

-- DropTable
DROP TABLE "kyc_documents";

-- DropTable
DROP TABLE "kyc_requests";

-- DropEnum
DROP TYPE "BlacklistAction";

-- DropEnum
DROP TYPE "ContractEventType";

-- DropEnum
DROP TYPE "FiatCurrency";

-- DropEnum
DROP TYPE "FiatOperationStatus";

-- DropEnum
DROP TYPE "FiatOperationType";

-- DropEnum
DROP TYPE "KycDocumentType";

-- DropEnum
DROP TYPE "KycResourceType";

-- DropEnum
DROP TYPE "KycStatus";

-- DropEnum
DROP TYPE "Network";

-- DropEnum
DROP TYPE "TransactionStatus";

-- DropEnum
DROP TYPE "TransactionType";

-- DropEnum
DROP TYPE "VerificationStatus";

-- DropEnum
DROP TYPE "country_banks";