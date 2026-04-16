import { Module } from '@nestjs/common';
import { RechargeRequestService } from './recharge-request.service';
import { RechargeRequestController } from './recharge-request.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { MailModule } from 'src/mail/mail.module';
import { ReferralsModule } from '../../referrals/referrals.module';

@Module({
  imports: [PrismaModule, MailModule, ReferralsModule],
  controllers: [RechargeRequestController],
  providers: [RechargeRequestService],
})
export class RechargeRequestModule {}
