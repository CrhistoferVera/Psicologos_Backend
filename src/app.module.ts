import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { AnfitrioneModule } from './anfitrionas/anfitrionas.module';

import { PackageModule } from './admin/package/package.module';
import { ClientModule} from './admin/client/client.module';
import { AnfitrionaModule } from './admin/anfitriona/anfitriona.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ChatsModule } from './chats/chats.module';
import { MessagesModule } from './messages/messages.module';
import { ServicePricesModule } from './service-prices/service-prices.module';
import { RechargeRequestModule } from './admin/rechargeRequest/recharge-request.module';
import { DepositsModule } from './deposits/deposits.module';
import { WalletModule } from './wallet/wallet.module';
import { CallsModule } from './calls/calls.module';
import { PaymentRequestModule } from './admin/paymentRequest/payment-request.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StatsModule } from './admin/stats/stats.module';
import { CulqiModule } from './culqi/culqi.module';
import { FlowModule } from './flow/flow.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    PackageModule,
    ClientModule,
    AnfitrionaModule,
    AuthModule,
    UsersModule,
    CloudinaryModule,
    AnfitrioneModule,
    ChatsModule,
    MessagesModule,
    ServicePricesModule,
    RechargeRequestModule,
    DepositsModule,
    WalletModule,
    CallsModule,
    PaymentRequestModule,
    NotificationsModule,
    StatsModule,
    CulqiModule,
    FlowModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
