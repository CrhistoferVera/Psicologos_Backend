import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { ServicePricesModule } from '../service-prices/service-prices.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [ServicePricesModule, ReferralsModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
