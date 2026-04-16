import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { ProfessionalsModule } from './anfitrionas/anfitrionas.module';
import { PackageModule } from './admin/package/package.module';
import { ClientModule } from './admin/client/client.module';
import { AdminProfessionalsModule } from './admin/anfitriona/anfitriona.module';
import { MessagesModule } from './messages/messages.module';
import { ServicePricesModule } from './service-prices/service-prices.module';
import { RechargeRequestModule } from './admin/rechargeRequest/recharge-request.module';
import { DepositsModule } from './deposits/deposits.module';
import { WalletModule } from './wallet/wallet.module';
import { CallsModule } from './calls/calls.module';
import { PaymentRequestModule } from './admin/paymentRequest/payment-request.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StatsModule } from './admin/stats/stats.module';
import { PromotionalCreditsModule } from './admin/promotional-credits/promotional-credits.module';
import { SpecialtyModule } from './admin/specialty/specialty.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { AdminConfigModule } from './admin/config/admin-config.module';
import { ReferralsModule } from './referrals/referrals.module';
import { FlowModule } from './flow/flow.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SystemConfigModule,
    PackageModule,
    ClientModule,
    AdminProfessionalsModule,
    AdminConfigModule,
    AuthModule,
    UsersModule,
    CloudinaryModule,
    ProfessionalsModule,
    MessagesModule,
    ServicePricesModule,
    RechargeRequestModule,
    DepositsModule,
    WalletModule,
    CallsModule,
    PaymentRequestModule,
    NotificationsModule,
    StatsModule,
    PromotionalCreditsModule,
    SpecialtyModule,
    ReferralsModule,
    FlowModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

