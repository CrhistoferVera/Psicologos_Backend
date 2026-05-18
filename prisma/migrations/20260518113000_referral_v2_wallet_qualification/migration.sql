-- Add new transaction types (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'TransactionType' AND e.enumlabel = 'REFERRAL_PROFESSIONAL_REWARD') THEN
    ALTER TYPE "TransactionType" ADD VALUE 'REFERRAL_PROFESSIONAL_REWARD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'TransactionType' AND e.enumlabel = 'REFERRAL_PROFESSIONAL_REWARD_REVERSAL') THEN
    ALTER TYPE "TransactionType" ADD VALUE 'REFERRAL_PROFESSIONAL_REWARD_REVERSAL';
  END IF;
END $$;

-- Create enums for referral benefit status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferralClientBenefitStatus') THEN
    CREATE TYPE "ReferralClientBenefitStatus" AS ENUM ('ACTIVE', 'CONSUMED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferralProfessionalBenefitStatus') THEN
    CREATE TYPE "ReferralProfessionalBenefitStatus" AS ENUM ('ACTIVE');
  END IF;
END $$;

-- System config: new referral parameters
ALTER TABLE "system_config"
  ADD COLUMN IF NOT EXISTS "referralValidPurchasesRequired" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "referralThreshold" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "referralClientDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS "referralClientDiscountSessions" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "referralProfessionalRewardPercent" DECIMAL(5,2) NOT NULL DEFAULT 5.00;

-- Referral: track completed valid purchases count
ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "validPurchasesCount" INTEGER NOT NULL DEFAULT 0;

-- Booking snapshots for referral discounts
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "originalPriceBob" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "originalPriceUsd" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "referralDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "referralDiscountAmountBob" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "referralDiscountAmountUsd" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "referralClientBenefitId" TEXT;

ALTER TABLE "booking_payments"
  ADD COLUMN IF NOT EXISTS "originalAmountBob" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "originalAmountUsd" DECIMAL(10,2);

-- Client referral benefits (discount cycles)
CREATE TABLE IF NOT EXISTS "referral_client_benefits" (
  "id" TEXT NOT NULL,
  "referrerUserId" TEXT NOT NULL,
  "cycleNumber" INTEGER NOT NULL,
  "threshold" INTEGER NOT NULL,
  "discountPercent" DECIMAL(5,2) NOT NULL,
  "totalSessions" INTEGER NOT NULL,
  "remainingSessions" INTEGER NOT NULL,
  "status" "ReferralClientBenefitStatus" NOT NULL DEFAULT 'ACTIVE',
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "referral_client_benefits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "referral_client_benefits_referrerUserId_status_idx"
  ON "referral_client_benefits"("referrerUserId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "referral_client_benefits_referrerUserId_cycleNumber_key"
  ON "referral_client_benefits"("referrerUserId", "cycleNumber");

ALTER TABLE "referral_client_benefits"
  ADD CONSTRAINT "referral_client_benefits_referrerUserId_fkey"
  FOREIGN KEY ("referrerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Client discount usage consumption records
CREATE TABLE IF NOT EXISTS "referral_client_discount_usages" (
  "id" TEXT NOT NULL,
  "benefitId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "bookingPaymentId" TEXT,
  "currency" TEXT NOT NULL,
  "discountPercent" DECIMAL(5,2) NOT NULL,
  "discountAmountBob" DECIMAL(10,2),
  "discountAmountUsd" DECIMAL(10,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_client_discount_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_client_discount_usages_bookingId_key"
  ON "referral_client_discount_usages"("bookingId");

CREATE UNIQUE INDEX IF NOT EXISTS "referral_client_discount_usages_bookingPaymentId_key"
  ON "referral_client_discount_usages"("bookingPaymentId");

CREATE INDEX IF NOT EXISTS "referral_client_discount_usages_benefitId_createdAt_idx"
  ON "referral_client_discount_usages"("benefitId", "createdAt");

ALTER TABLE "referral_client_discount_usages"
  ADD CONSTRAINT "referral_client_discount_usages_benefitId_fkey"
  FOREIGN KEY ("benefitId") REFERENCES "referral_client_benefits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_client_discount_usages"
  ADD CONSTRAINT "referral_client_discount_usages_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_client_discount_usages"
  ADD CONSTRAINT "referral_client_discount_usages_bookingPaymentId_fkey"
  FOREIGN KEY ("bookingPaymentId") REFERENCES "booking_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Professional referral campaigns by cycles
CREATE TABLE IF NOT EXISTS "referral_professional_benefit_campaigns" (
  "id" TEXT NOT NULL,
  "professionalReferrerId" TEXT NOT NULL,
  "cycleNumber" INTEGER NOT NULL,
  "threshold" INTEGER NOT NULL,
  "rewardPercent" DECIMAL(5,2) NOT NULL,
  "status" "ReferralProfessionalBenefitStatus" NOT NULL DEFAULT 'ACTIVE',
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "referral_professional_benefit_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "referral_professional_benefit_campaigns_professionalReferre_idx"
  ON "referral_professional_benefit_campaigns"("professionalReferrerId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "referral_professional_benefit_campaigns_professionalReferre_key"
  ON "referral_professional_benefit_campaigns"("professionalReferrerId", "cycleNumber");

ALTER TABLE "referral_professional_benefit_campaigns"
  ADD CONSTRAINT "referral_professional_benefit_campaigns_professionalReferr_fkey"
  FOREIGN KEY ("professionalReferrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fixed beneficiaries for each professional campaign
CREATE TABLE IF NOT EXISTS "referral_professional_beneficiaries" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "professionalReferrerId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "referralId" TEXT,
  "rewardPercent" DECIMAL(5,2) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "referral_professional_beneficiaries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "referral_professional_beneficiaries_campaignId_idx"
  ON "referral_professional_beneficiaries"("campaignId");

CREATE INDEX IF NOT EXISTS "referral_professional_beneficiaries_referredUserId_isActive_idx"
  ON "referral_professional_beneficiaries"("referredUserId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "referral_professional_beneficiaries_professionalReferrerId__key"
  ON "referral_professional_beneficiaries"("professionalReferrerId", "referredUserId");

ALTER TABLE "referral_professional_beneficiaries"
  ADD CONSTRAINT "referral_professional_beneficiaries_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "referral_professional_benefit_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_professional_beneficiaries"
  ADD CONSTRAINT "referral_professional_beneficiaries_professionalReferrerId_fkey"
  FOREIGN KEY ("professionalReferrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_professional_beneficiaries"
  ADD CONSTRAINT "referral_professional_beneficiaries_referredUserId_fkey"
  FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_professional_beneficiaries"
  ADD CONSTRAINT "referral_professional_beneficiaries_referralId_fkey"
  FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permanent professional reward events with idempotency
CREATE TABLE IF NOT EXISTS "referral_professional_reward_events" (
  "id" TEXT NOT NULL,
  "beneficiaryId" TEXT NOT NULL,
  "bookingEarningId" TEXT NOT NULL,
  "sourceTransactionId" TEXT,
  "rewardTransactionId" TEXT NOT NULL,
  "reversalTransactionId" TEXT,
  "currency" TEXT NOT NULL,
  "sourceAmount" DECIMAL(10,2) NOT NULL,
  "rewardPercent" DECIMAL(5,2) NOT NULL,
  "rewardAmount" DECIMAL(10,2) NOT NULL,
  "reversedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_professional_reward_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_professional_reward_events_bookingEarningId_key"
  ON "referral_professional_reward_events"("bookingEarningId");

CREATE UNIQUE INDEX IF NOT EXISTS "referral_professional_reward_events_sourceTransactionId_key"
  ON "referral_professional_reward_events"("sourceTransactionId");

CREATE UNIQUE INDEX IF NOT EXISTS "referral_professional_reward_events_rewardTransactionId_key"
  ON "referral_professional_reward_events"("rewardTransactionId");

CREATE UNIQUE INDEX IF NOT EXISTS "referral_professional_reward_events_reversalTransactionId_key"
  ON "referral_professional_reward_events"("reversalTransactionId");

CREATE INDEX IF NOT EXISTS "referral_professional_reward_events_beneficiaryId_createdAt_idx"
  ON "referral_professional_reward_events"("beneficiaryId", "createdAt");

ALTER TABLE "referral_professional_reward_events"
  ADD CONSTRAINT "referral_professional_reward_events_beneficiaryId_fkey"
  FOREIGN KEY ("beneficiaryId") REFERENCES "referral_professional_beneficiaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_professional_reward_events"
  ADD CONSTRAINT "referral_professional_reward_events_bookingEarningId_fkey"
  FOREIGN KEY ("bookingEarningId") REFERENCES "booking_earnings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_professional_reward_events"
  ADD CONSTRAINT "referral_professional_reward_events_sourceTransactionId_fkey"
  FOREIGN KEY ("sourceTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "referral_professional_reward_events"
  ADD CONSTRAINT "referral_professional_reward_events_rewardTransactionId_fkey"
  FOREIGN KEY ("rewardTransactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_professional_reward_events"
  ADD CONSTRAINT "referral_professional_reward_events_reversalTransactionId_fkey"
  FOREIGN KEY ("reversalTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Link booking to client benefit
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_referralClientBenefitId_fkey"
  FOREIGN KEY ("referralClientBenefitId") REFERENCES "referral_client_benefits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
