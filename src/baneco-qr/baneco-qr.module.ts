import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingEarningsModule } from '../booking-earnings/booking-earnings.module';
import { BanecoApiService } from './baneco-api.service';
import { BanecoQrController } from './baneco-qr.controller';
import { BanecoQrService } from './baneco-qr.service';

@Module({
  imports: [PrismaModule, SystemConfigModule, NotificationsModule, BookingEarningsModule],
  controllers: [BanecoQrController],
  providers: [BanecoApiService, BanecoQrService],
  exports: [BanecoQrService],
})
export class BanecoQrModule {}
