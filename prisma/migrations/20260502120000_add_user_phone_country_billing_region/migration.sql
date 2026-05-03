-- Add phone metadata and billing segmentation fields for users
ALTER TABLE "users"
  ADD COLUMN "phoneDialCode" TEXT,
  ADD COLUMN "phoneNationalNumber" TEXT,
  ADD COLUMN "phoneCountryIso" TEXT,
  ADD COLUMN "phoneCountryName" TEXT,
  ADD COLUMN "billingRegion" TEXT,
  ADD COLUMN "preferredCurrency" TEXT;

CREATE INDEX "users_billingRegion_idx" ON "users"("billingRegion");
CREATE INDEX "users_phoneCountryIso_idx" ON "users"("phoneCountryIso");
