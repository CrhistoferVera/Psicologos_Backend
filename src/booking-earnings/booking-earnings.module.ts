import { Module } from '@nestjs/common';
import { BookingEarningsService } from './booking-earnings.service';

@Module({
  providers: [BookingEarningsService],
  exports: [BookingEarningsService],
})
export class BookingEarningsModule {}

