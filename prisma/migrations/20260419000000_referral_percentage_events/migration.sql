-- AlterEnum: add ACTIVE status
ALTER TYPE "ReferralStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';

-- AlterTable: add referralPercentage to system_config
ALTER TABLE "system_config" ADD COLUMN IF NOT EXISTS "referralPercentage" DECIMAL(5,2) NOT NULL DEFAULT 2.50;

-- CreateTable: referral_reward_events (auditability per-transaction)
CREATE TABLE IF NOT EXISTS "referral_reward_events" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "rewardTransactionId" TEXT NOT NULL,
    "rewardAmount" DECIMAL(10,2) NOT NULL,
    "percentageApplied" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_reward_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "referral_reward_events_sourceTransactionId_key" ON "referral_reward_events"("sourceTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "referral_reward_events_rewardTransactionId_key" ON "referral_reward_events"("rewardTransactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_reward_events_referralId_idx" ON "referral_reward_events"("referralId");

-- AddForeignKey
ALTER TABLE "referral_reward_events"
    ADD CONSTRAINT "referral_reward_events_referralId_fkey"
    FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_reward_events"
    ADD CONSTRAINT "referral_reward_events_sourceTransactionId_fkey"
    FOREIGN KEY ("sourceTransactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_reward_events"
    ADD CONSTRAINT "referral_reward_events_rewardTransactionId_fkey"
    FOREIGN KEY ("rewardTransactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
