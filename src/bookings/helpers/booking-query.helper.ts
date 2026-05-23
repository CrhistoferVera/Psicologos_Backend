import { BookingStatus, Prisma } from '@prisma/client';

export function buildActiveBookingOverlapWhere(
  professionalId: string,
  start: Date,
  end: Date,
  now: Date,
  excludeBookingId?: string,
): Prisma.BookingWhereInput {
  return {
    ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
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
