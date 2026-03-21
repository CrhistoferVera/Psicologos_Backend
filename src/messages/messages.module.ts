import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { ServicePricesModule } from '../service-prices/service-prices.module';
import { CallsModule } from '../calls/calls.module';

@Module({
  imports: [ServicePricesModule, CallsModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway],
})
export class MessagesModule {}
