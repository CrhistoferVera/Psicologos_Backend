import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { BanecoApiService } from './baneco-api.service';
import { BanecoQrController } from './baneco-qr.controller';
import { BanecoQrService } from './baneco-qr.service';

@Module({
  imports: [PrismaModule, SystemConfigModule],
  controllers: [BanecoQrController],
  providers: [BanecoApiService, BanecoQrService],
  exports: [BanecoQrService],
})
export class BanecoQrModule {}
