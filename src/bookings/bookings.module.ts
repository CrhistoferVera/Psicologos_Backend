import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { BanecoQrModule } from '../baneco-qr/baneco-qr.module';
import { StripeModule } from '../stripe/stripe.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingEarningsModule } from '../booking-earnings/booking-earnings.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [
    PrismaModule,
    SystemConfigModule,
    BanecoQrModule,
    StripeModule,
    NotificationsModule,
    BookingEarningsModule,
    ReferralsModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
