-- AlterTable
ALTER TABLE "professional_profiles" ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
