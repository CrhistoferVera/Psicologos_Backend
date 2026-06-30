import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ClientPayoutAccountsController } from './client-payout-accounts.controller';
import { ClientPayoutAccountsService } from './client-payout-accounts.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClientPayoutAccountsController],
  providers: [ClientPayoutAccountsService],
})
export class ClientPayoutAccountsModule {}
