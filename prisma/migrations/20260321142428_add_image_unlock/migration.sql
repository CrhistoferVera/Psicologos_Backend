-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'IMAGE_UNLOCK';

-- CreateTable
CREATE TABLE "image_unlocks" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creditsSpent" INTEGER NOT NULL,
    "transactionId" TEXT,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "image_unlocks_transactionId_key" ON "image_unlocks"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "image_unlocks_imageId_userId_key" ON "image_unlocks"("imageId", "userId");

-- AddForeignKey
ALTER TABLE "image_unlocks" ADD CONSTRAINT "image_unlocks_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "anfitrione_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_unlocks" ADD CONSTRAINT "image_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_unlocks" ADD CONSTRAINT "image_unlocks_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
