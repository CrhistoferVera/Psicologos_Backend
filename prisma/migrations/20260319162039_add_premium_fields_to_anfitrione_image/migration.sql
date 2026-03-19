-- AlterTable
ALTER TABLE "anfitrione_images" ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "unlockCredits" INTEGER;
