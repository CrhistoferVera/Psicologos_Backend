-- AlterEnum: add REFERRAL_REWARD_REVERSAL
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'REFERRAL_REWARD_REVERSAL';

-- AlterTable: add reversal + bonus fields to referral_reward_events
ALTER TABLE "referral_reward_events"
    ADD COLUMN IF NOT EXISTS "bonusPercentApplied" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "reversalTransactionId" TEXT;

-- CreateIndex: unique on reversalTransactionId
CREATE UNIQUE INDEX IF NOT EXISTS "referral_reward_events_reversalTransactionId_key"
    ON "referral_reward_events"("reversalTransactionId");

-- AddForeignKey: reversalTransaction
ALTER TABLE "referral_reward_events"
    ADD CONSTRAINT "referral_reward_events_reversalTransactionId_fkey"
    FOREIGN KEY ("reversalTransactionId") REFERENCES "transactions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: referral_bonus_tiers
CREATE TABLE IF NOT EXISTS "referral_bonus_tiers" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minActiveReferrals" INTEGER NOT NULL,
    "bonusPercent" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_bonus_tiers_pkey" PRIMARY KEY ("id")
);

-- Data migration: QUALIFIED and REWARDED → ACTIVE
-- QUALIFIED were activated by the old deposit-based flow; they are valid ongoing referrals.
-- REWARDED received a one-time fixed reward; they should also generate % rewards going forward.
UPDATE "referrals"
    SET "status" = 'ACTIVE', "qualifiedAt" = COALESCE("qualifiedAt", "updatedAt")
    WHERE "status" IN ('QUALIFIED', 'REWARDED');
