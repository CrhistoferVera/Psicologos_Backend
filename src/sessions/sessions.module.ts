import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { BanecoQrModule } from '../baneco-qr/baneco-qr.module';
import { StripeModule } from '../stripe/stripe.module';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';

@Module({
  imports: [PrismaModule, SystemConfigModule, BanecoQrModule, StripeModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
