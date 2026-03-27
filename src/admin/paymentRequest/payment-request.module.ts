import { Module } from '@nestjs/common';
import { PaymentRequestController } from './payment-request.controller';
import { RechargeRequestService } from './payment-request.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CloudinaryModule } from '../../cloudinary/cloudinary.module';
import { MailModule } from '../../mail/mail.module';

@Module({
    imports: [PrismaModule, CloudinaryModule, MailModule],
    controllers: [PaymentRequestController],
    providers: [RechargeRequestService],
})
export class PaymentRequestModule { }
