import { Module } from '@nestjs/common';
import { ServicePricesController } from './service-prices.controller';
import { ServicePricesService } from './service-prices.service';

@Module({
  controllers: [ServicePricesController],
  providers: [ServicePricesService],
  exports: [ServicePricesService],
})
export class ServicePricesModule {}
