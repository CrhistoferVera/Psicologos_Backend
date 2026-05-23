import { ConfigService } from '@nestjs/config';
import { BookingPaymentStatus, BookingStatus, Prisma } from '@prisma/client';
import * as dotenv from 'dotenv';
import { PrismaService } from '../src/prisma.service';
import { ReferralsService } from '../src/referrals/referrals.service';
import { SystemConfigService } from '../src/system-config/system-config.service';

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
  const systemConfigService = new SystemConfigService(prisma);
  const referralsService = new ReferralsService(prisma, systemConfigService);

  await prisma.$connect();
  try {
    const runtimeConfig = await systemConfigService.getRuntimeConfig();

    for (const bookingId of bookingIds) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          status: true,
          paymentStatus: true,
          currency: true,
          priceBob: true,
          priceUsd: true,
          earning: { select: { id: true, grossAmount: true } },
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

      const grossAmount = new Prisma.Decimal(booking.earning.grossAmount ?? 0);

      try {
        const rewards = await prisma.$transaction(
          async (tx) =>
            referralsService.maybeRewardReferrerFromSession(tx, {
              bookingId: booking.id,
              bookingEarningId: booking.earning!.id,
              clientId: booking.clientId,
              professionalId: booking.professionalId,
              grossAmount,
              currency: booking.currency,
              rewardPercent: runtimeConfig.referralRewardPercent,
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        console.log(
          `[RETRY-REFERRAL] bookingId=${bookingId} bookingEarningId=${booking.earning.id} rewards=${JSON.stringify(rewards)}`,
        );
      } catch (err: any) {
        console.error(`[RETRY-REFERRAL] bookingId=${bookingId} error=${err?.message}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
