-- AlterTable: add cover photo fields to anfitrione_profiles
ALTER TABLE "anfitrione_profiles" ADD COLUMN "coverUrl" TEXT;
ALTER TABLE "anfitrione_profiles" ADD COLUMN "coverPublicId" TEXT;
