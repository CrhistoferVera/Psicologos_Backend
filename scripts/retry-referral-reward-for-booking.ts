import { ConfigService } from '@nestjs/config';
import { BookingPaymentStatus, BookingStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma.service';
import { ReferralsService } from '../src/referrals/referrals.service';
import { SystemConfigService } from '../src/system-config/system-config.service';
import * as dotenv from 'dotenv';

async function main() {
  dotenv.config({ path: '.env' });

  const bookingIds = process.argv.slice(2).filter(Boolean);
  if (bookingIds.length === 0) {
    console.error(
      'Uso: npx ts-node --transpile-only scripts/retry-referral-reward-for-booking.ts <bookingId> [bookingId...]',
    );
    process.exit(1);
  }

  const prisma = new PrismaService(new ConfigService());
  const referralsService = new ReferralsService(prisma, new SystemConfigService(prisma));

  await prisma.$connect();
  try {
    for (const bookingId of bookingIds) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          currency: true,
          earning: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!booking) {
        console.log(`[RETRY-REFERRAL] bookingId=${bookingId} skipped=BOOKING_NOT_FOUND`);
        continue;
      }

      if (
        booking.status !== BookingStatus.CONFIRMED ||
        booking.paymentStatus !== BookingPaymentStatus.PAID
      ) {
        console.log(
          `[RETRY-REFERRAL] bookingId=${bookingId} skipped=BOOKING_NOT_PAID_CONFIRMED status=${booking.status} paymentStatus=${booking.paymentStatus}`,
        );
        continue;
      }

      if (!booking.earning?.id) {
        console.log(`[RETRY-REFERRAL] bookingId=${bookingId} skipped=BOOKING_EARNING_NOT_FOUND`);
        continue;
      }

      const before = await prisma.referralProfessionalRewardEvent.findUnique({
        where: { bookingEarningId: booking.earning.id },
        select: { id: true },
      });

      if (before) {
        console.log(
          `[RETRY-REFERRAL] bookingId=${bookingId} bookingEarningId=${booking.earning.id} skipped=ALREADY_REWARDED eventId=${before.id}`,
        );
        continue;
      }

      const event = await referralsService.maybeRewardProfessionalReferralFromBookingEarningDetached({
        bookingEarningId: booking.earning.id,
      });

      if (!event) {
        console.log(
          `[RETRY-REFERRAL] bookingId=${bookingId} bookingEarningId=${booking.earning.id} result=NO_BENEFICIARY_OR_ZERO_REWARD`,
        );
        continue;
      }

      console.log(
        `[RETRY-REFERRAL] bookingId=${bookingId} bookingEarningId=${booking.earning.id} rewarded eventId=${event.id} rewardTxId=${event.rewardTransactionId} amount=${event.rewardAmount.toString()} currency=${event.currency}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
