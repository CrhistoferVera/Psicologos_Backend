import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
