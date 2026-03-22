-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'CALL_PAYMENT';

-- CreateTable
CREATE TABLE "saved_anfitrionas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "anfitrionaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_anfitrionas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_anfitrionas_userId_anfitrionaId_key" ON "saved_anfitrionas"("userId", "anfitrionaId");

-- AddForeignKey
ALTER TABLE "saved_anfitrionas" ADD CONSTRAINT "saved_anfitrionas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_anfitrionas" ADD CONSTRAINT "saved_anfitrionas_anfitrionaId_fkey" FOREIGN KEY ("anfitrionaId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
