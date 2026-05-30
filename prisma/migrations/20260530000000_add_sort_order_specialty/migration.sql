-- Add sortOrder to professional_specialties to preserve selection order
ALTER TABLE "professional_specialties" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
