-- AlterTable
ALTER TABLE "deposit_requests" ADD COLUMN     "creditsToDeliver" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "packageNameAtMoment" TEXT;
