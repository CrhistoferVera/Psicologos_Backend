-- CreateEnum
CREATE TYPE "BookingEarningStatus" AS ENUM ('CREDITED');

-- CreateTable
CREATE TABLE "booking_earnings" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "bookingPaymentId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "transactionId" TEXT,
    "currency" TEXT NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "platformCommissionPercent" DECIMAL(5,2) NOT NULL,
    "platformCommissionAmount" DECIMAL(10,2) NOT NULL,
    "professionalAmount" DECIMAL(10,2) NOT NULL,
    "paymentMethod" "BookingPaymentMethod" NOT NULL,
    "status" "BookingEarningStatus" NOT NULL DEFAULT 'CREDITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_earnings_bookingId_key" ON "booking_earnings"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_earnings_bookingPaymentId_key" ON "booking_earnings"("bookingPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_earnings_transactionId_key" ON "booking_earnings"("transactionId");

-- CreateIndex
CREATE INDEX "booking_earnings_professionalId_createdAt_idx" ON "booking_earnings"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_earnings_clientId_createdAt_idx" ON "booking_earnings"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_earnings_walletId_createdAt_idx" ON "booking_earnings"("walletId", "createdAt");

-- AddForeignKey
ALTER TABLE "booking_earnings" ADD CONSTRAINT "booking_earnings_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_earnings" ADD CONSTRAINT "booking_earnings_bookingPaymentId_fkey" FOREIGN KEY ("bookingPaymentId") REFERENCES "booking_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_earnings" ADD CONSTRAINT "booking_earnings_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_earnings" ADD CONSTRAINT "booking_earnings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_earnings" ADD CONSTRAINT "booking_earnings_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_earnings" ADD CONSTRAINT "booking_earnings_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
