-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'SUBSCRIPTION';

-- CreateTable
CREATE TABLE "anfitrione_subscriptions" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anfitrione_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anfitrione_subscriptions_profileId_key" ON "anfitrione_subscriptions"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "user_subscriptions_userId_subscriptionId_key" ON "user_subscriptions"("userId", "subscriptionId");

-- AddForeignKey
ALTER TABLE "anfitrione_subscriptions" ADD CONSTRAINT "anfitrione_subscriptions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "anfitrione_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "anfitrione_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
