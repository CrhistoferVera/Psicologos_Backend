import { BookingStatus, Prisma } from '@prisma/client';

export function buildActiveBookingOverlapWhere(
  professionalId: string,
  start: Date,
  end: Date,
  now: Date,
): Prisma.BookingWhereInput {
  return {
    professionalId,
    scheduledStartAt: { lt: end },
    scheduledEndAt: { gt: start },
    OR: [
      { status: BookingStatus.CONFIRMED },
      {
        status: BookingStatus.PENDING_PAYMENT,
        expiresAt: { gt: now },
      },
    ],
  };
}
