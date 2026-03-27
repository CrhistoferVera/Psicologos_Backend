-- AlterTable
ALTER TABLE "withdrawal_requests" ADD COLUMN     "receiptPublicId" TEXT,
ADD COLUMN     "receiptUrl" TEXT,
ADD COLUMN     "rejectionReason" TEXT;
