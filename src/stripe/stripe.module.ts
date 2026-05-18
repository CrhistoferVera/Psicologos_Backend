import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingEarningsModule } from '../booking-earnings/booking-earnings.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [NotificationsModule, BookingEarningsModule, ReferralsModule],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
