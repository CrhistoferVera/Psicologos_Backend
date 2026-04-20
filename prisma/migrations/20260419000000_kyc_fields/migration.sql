-- CreateEnum
CREATE TYPE "KycFaceMatchStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "professional_profiles"
  ADD COLUMN "kycVideoUrl"               TEXT,
  ADD COLUMN "kycVideoPublicId"          TEXT,
  ADD COLUMN "kycSelfieUrl"              TEXT,
  ADD COLUMN "kycSelfiePublicId"         TEXT,
  ADD COLUMN "matriculaUrl"              TEXT,
  ADD COLUMN "matriculaPublicId"         TEXT,
  ADD COLUMN "tituloProfesionalUrl"      TEXT,
  ADD COLUMN "tituloProfesionalPublicId" TEXT,
  ADD COLUMN "kycFaceMatchScore"         DOUBLE PRECISION,
  ADD COLUMN "kycFaceMatchStatus"        "KycFaceMatchStatus" NOT NULL DEFAULT 'PENDING';
