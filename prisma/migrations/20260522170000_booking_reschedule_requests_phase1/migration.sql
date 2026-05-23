-- CreateEnum
CREATE TYPE "BookingRescheduleRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "bookings"
ADD COLUMN "rescheduleCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "booking_reschedule_requests" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByRole" "UserRole" NOT NULL,
    "currentStartAt" TIMESTAMP(3) NOT NULL,
    "currentEndAt" TIMESTAMP(3) NOT NULL,
    "proposedStartAt" TIMESTAMP(3) NOT NULL,
    "proposedEndAt" TIMESTAMP(3) NOT NULL,
    "proposedTimezone" TEXT NOT NULL,
    "reason" TEXT,
    "status" "BookingRescheduleRequestStatus" NOT NULL DEFAULT 'PENDING',
    "respondedByUserId" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "requestExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_reschedule_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_reschedule_requests_bookingId_status_idx" ON "booking_reschedule_requests"("bookingId", "status");

-- CreateIndex
CREATE INDEX "booking_reschedule_requests_requestedByUserId_status_createdAt_idx" ON "booking_reschedule_requests"("requestedByUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "booking_reschedule_requests_respondedByUserId_status_createdAt_idx" ON "booking_reschedule_requests"("respondedByUserId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "booking_reschedule_requests" ADD CONSTRAINT "booking_reschedule_requests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_reschedule_requests" ADD CONSTRAINT "booking_reschedule_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_reschedule_requests" ADD CONSTRAINT "booking_reschedule_requests_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
