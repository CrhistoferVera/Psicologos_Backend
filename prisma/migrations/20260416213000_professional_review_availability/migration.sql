-- CreateEnum
CREATE TYPE "ProfessionalReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "anfitrione_profiles"
  ADD COLUMN "reviewStatus" "ProfessionalReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reviewNotes" TEXT,
  ADD COLUMN "availability" JSONB;

-- Backfill current active professionals as approved
UPDATE "anfitrione_profiles" ap
SET "reviewStatus" = 'APPROVED'
FROM "users" u
WHERE u."id" = ap."userId"
  AND u."isActive" = true;
