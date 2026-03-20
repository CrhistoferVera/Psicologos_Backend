-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('MESSAGE', 'CALL', 'VIDEO_CALL');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'MESSAGE_UNLOCK';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "price" INTEGER;

-- CreateTable
CREATE TABLE "service_prices" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_unlocks" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creditsSpent" INTEGER NOT NULL,
    "transactionId" TEXT,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_prices_profileId_serviceType_key" ON "service_prices"("profileId", "serviceType");

-- CreateIndex
CREATE UNIQUE INDEX "message_unlocks_transactionId_key" ON "message_unlocks"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "message_unlocks_messageId_userId_key" ON "message_unlocks"("messageId", "userId");

-- AddForeignKey
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "anfitrione_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_unlocks" ADD CONSTRAINT "message_unlocks_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_unlocks" ADD CONSTRAINT "message_unlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_unlocks" ADD CONSTRAINT "message_unlocks_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
