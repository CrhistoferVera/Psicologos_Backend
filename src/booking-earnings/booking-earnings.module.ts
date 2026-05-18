import { Module } from '@nestjs/common';
import { BookingEarningsService } from './booking-earnings.service';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [ReferralsModule],
  providers: [BookingEarningsService],
  exports: [BookingEarningsService],
})
export class BookingEarningsModule {}
