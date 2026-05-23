-- CreateEnum
CREATE TYPE "ReferralRewardType" AS ENUM ('SESSION', 'PACKAGE');

-- CreateEnum
CREATE TYPE "ReferralCase" AS ENUM ('PRO_TO_PRO', 'PRO_TO_USER', 'USER_TO_USER');

-- AlterEnum: replace old referral types with new ones
BEGIN;
CREATE TYPE "TransactionType_new" AS ENUM (
  'DEPOSIT',
  'WITHDRAWAL',
  'MESSAGE_SEND',
  'CALL_PAYMENT',
  'EARNING',
  'PROMOTIONAL_GRANT',
  'REFERRAL_REWARD',
  'REFERRAL_REWARD_REVERSAL',
  'REFERRAL_PACKAGE_REWARD',
  'REFERRAL_PACKAGE_REWARD_REVERSAL',
  'BOOKING_PAYMENT'
);
ALTER TABLE "transactions"
  ALTER COLUMN "type" TYPE "TransactionType_new"
  USING (
    CASE "type"::text
      WHEN 'REFERRAL_PROFESSIONAL_REWARD'         THEN 'REFERRAL_REWARD'
      WHEN 'REFERRAL_PROFESSIONAL_REWARD_REVERSAL' THEN 'REFERRAL_REWARD_REVERSAL'
      ELSE "type"::text
    END::"TransactionType_new"
  );
ALTER TYPE "TransactionType" RENAME TO "TransactionType_old";
ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";
DROP TYPE "public"."TransactionType_old";
COMMIT;

-- DropForeignKey (bookings)
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_referralClientBenefitId_fkey";

-- DropForeignKey (referral_client_benefits)
ALTER TABLE "referral_client_benefits" DROP CONSTRAINT IF EXISTS "referral_client_benefits_referrerUserId_fkey";

-- DropForeignKey (referral_client_discount_usages)
ALTER TABLE "referral_client_discount_usages" DROP CONSTRAINT IF EXISTS "referral_client_discount_usages_benefitId_fkey";
ALTER TABLE "referral_client_discount_usages" DROP CONSTRAINT IF EXISTS "referral_client_discount_usages_bookingId_fkey";
ALTER TABLE "referral_client_discount_usages" DROP CONSTRAINT IF EXISTS "referral_client_discount_usages_bookingPaymentId_fkey";

-- DropForeignKey (referral_professional_beneficiaries)
ALTER TABLE "referral_professional_beneficiaries" DROP CONSTRAINT IF EXISTS "referral_professional_beneficiaries_campaignId_fkey";
ALTER TABLE "referral_professional_beneficiaries" DROP CONSTRAINT IF EXISTS "referral_professional_beneficiaries_professionalReferrerId_fkey";
ALTER TABLE "referral_professional_beneficiaries" DROP CONSTRAINT IF EXISTS "referral_professional_beneficiaries_referralId_fkey";
ALTER TABLE "referral_professional_beneficiaries" DROP CONSTRAINT IF EXISTS "referral_professional_beneficiaries_referredUserId_fkey";

-- DropForeignKey (referral_professional_benefit_campaigns)
ALTER TABLE "referral_professional_benefit_campaigns" DROP CONSTRAINT IF EXISTS "referral_professional_benefit_campaigns_professionalReferr_fkey";

-- DropForeignKey (referral_professional_reward_events)
ALTER TABLE "referral_professional_reward_events" DROP CONSTRAINT IF EXISTS "referral_professional_reward_events_beneficiaryId_fkey";
ALTER TABLE "referral_professional_reward_events" DROP CONSTRAINT IF EXISTS "referral_professional_reward_events_bookingEarningId_fkey";
ALTER TABLE "referral_professional_reward_events" DROP CONSTRAINT IF EXISTS "referral_professional_reward_events_reversalTransactionId_fkey";
ALTER TABLE "referral_professional_reward_events" DROP CONSTRAINT IF EXISTS "referral_professional_reward_events_rewardTransactionId_fkey";
ALTER TABLE "referral_professional_reward_events" DROP CONSTRAINT IF EXISTS "referral_professional_reward_events_sourceTransactionId_fkey";

-- DropForeignKey (referral_reward_events)
ALTER TABLE "referral_reward_events" DROP CONSTRAINT IF EXISTS "referral_reward_events_referralId_fkey";
ALTER TABLE "referral_reward_events" DROP CONSTRAINT IF EXISTS "referral_reward_events_reversalTransactionId_fkey";
ALTER TABLE "referral_reward_events" DROP CONSTRAINT IF EXISTS "referral_reward_events_rewardTransactionId_fkey";
ALTER TABLE "referral_reward_events" DROP CONSTRAINT IF EXISTS "referral_reward_events_sourceTransactionId_fkey";

-- DropForeignKey (referrals)
ALTER TABLE "referrals" DROP CONSTRAINT IF EXISTS "referrals_referredDepositRequestId_fkey";
ALTER TABLE "referrals" DROP CONSTRAINT IF EXISTS "referrals_rewardTransactionId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "referrals_referredDepositRequestId_key";
DROP INDEX IF EXISTS "referrals_rewardTransactionId_key";

-- AlterTable bookings: drop referral discount columns
ALTER TABLE "bookings"
  DROP COLUMN IF EXISTS "referralClientBenefitId",
  DROP COLUMN IF EXISTS "referralDiscountAmountBob",
  DROP COLUMN IF EXISTS "referralDiscountAmountUsd",
  DROP COLUMN IF EXISTS "referralDiscountPercent";

-- AlterTable referrals: drop old columns, add new ones
ALTER TABLE "referrals"
  DROP COLUMN IF EXISTS "referredDepositRequestId",
  DROP COLUMN IF EXISTS "rewardCredits",
  DROP COLUMN IF EXISTS "rewardTransactionId",
  DROP COLUMN IF EXISTS "rewardedAt",
  DROP COLUMN IF EXISTS "validPurchasesCount",
  ADD COLUMN "packageRewardPaidAt" TIMESTAMP(3),
  ADD COLUMN "sessionRewardPaidAt" TIMESTAMP(3),
  ADD COLUMN "referrerRole" "UserRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN "referredRole" "UserRole" NOT NULL DEFAULT 'USER';

-- Populate referrerRole and referredRole from users table for existing records
UPDATE "referrals" r
SET
  "referrerRole" = u_referrer.role,
  "referredRole" = u_referred.role
FROM
  "users" u_referrer,
  "users" u_referred
WHERE
  r."referrerUserId" = u_referrer.id
  AND r."referredUserId" = u_referred.id;

-- Remove defaults (values already populated above)
ALTER TABLE "referrals"
  ALTER COLUMN "referrerRole" DROP DEFAULT,
  ALTER COLUMN "referredRole" DROP DEFAULT;

-- DropTable (old referral tables)
DROP TABLE IF EXISTS "referral_bonus_tiers";
DROP TABLE IF EXISTS "referral_client_discount_usages";
DROP TABLE IF EXISTS "referral_client_benefits";
DROP TABLE IF EXISTS "referral_professional_reward_events";
DROP TABLE IF EXISTS "referral_professional_beneficiaries";
DROP TABLE IF EXISTS "referral_professional_benefit_campaigns";
DROP TABLE IF EXISTS "referral_reward_events";

-- DropEnum
DROP TYPE IF EXISTS "ReferralClientBenefitStatus";
DROP TYPE IF EXISTS "ReferralProfessionalBenefitStatus";

-- CreateTable referral_rewards
CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "type" "ReferralRewardType" NOT NULL,
    "case" "ReferralCase" NOT NULL,
    "currency" TEXT NOT NULL,
    "sourceAmount" DECIMAL(10,2) NOT NULL,
    "rewardPercent" DECIMAL(5,2) NOT NULL,
    "rewardAmount" DECIMAL(10,2) NOT NULL,
    "bookingId" TEXT,
    "bookingEarningId" TEXT,
    "depositRequestId" TEXT,
    "transactionId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_transactionId_key" ON "referral_rewards"("transactionId");
CREATE UNIQUE INDEX "referral_rewards_reversalTransactionId_key" ON "referral_rewards"("reversalTransactionId");
CREATE INDEX "referral_rewards_referralId_idx" ON "referral_rewards"("referralId");
CREATE INDEX "referral_rewards_bookingEarningId_idx" ON "referral_rewards"("bookingEarningId");
CREATE INDEX "referral_rewards_depositRequestId_idx" ON "referral_rewards"("depositRequestId");

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referralId_fkey"
  FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_reversalTransactionId_fkey"
  FOREIGN KEY ("reversalTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
