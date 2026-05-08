import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingEarningsModule } from '../booking-earnings/booking-earnings.module';

@Module({
  imports: [NotificationsModule, BookingEarningsModule],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
